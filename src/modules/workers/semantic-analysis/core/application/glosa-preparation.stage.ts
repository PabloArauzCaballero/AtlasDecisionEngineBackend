import { Injectable } from '@nestjs/common';
import { CatalogCache } from './catalog-cache';
import { EntityResolver } from './entity-resolver';
import { TextNormalizer } from './text-normalizer';
import {
  ResolvedEntity,
  SemanticAnalysisRequest,
  SemanticCategory,
} from '../domain/semantic-analysis.types';

/** La glosa lista para clasificar, con el catálogo del tenant contra el que se clasifica. */
export interface PreparedGlosa {
  categories: readonly SemanticCategory[];
  /** Firma del catálogo: la caché de clasificación se acota con ella. */
  signature: string;
  normalizedText: string;
  entities: readonly ResolvedEntity[];
}

/** Carga el catálogo del tenant, normaliza la glosa y resuelve sus entidades. */
@Injectable()
export class GlosaPreparationStage {
  public constructor(
    private readonly catalog: CatalogCache,
    private readonly normalizer: TextNormalizer,
    private readonly entityResolver: EntityResolver,
  ) {}

  public async prepare(request: SemanticAnalysisRequest): Promise<PreparedGlosa> {
    const { categories, aliases, signature } = await this.catalog.load(request.tenantId);
    /*
     * Dos textos, y no por comodidad: el resolutor de entidades busca los
     * nombres canónicos, así que necesita los alias YA desplegados; el
     * clasificador necesita lo contrario —la glosa como el banco la escribió y
     * sin los identificadores que la ahogan—. Compartir un solo texto obligaba a
     * elegir cuál de los dos trabajaba mal, y el que trabajaba mal era el que
     * decide la categoría.
     *
     * `normalizedText` es el que se guarda y se enseña porque es el que se
     * clasificó: una traza que mostrara otro texto no explicaría el veredicto.
     */
    const textoConAlias = this.normalizer.normalize(request.text, aliases);
    const normalizedText = this.normalizer.forClassification(request.text, aliases);
    const entities = this.entityResolver.resolve(textoConAlias, aliases);
    return { categories, signature, normalizedText, entities };
  }
}
