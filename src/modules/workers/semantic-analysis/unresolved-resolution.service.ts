import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { DomainException } from '../../../common/errors/domain-exception';
import { SemanticCategoryService } from './semantic-category.service';
import {
  UnresolvedClassificationService,
  type ResolutionType,
} from './unresolved-classification.service';
import type { UpsertSemanticCategoryDto } from './semantic-category.dto';

/**
 * Lo que pasa cuando un administrador decide.
 *
 * Vive aparte de la detección por una razón de responsabilidad: detectar es
 * barato y ocurre miles de veces; resolver ocurre una vez, cambia el catálogo y
 * tiene que quedar auditado. Mezclarlos haría que la ruta caliente cargara con
 * el peso de la que no lo es.
 *
 * **Toda resolución escribe un alias.** Ése es el aprendizaje: el término que
 * hoy costó una decisión humana mañana se resuelve solo, y por eso la misma
 * glosa no vuelve a aparecer en la bandeja. Sin ese paso, el administrador
 * resolvería el mismo caso cada mes.
 */

export interface ResolveInput {
  tenantId: bigint;
  id: string;
  resolutionType: ResolutionType;
  /** Categoría elegida. Obligatoria salvo al descartar o al dejarlo sin categorizar. */
  categoryCode?: string;
  /** Categoría nueva, cuando se crea sobre la marcha. */
  newCategory?: UpsertSemanticCategoryDto;
  resolvedBy: string;
}

/** Resoluciones que NO asignan categoría: cierran el caso sin enseñar nada. */
const SIN_CATEGORIA: ReadonlySet<ResolutionType> = new Set(['DISCARD', 'NOT_CATEGORIZED']);

@Injectable()
export class UnresolvedResolutionService {
  private readonly logger = new Logger(UnresolvedResolutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: SemanticCategoryService,
    private readonly unresolved: UnresolvedClassificationService,
  ) {}

  async resolve(input: ResolveInput) {
    const pendiente = await this.prisma.unresolvedClassification.findFirst({
      where: { tenantId: input.tenantId, id: BigInt(input.id) },
    });
    if (pendiente === null) throw this.unresolved.notFound(input.id);
    /*
     * Idempotencia: resolver dos veces el mismo pendiente no puede duplicar
     * alias ni categorías. Se responde con lo que ya se decidió en lugar de
     * repetir el efecto, que es lo que espera cualquiera que pulse dos veces.
     */
    if (pendiente.status !== 'PENDING') {
      return { id: input.id, status: pendiente.status, alreadyResolved: true };
    }

    const categoryCode = await this.categoriaElegida(input);

    await this.prisma.$transaction(async (tx) => {
      await tx.unresolvedClassification.update({
        where: { id: pendiente.id },
        data: {
          status: this.estadoFinal(input.resolutionType),
          resolvedCategoryCode: categoryCode,
          resolvedBy: input.resolvedBy,
          resolvedAt: new Date(),
          resolutionType: input.resolutionType,
          /*
           * La auditoría va en la propia fila y conserva lo que el SISTEMA había
           * recomendado, no sólo lo que se eligió: sin ese contraste no se puede
           * saber si el motor está mejorando ni por qué se le llevó la contraria.
           */
          metadata: {
            suggestedAtResolution: pendiente.suggestedCategoryCode,
            confidenceAtResolution:
              pendiente.confidence === null ? null : Number(pendiente.confidence),
            occurrencesAtResolution: pendiente.occurrenceCount,
            source: pendiente.source,
          } as Prisma.InputJsonValue,
        },
      });

      if (categoryCode !== null) {
        await this.aprenderAlias(tx, input.tenantId, pendiente.normalizedValue, categoryCode);
      }
    });

    this.logger.log(
      `Pendiente ${input.id} resuelto por ${input.resolvedBy} como ${input.resolutionType}` +
        (categoryCode === null ? '' : ` → ${categoryCode}`),
    );
    return { id: input.id, status: this.estadoFinal(input.resolutionType), categoryCode };
  }

  /**
   * El alias que hace que esto no vuelva a preguntarse.
   *
   * `upsert` y no `create`: dos administradores resolviendo a la vez términos
   * equivalentes no deben chocar contra la unicidad `(tenant, tipo, alias)`.
   */
  private async aprenderAlias(
    tx: Prisma.TransactionClient,
    tenantId: bigint,
    normalizedValue: string,
    categoryCode: string,
  ): Promise<void> {
    await tx.semanticEntityAlias.upsert({
      where: {
        tenantId_entityType_alias: {
          tenantId,
          entityType: 'CATEGORIA',
          alias: normalizedValue,
        },
      },
      create: {
        tenantId,
        entityType: 'CATEGORIA',
        alias: normalizedValue,
        canonicalName: categoryCode,
        isActive: true,
      },
      update: { canonicalName: categoryCode, isActive: true },
    });
  }

  /** Qué categoría queda asignada, según lo que el administrador eligió hacer. */
  private async categoriaElegida(input: ResolveInput): Promise<string | null> {
    if (SIN_CATEGORIA.has(input.resolutionType)) return null;

    if (input.resolutionType === 'CREATE_CATEGORY') {
      if (input.newCategory === undefined) {
        throw new DomainException(
          'UNRESOLVED_NEW_CATEGORY_REQUIRED',
          'Para crear una categoría hay que enviarla.',
          HttpStatus.BAD_REQUEST,
        );
      }
      const creada = await this.categories.upsert(input.tenantId, input.newCategory);
      return creada.code;
    }

    if (input.categoryCode === undefined) {
      throw new DomainException(
        'UNRESOLVED_CATEGORY_REQUIRED',
        'Esta resolución necesita una categoría.',
        HttpStatus.BAD_REQUEST,
      );
    }
    // Se comprueba que exista: asignar a un código inventado dejaría el alias
    // apuntando al vacío y el próximo acierto automático sería un error nuevo.
    const existe = await this.prisma.semanticCategory.findUnique({
      where: { tenantId_code: { tenantId: input.tenantId, code: input.categoryCode } },
      select: { code: true },
    });
    if (existe === null) {
      throw new DomainException(
        'SEMANTIC_CATEGORY_NOT_FOUND',
        `No existe la categoría ${input.categoryCode}.`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return existe.code;
  }

  private estadoFinal(tipo: ResolutionType): string {
    if (tipo === 'DISCARD') return 'IGNORED';
    if (tipo === 'NOT_CATEGORIZED') return 'REJECTED';
    return 'RESOLVED';
  }
}
