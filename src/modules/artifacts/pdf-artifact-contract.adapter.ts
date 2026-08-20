/**
 * El contrato de salida de un artefacto, para el generador documental.
 *
 * Vive AQUÍ y no en `src/pdf-worker/` a propósito: es la pieza que conoce Prisma
 * y el esquema del motor, y meterla dentro del worker rompería lo único que
 * permite desplegarlo aparte. El worker declara el puerto; el motor lo satisface
 * al componer el módulo. La prueba de arquitectura vigila esa dirección.
 *
 * **El tipo hay que resolverlo, no leerlo.** `decision_output_contract_field` no
 * guarda el tipo de dato: declara de DÓNDE sale el valor (`sourceKind` +
 * `sourceRef`) y lo hereda de ahí. Un campo que viene de una variable del
 * catálogo tiene el tipo de esa variable; uno que viene de una expresión no lo
 * tiene declarado en ninguna parte. Por eso el puerto admite `unknown` como
 * respuesta legítima y la comprobación de compatibilidad lo trata como «no se
 * pudo comprobar» en vez de como «encaja».
 */
import { Injectable } from '@nestjs/common';
import type {
  ArtifactContractPort,
  ArtifactFieldType,
  ArtifactOutputContract,
  ArtifactOutputField,
  ArtifactSummary,
} from '../../pdf-worker/application/ports/artifact-contract.port';
import { VersionStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Tipos canónicos del catálogo de variables → vocabulario del generador. */
const TIPO_POR_DATA_TYPE: Readonly<Record<string, ArtifactFieldType>> = {
  STRING: 'string',
  TEXT: 'string',
  NUMBER: 'number',
  DECIMAL: 'number',
  MONEY: 'number',
  PERCENTAGE: 'number',
  INTEGER: 'integer',
  BOOLEAN: 'boolean',
  DATE: 'date',
  DATETIME: 'date',
  ENUM: 'enum',
  CATEGORICAL: 'enum',
  ARRAY: 'array',
  LIST: 'array',
  OBJECT: 'object',
  JSON: 'object',
};

/**
 * Estados en los que el contrato de salida ya no se mueve.
 *
 * Un borrador puede cambiar de campos mañana, y un documento vinculado a él
 * dejaría de imprimir sin que nadie tocara el documento.
 */
// Mutable y tipado con el enum de Prisma: un `as const` lo vuelve `readonly` y
// el filtro `in` no lo acepta, con un error que se propaga hasta hacer ilegible
// el `select` entero.
const VERSIONES_ESTABLES: VersionStatus[] = [
  // `COMPILED` entra: el contrato de salida ya está fijado y validado. Excluirlo
  // dejaba fuera artefactos perfectamente casables —dos de los tres sembrados—
  // y la pantalla mostraba un catálogo casi vacío que se leía como «aquí no hay
  // nada que casar». Lo que sigue fuera es el BORRADOR, que sí puede cambiar de
  // campos bajo los pies de quien lo imprime.
  VersionStatus.COMPILED,
  VersionStatus.APPROVED,
  VersionStatus.DEPLOYED_TO_DEV,
  VersionStatus.DEPLOYED_TO_TEST,
  VersionStatus.DEPLOYED_TO_STAGING,
  VersionStatus.DEPLOYED_TO_PROD,
];

@Injectable()
export class PdfArtifactContractAdapter implements ArtifactContractPort {
  readonly available = true;

  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<readonly ArtifactSummary[]> {
    const versions = await this.prisma.decisionArtifactVersion.findMany({
      // Sólo las versiones ya aprobadas o desplegadas. Ofrecer un BORRADOR para
      // casar con un documento invita a vincularse a un contrato que todavía
      // puede cambiar bajo los pies del que lo imprime.
      where: { status: { in: VERSIONES_ESTABLES } },
      select: {
        id: true,
        semanticVersion: true,
        artifact: { select: { artifactCode: true, name: true } },
        _count: { select: { outputContractFields: true } },
      },
      orderBy: { id: 'desc' },
      take: 200,
    });

    return versions
      .filter((version) => version._count.outputContractFields > 0)
      .map((version) => ({
        artifactId: version.artifact.artifactCode,
        artifactVersion: version.semanticVersion,
        title: version.artifact.name,
        outputFieldCount: version._count.outputContractFields,
      }));
  }

  async get(artifactId: string, version?: string): Promise<ArtifactOutputContract | undefined> {
    const found = await this.prisma.decisionArtifactVersion.findFirst({
      where: {
        artifact: { artifactCode: artifactId },
        ...(version ? { semanticVersion: version } : { status: { in: VERSIONES_ESTABLES } }),
      },
      select: {
        semanticVersion: true,
        artifact: { select: { artifactCode: true, name: true } },
        outputContractFields: {
          select: {
            fieldCode: true,
            name: true,
            description: true,
            sourceKind: true,
            sourceRef: true,
            absenceReasons: true,
            valueMappingJson: true,
            exampleJson: true,
          },
        },
      },
      // Sin versión, la última publicada: es la que va a producir las decisiones.
      orderBy: { versionNumber: 'desc' },
    });
    if (!found) return undefined;

    const fields = await Promise.all(
      found.outputContractFields.map((field) => this.describe(field)),
    );

    return {
      artifactId: found.artifact.artifactCode,
      artifactVersion: found.semanticVersion,
      title: found.artifact.name,
      fields,
    };
  }

  private async describe(field: {
    fieldCode: string;
    name: string;
    description: string | null;
    sourceKind: string;
    sourceRef: string;
    absenceReasons: string[];
    valueMappingJson: unknown;
    exampleJson: unknown;
  }): Promise<ArtifactOutputField> {
    return {
      fieldCode: field.fieldCode,
      name: field.name,
      description: field.description ?? undefined,
      type: await this.resolveType(field.sourceKind, field.sourceRef, field.valueMappingJson),
      // `absenceReasons` sólo lo tienen los campos que PUEDEN faltar; que esté
      // vacío es la forma en que el contrato declara «esto sale siempre».
      required: field.absenceReasons.length === 0,
      allowedValues: valoresPublicados(field.valueMappingJson),
      example: field.exampleJson ?? undefined,
    };
  }

  /**
   * Resuelve el tipo siguiendo el origen declarado.
   *
   * Sólo se resuelve con certeza cuando el valor viene de una variable del
   * catálogo, que es quien declara el tipo. Una expresión o una constante no lo
   * traen, y devolver `string` «porque suele serlo» sería inventar: se responde
   * `unknown` y quien compara lo dirá como advertencia.
   */
  private async resolveType(
    sourceKind: string,
    sourceRef: string,
    valueMapping: unknown,
  ): Promise<ArtifactFieldType> {
    // Un mapeo de valores publica un conjunto cerrado, sea cual sea el origen.
    if (valoresPublicados(valueMapping)) return 'enum';
    if (sourceKind !== 'NODE' && sourceKind !== 'REFERENCE') return 'unknown';

    // El tipo lo declara la VERSIÓN de la variable, no su definición: la
    // definición sólo aporta el código. Se toma la más reciente, que es la que
    // gobierna lo que el artefacto va a emitir.
    const version = await this.prisma.decisionVariableVersion
      .findFirst({
        where: { definition: { variableCode: sourceRef } },
        select: { dataType: true },
        orderBy: { id: 'desc' },
      })
      .catch(() => null);
    if (!version) return 'unknown';

    return TIPO_POR_DATA_TYPE[version.dataType.toUpperCase()] ?? 'unknown';
  }
}

/** Los valores que el artefacto puede PUBLICAR, no los internos que los originan. */
function valoresPublicados(valueMapping: unknown): readonly string[] | undefined {
  if (!valueMapping || typeof valueMapping !== 'object' || Array.isArray(valueMapping)) {
    return undefined;
  }
  const values = Object.values(valueMapping as Record<string, unknown>)
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value);
  return values.length > 0 ? [...new Set(values)] : undefined;
}
