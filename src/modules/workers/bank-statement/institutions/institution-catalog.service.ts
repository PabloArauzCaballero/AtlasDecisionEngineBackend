import { Injectable, Logger } from '@nestjs/common';
import type { FinancialInstitution } from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { isPotentiallyCatastrophic } from '../../../../common/validation/safe-regex';
import type {
  BoliviaInstitution,
  InstitutionKind,
  InstitutionLicenseStatus,
} from '../core/institutions/bolivia-institutions';
import {
  resolvedRegistry,
  type InstitutionRegistry,
} from '../core/institutions/institution-registry';
import {
  parseSignalDescriptor,
  type InstitutionSignalDescriptor,
} from '../core/engine/similarity/institution-signals';

/**
 * El padrón administrable, leído por el motor sin salir a la base en cada
 * documento.
 *
 * El motor pregunta el padrón de forma **síncrona**, una vez por documento y en
 * el camino caliente; la tabla vive en Postgres. Esta clase es lo que concilia
 * las dos cosas: mantiene una instantánea por tenant, la sirve al instante, y la
 * refresca por detrás cuando caduca o cuando alguien escribe en el padrón.
 *
 * Una instantánea vencida NO bloquea al documento que llega: se sirve la
 * anterior y se pide la nueva. Es la decisión importante de este archivo, y va en
 * la dirección menos obvia —preferir un padrón de hace un minuto a hacer esperar
 * a un extracto—, porque el coste de las dos opciones no se parece: procesar un
 * documento con el padrón de hace un minuto no cambia el resultado salvo en el
 * minuto exacto en que alguien revocó una licencia; hacer que cada documento
 * espere una consulta convierte una tabla lenta en un worker parado.
 */
const TTL_MS = 60_000;

interface Snapshot {
  readonly institutions: readonly BoliviaInstitution[];
  readonly loadedAt: number;
}

@Injectable()
export class InstitutionCatalogService {
  private readonly logger = new Logger(InstitutionCatalogService.name);
  private readonly snapshots = new Map<string, Snapshot>();
  /** Refrescos en vuelo, para no pedir la misma tabla ocho veces a la vez. */
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * El padrón de un tenant, en la forma que el motor consume.
   *
   * Devuelve un `InstitutionRegistry` y no una lista porque el motor se
   * construye una vez y vive días: con una lista, revocar una licencia no
   * tendría efecto hasta reiniciar el proceso.
   */
  registryFor(tenantId: bigint): InstitutionRegistry {
    return resolvedRegistry(() => this.snapshotFor(tenantId));
  }

  /** Marca el padrón del tenant como vencido. Lo llama toda escritura del CRUD. */
  invalidate(tenantId: bigint): void {
    this.snapshots.delete(tenantId.toString());
  }

  /** Carga inmediata, para quien necesita el padrón fresco ya (pruebas, arranque). */
  async refresh(tenantId: bigint): Promise<readonly BoliviaInstitution[]> {
    await this.load(tenantId);
    return this.snapshots.get(tenantId.toString())?.institutions ?? [];
  }

  /**
   * Espera a la PRIMERA carga del padrón de un tenant, y sólo a ésa.
   *
   * ## El defecto que cierra
   *
   * En frío no hay instantánea, así que `snapshotFor` devuelve `undefined`, el padrón cae a la
   * nómina compilada y `isAuthoritative()` responde `false`. La compuerta de emisor se lo toma en
   * serio —con razón: «licencia vigente» sería entonces una afirmación que nadie comprobó— y manda
   * el documento a revisión humana con `padron-no-vigente`.
   *
   * El resultado medido: **el primer extracto después de cada despliegue acababa en la cola**, con
   * un motivo que apunta a la entidad cuando lo que pasó fue que el proceso acababa de arrancar. Y
   * como se cura solo en el siguiente documento, es de los defectos que nadie llega a diagnosticar:
   * se mira el caso, se aprueba a mano, y no vuelve a pasar hasta el despliegue siguiente.
   *
   * ## Por qué esto NO reintroduce la espera que el diseño evita
   *
   * Con instantánea —aunque esté vencida— devuelve al instante y deja que el refresco ocurra por
   * detrás. Lo que se espera es únicamente la carga inicial, que ocurre una vez por tenant y por
   * proceso. La decisión de preferir un padrón de hace un minuto a hacer esperar a un extracto
   * sigue intacta; lo que cambia es que «hace un minuto» ahora existe desde el primer documento.
   */
  async ensureLoaded(tenantId: bigint): Promise<void> {
    if (this.snapshots.has(tenantId.toString())) return;
    await this.load(tenantId);
  }

  private snapshotFor(tenantId: bigint): readonly BoliviaInstitution[] | undefined {
    const key = tenantId.toString();
    const snapshot = this.snapshots.get(key);
    if (!snapshot || Date.now() - snapshot.loadedAt > TTL_MS) {
      void this.load(tenantId);
    }
    return snapshot?.institutions;
  }

  private load(tenantId: bigint): Promise<void> {
    const key = tenantId.toString();
    const running = this.inFlight.get(key);
    if (running) return running;

    const work = this.prisma.financialInstitution
      .findMany({ where: { tenantId, isActive: true }, orderBy: { code: 'asc' } })
      .then((rows) => {
        this.snapshots.set(key, {
          institutions: rows.map((row) => this.toInstitution(row)),
          loadedAt: Date.now(),
        });
      })
      .catch((error: unknown) => {
        /*
         * Un fallo de carga NO vacía la instantánea anterior ni escribe una
         * vacía. Un padrón vacío no es una afirmación sobre el sistema
         * financiero boliviano —es un fallo de lectura—, y desde que la
         * compuerta de emisor exige atribución, tomárselo en serio rechazaría
         * todos los extractos a la vez. `resolvedRegistry` cae a la nómina
         * compilada, que es vieja pero cierta.
         */
        this.logger.error(
          `No se pudo cargar el padrón de entidades del tenant ${key}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      })
      .finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, work);
    return work;
  }

  private toInstitution(row: FinancialInstitution): BoliviaInstitution {
    return {
      code: row.code,
      name: row.name,
      kind: row.kind as InstitutionKind,
      licenseStatus: row.licenseStatus as InstitutionLicenseStatus,
      retailDeposits: row.retailDeposits,
      markers: this.compile(row.markers, row.code, 'marcadores'),
      exclusions: this.compile(row.exclusions, row.code, 'exclusiones'),
      note: row.note ?? undefined,
      expectedSignals: this.descriptor(row),
    };
  }

  /**
   * El descriptor de señales de la fila, o nada si no lo tiene o está roto.
   *
   * Un descriptor inválido NO tumba la entidad, por lo mismo que un marcador mal
   * escrito no la tumba: perder el descriptor degrada una MEDIDA —el parecido
   * pasa a `NO_DESCRIPTOR` y no afecta a ningún desenlace—, mientras que perder
   * la entidad convierte sus extractos en «emisor no reconocido», que sí es un
   * rechazo. El fallo pequeño no debe producir la consecuencia grande.
   *
   * Se registra en ERROR y no en WARN a propósito: un descriptor que no compila
   * es trabajo de calibración perdido y nadie lo va a notar por la vía normal,
   * porque el sistema sigue funcionando exactamente igual.
   */
  private descriptor(row: FinancialInstitution): InstitutionSignalDescriptor | undefined {
    if (row.expectedSignals === null || row.expectedSignals === undefined) return undefined;
    try {
      return parseSignalDescriptor(row.expectedSignals);
    } catch (error) {
      this.logger.error(
        `El descriptor de señales de ${row.code} no es válido y se ignora: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  /**
   * Compila los patrones de una fila, descartando el que no sirva.
   *
   * Descartar y seguir, en vez de dejar caer la entidad entera, es deliberado:
   * un marcador roto entre cinco degrada el reconocimiento de ESA entidad; una
   * entidad que desaparece del padrón por un patrón mal escrito hace que sus
   * extractos pasen a «emisor no reconocido», que es un rechazo. El fallo
   * pequeño no debe producir la consecuencia grande.
   *
   * La comprobación anti-ReDoS se repite aquí aunque el CRUD ya la haga al
   * escribir: la fila pudo entrar por una siembra, por una migración o por una
   * versión anterior del validador, y este patrón se ejecuta contra la carátula
   * de CADA documento que entra.
   */
  private compile(value: unknown, code: string, field: string): readonly RegExp[] {
    if (!Array.isArray(value)) return [];
    const compiled: RegExp[] = [];
    for (const source of value) {
      if (typeof source !== 'string' || source.length === 0) continue;
      if (isPotentiallyCatastrophic(source)) {
        this.logger.warn(`Patrón descartado por riesgo de ReDoS en ${code}.${field}: ${source}`);
        continue;
      }
      try {
        compiled.push(new RegExp(source, 'i'));
      } catch {
        this.logger.warn(`Patrón inválido en ${code}.${field}: ${source}`);
      }
    }
    return compiled;
  }
}
