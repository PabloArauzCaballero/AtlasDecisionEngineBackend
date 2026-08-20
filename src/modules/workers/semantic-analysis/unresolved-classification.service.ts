import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { DomainException } from '../../../common/errors/domain-exception';
import { NotificationService } from '../../notifications/notification.service';

/**
 * Valores que el motor no supo clasificar, y qué hacer con ellos.
 *
 * La regla que gobierna este archivo: **nunca inventar una clasificación y nunca
 * perder el dato**. Cuando el clasificador no alcanza la confianza necesaria, la
 * alternativa a escalar no es «elegir la mejor candidata igualmente» —eso es
 * exactamente lo que produce informes que nadie puede auditar—: es guardar lo que
 * llegó, decir cuál CREE que es y con cuánta confianza, y pedir que alguien
 * decida.
 *
 * ## Deduplicar es la mitad del valor
 *
 * Un extracto repite la misma glosa desconocida decenas de veces y un lote de
 * importación, miles. Sin deduplicación esto sería una bandeja de entrada
 * inservible el primer día. La unicidad `(tenant, source, normalizedValue)` en la
 * base —no un `findFirst` seguido de un `create`— es lo que hace que dos
 * procesos que detecten el mismo término a la vez sumen una aparición en lugar
 * de crear dos pendientes: la carrera la resuelve Postgres, no el orden en que
 * lleguen.
 */

export type UnresolvedStatus = 'PENDING' | 'RESOLVED' | 'IGNORED' | 'REJECTED' | 'AUTO_RESOLVED';

export type ResolutionType =
  | 'USE_SUGGESTED'
  | 'ASSIGN_EXISTING'
  | 'CREATE_CATEGORY'
  | 'CREATE_ALIAS'
  | 'DISCARD'
  | 'NOT_CATEGORIZED';

export interface CandidateSuggestion {
  categoryCode: string;
  confidence: number;
}

export interface RecordUnresolvedInput {
  tenantId: bigint;
  /** El valor tal como se recibió. */
  rawValue: string;
  /** Quién lo produjo: `semantic-analysis`, `bank-statement`, `code-import`… */
  source: string;
  /** Dónde apareció: ejecución, artefacto, variable, fila del lote. */
  context?: Record<string, unknown>;
  /** Candidatas ordenadas de mayor a menor confianza. La primera es la sugerida. */
  candidates?: readonly CandidateSuggestion[];
  correlationId?: string;
}

/** Notificación que se manda una sola vez por término, no una por aparición. */
const NOTIFICATION_EVENT = 'decision-engine.classification.unresolved';
const ADMIN_ROLE = 'PLATFORM_ADMIN';

@Injectable()
export class UnresolvedClassificationService {
  private readonly logger = new Logger(UnresolvedClassificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Umbrales de política, configurables y nunca fijos en el código.
   *
   * Qué es «suficiente confianza» depende de lo que cueste equivocarse, y eso lo
   * decide quien opera el motor, no quien lo escribe.
   */
  private get thresholds(): { high: number; medium: number; autoResolve: boolean } {
    return {
      high: this.config.get<number>('UNRESOLVED_HIGH_CONFIDENCE') ?? 0.9,
      medium: this.config.get<number>('UNRESOLVED_MEDIUM_CONFIDENCE') ?? 0.6,
      autoResolve: this.config.get<boolean>('UNRESOLVED_AUTO_RESOLVE_ENABLED') ?? false,
    };
  }

  /**
   * Normaliza sólo para COMPARAR.
   *
   * Mayúsculas, espacios de más y acentos no hacen distinto a un término, y sin
   * plegarlos «Servicios Profesionales» y «SERVICIOS  PROFESIONALES» abrirían dos
   * pendientes del mismo caso. El valor original se guarda intacto al lado: esto
   * es una clave de búsqueda, no una versión mejorada del dato.
   */
  normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/\s+/gu, ' ')
      .trim()
      .toUpperCase()
      .slice(0, 500);
  }

  /**
   * Registra —o vuelve a ver— un valor sin resolver.
   *
   * Antes de abrir un pendiente comprueba si el término YA tiene alias: si
   * alguien lo resolvió antes, esto se resuelve solo y no molesta a nadie. Es la
   * mitad del aprendizaje; la otra la escribe `resolve`.
   */
  async record(input: RecordUnresolvedInput): Promise<{
    status: UnresolvedStatus;
    resolvedCategoryCode?: string;
    id?: string;
    occurrenceCount?: number;
  }> {
    const normalizedValue = this.normalize(input.rawValue);
    if (normalizedValue === '') return { status: 'IGNORED' };

    const aprendido = await this.lookupAlias(input.tenantId, normalizedValue);
    if (aprendido !== null) {
      return { status: 'AUTO_RESOLVED', resolvedCategoryCode: aprendido };
    }

    const sugerida = input.candidates?.[0];
    const alternativas = (input.candidates ?? []).slice(1, 5);

    /*
     * `upsert` sobre la clave única y no «buscar y luego crear»: dos procesos
     * que detecten el mismo término a la vez llegarían los dos a la rama de
     * creación y uno reventaría con violación de unicidad. Aquí la carrera la
     * arbitra la base y el segundo simplemente suma una aparición.
     */
    const fila = await this.prisma.unresolvedClassification.upsert({
      where: {
        tenantId_source_normalizedValue: {
          tenantId: input.tenantId,
          source: input.source,
          normalizedValue,
        },
      },
      create: {
        tenantId: input.tenantId,
        rawValue: input.rawValue,
        normalizedValue,
        source: input.source,
        context: (input.context ?? {}) as Prisma.InputJsonValue,
        suggestedCategoryCode: sugerida?.categoryCode ?? null,
        confidence: sugerida === undefined ? null : new Prisma.Decimal(sugerida.confidence),
        alternatives: alternativas as unknown as Prisma.InputJsonValue,
        status: 'PENDING',
      },
      update: {
        // El valor original NO se toca: la primera forma en que llegó es la que
        // se audita. Sólo se actualiza lo que describe la recurrencia y la mejor
        // recomendación disponible hoy.
        occurrenceCount: { increment: 1 },
        lastSeenAt: new Date(),
        ...(sugerida === undefined
          ? {}
          : {
              suggestedCategoryCode: sugerida.categoryCode,
              confidence: new Prisma.Decimal(sugerida.confidence),
              alternatives: alternativas as unknown as Prisma.InputJsonValue,
            }),
      },
    });

    // Sólo la PRIMERA vez: una notificación por aparición convertiría la bandeja
    // del administrador en ruido y escondería justo lo que hay que ver.
    if (fila.occurrenceCount === 1) {
      await this.notifyAdmin(fila, input.correlationId);
    }
    return {
      status: fila.status as UnresolvedStatus,
      id: fila.id.toString(),
      occurrenceCount: fila.occurrenceCount,
    };
  }

  /**
   * ¿Alguien enseñó ya qué significa este término?
   *
   * Los alias son el mecanismo de aprendizaje del catálogo, y se consultan por
   * el valor normalizado para que la forma exacta en que llegue no importe.
   */
  private async lookupAlias(tenantId: bigint, normalizedValue: string): Promise<string | null> {
    const alias = await this.prisma.semanticEntityAlias.findFirst({
      where: {
        tenantId,
        entityType: 'CATEGORIA',
        isActive: true,
        alias: normalizedValue,
      },
      select: { canonicalName: true },
    });
    return alias?.canonicalName ?? null;
  }

  /**
   * Avisa a quien puede resolverlo.
   *
   * Reutiliza la bandeja del motor —`Notification`, dirigida por ROL porque los
   * usuarios viven en el proveedor de identidad— en vez de inventar un canal
   * propio. El enlace lleva directo al registro pendiente: un aviso que obliga a
   * buscar el caso a mano no ahorra trabajo, lo mueve.
   */
  private async notifyAdmin(
    fila: { id: bigint; tenantId: bigint; rawValue: string; suggestedCategoryCode: string | null },
    correlationId?: string,
  ): Promise<void> {
    const sugerencia =
      fila.suggestedCategoryCode === null
        ? 'sin recomendación: el motor no encontró ninguna candidata suficiente'
        : `recomendación: ${fila.suggestedCategoryCode}`;
    await this.prisma.$transaction((tx) =>
      this.notifications.createMany(tx, [
        {
          tenantId: fila.tenantId,
          recipientRole: ADMIN_ROLE,
          category: 'CLASSIFICATION',
          priority: 'NORMAL',
          title: 'Hay un valor pendiente de clasificar',
          body: `«${fila.rawValue.slice(0, 200)}» no se pudo asignar a ninguna categoría (${sugerencia}).`,
          entityType: 'UnresolvedClassification',
          entityId: fila.id.toString(),
          actionUrl: `/workers/semantic-analysis?vista=pendientes&pendiente=${fila.id.toString()}`,
          eventType: NOTIFICATION_EVENT,
          correlationId,
        },
      ]),
    );
    this.logger.log(`Pendiente de clasificación ${fila.id.toString()} notificado al administrador`);
  }

  /** Bandeja de pendientes, lo más frecuente primero: es lo que más cuesta dejar sin resolver. */
  async list(
    tenantId: bigint,
    options: { status?: UnresolvedStatus; search?: string; take?: number } = {},
  ) {
    const filas = await this.prisma.unresolvedClassification.findMany({
      where: {
        tenantId,
        status: options.status ?? 'PENDING',
        ...(options.search
          ? { normalizedValue: { contains: this.normalize(options.search) } }
          : {}),
      },
      orderBy: [{ occurrenceCount: 'desc' }, { lastSeenAt: 'desc' }],
      take: Math.min(options.take ?? 100, 500),
    });
    return filas.map((fila) => this.present(fila));
  }

  async counts(tenantId: bigint): Promise<{ pending: number }> {
    return {
      pending: await this.prisma.unresolvedClassification.count({
        where: { tenantId, status: 'PENDING' },
      }),
    };
  }

  private present(fila: {
    id: bigint;
    rawValue: string;
    normalizedValue: string;
    source: string;
    context: unknown;
    suggestedCategoryCode: string | null;
    confidence: Prisma.Decimal | null;
    alternatives: unknown;
    occurrenceCount: number;
    firstSeenAt: Date;
    lastSeenAt: Date;
    status: string;
    resolvedCategoryCode: string | null;
    resolvedBy: string | null;
    resolvedAt: Date | null;
    resolutionType: string | null;
  }) {
    return {
      id: fila.id.toString(),
      rawValue: fila.rawValue,
      normalizedValue: fila.normalizedValue,
      source: fila.source,
      context: fila.context,
      suggestedCategoryCode: fila.suggestedCategoryCode,
      confidence: fila.confidence === null ? null : Number(fila.confidence),
      alternatives: fila.alternatives,
      occurrenceCount: fila.occurrenceCount,
      firstSeenAt: fila.firstSeenAt,
      lastSeenAt: fila.lastSeenAt,
      status: fila.status,
      resolvedCategoryCode: fila.resolvedCategoryCode,
      resolvedBy: fila.resolvedBy,
      resolvedAt: fila.resolvedAt,
      resolutionType: fila.resolutionType,
    };
  }

  notFound(id: string): DomainException {
    return new DomainException(
      'UNRESOLVED_CLASSIFICATION_NOT_FOUND',
      `No existe el pendiente ${id}.`,
      HttpStatus.NOT_FOUND,
    );
  }
}
