/**
 * Contrato del MANIFIESTO DE CATÁLOGO: cómo este backend se describe a sí mismo.
 *
 * ## Por qué existe
 *
 * El portal interno de ATLAS presenta un único catálogo de datos y un único inventario de
 * endpoints para todo el ecosistema, pero hasta ahora sólo sabía mirar dentro de Atlas Backend:
 * introspecciona SU `information_schema` y SU router. El motor de decisión y el ERP quedaban
 * fuera, no por olvido, sino porque nadie podía preguntarles «¿qué tablas tienes y qué rutas
 * expones?» sin abrir su base de datos desde otro proceso.
 *
 * Este manifiesto es esa pregunta, hecha por HTTP y contestada por el único que la sabe de
 * verdad: el propio servicio, en runtime, a partir de su router vivo y de su propio
 * `information_schema`. Un fichero estático copiado en el otro repo habría envejecido con el
 * primer endpoint nuevo, y esa es exactamente la clase de catálogo que hace que un operador
 * deje de creerle al panel.
 *
 * ## Por qué la forma es idéntica en los tres backends
 *
 * Atlas Backend guarda los tres bloques en las MISMAS tablas (`system_endpoint_catalog`,
 * `system_data_entity_catalog`) con una columna de bloque. Si cada servicio hablara su propio
 * dialecto, el federador acabaría con un traductor por bloque y el catálogo dejaría de ser
 * comparable: «PII» significaría una cosa aquí y otra allá. Un contrato común obliga a que la
 * clasificación sea la misma pregunta en todos.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CatalogManifestBlockDto {
  @ApiProperty({ example: 'DECISION_ENGINE', description: 'Código estable del bloque dentro del ecosistema ATLAS.' })
  code!: string;

  @ApiProperty({ example: 'ATLAS Decision Engine', description: 'Nombre legible del bloque.' })
  name!: string;

  @ApiProperty({ example: 'AtlasDecisionEngineBackend', description: 'Repositorio que contiene el bloque.' })
  repository!: string;

  @ApiProperty({ example: 'atlas-decision-engine-backend', description: 'Nombre del servicio que responde.' })
  service!: string;

  @ApiProperty({ example: '2.0.0', description: 'Versión de build que produjo este manifiesto.' })
  version!: string;

  @ApiProperty({ example: 'local', description: 'Commit de la build que produjo este manifiesto.' })
  commit!: string;

  @ApiProperty({ example: '/v1', description: 'Prefijo global de rutas del servicio, vacío si no lo tiene.' })
  routePrefix!: string;

  @ApiProperty({ example: '2026-08-20T11:00:00.000Z', description: 'Instante en el que se calculó el manifiesto.' })
  generatedAt!: string;
}

export class CatalogManifestEndpointDto {
  @ApiProperty({ example: 'DE_GET_V1_ARTIFACTS', description: 'Código estable y único del endpoint dentro del bloque.' })
  code!: string;

  @ApiProperty({ example: 'artifacts', description: 'Módulo del bloque que lo expone.' })
  module!: string;

  @ApiProperty({ example: 'GET' })
  method!: string;

  @ApiProperty({ example: '/v1/artifacts', description: 'Ruta completa tal y como la sirve el proceso.' })
  fullPath!: string;

  @ApiProperty({ example: 'ArtifactController', nullable: true })
  controllerName!: string | null;

  @ApiProperty({ example: 'list', nullable: true })
  handlerName!: string | null;

  @ApiProperty({ example: 'Lista de artefactos de decisión.', description: 'Resumen declarado en el contrato OpenAPI.' })
  summary!: string;

  @ApiProperty({ example: true, description: 'Falso sólo cuando la ruta está marcada como pública.' })
  requiresAuth!: boolean;

  @ApiProperty({ type: [String], example: ['RISK_ANALYST', 'AUDITOR'], description: 'Roles que el guard acepta.' })
  allowedRoles!: string[];

  @ApiProperty({ example: 'management', nullable: true, description: 'Plano de la API al que pertenece la ruta.' })
  audience!: string | null;

  /**
   * El CONTRATO de entrada, en el formato abreviado que ATLAS ingiere: `{ campo: 'tipo|required' }`.
   *
   * Opcional porque sale del documento OpenAPI y éste puede no haberse generado. Sin él, ATLAS
   * cataloga el endpoint sin un solo campo y su laboratorio de QA no puede derivar un payload de
   * prueba — hay que escribirlo a mano, que es lo que hace que nadie pruebe el caso inválido.
   */
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { artifactCode: 'string|required', environmentCode: 'string|required' },
    description: 'Campos del cuerpo con su tipo y obligatoriedad.',
  })
  minPayloadSchema?: Record<string, string>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' }, description: 'Parámetros de query.' })
  queryParamsSchema?: Record<string, string>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' }, description: 'Parámetros de ruta.' })
  pathParamsSchema?: Record<string, string>;

  /** Códigos de éxito DECLARADOS. Ausente significa «no se declara», no «devuelve 200». */
  @ApiPropertyOptional({ type: [Number], example: [200, 201] })
  expectedStatusCodes?: number[];

  @ApiProperty({ example: true, description: 'Verdadero para GET y HEAD: no muta estado.' })
  isReadonly!: boolean;

  @ApiProperty({ example: false, description: 'Verdadero para DELETE: destruye estado de forma no recuperable.' })
  isDestructive!: boolean;

  @ApiProperty({ example: 'LOW', enum: ['LOW', 'MEDIUM', 'HIGH'] })
  riskLevel!: string;
}

export class CatalogManifestDataEntityDto {
  @ApiProperty({ example: 'public' })
  schemaName!: string;

  @ApiProperty({ example: 'decision_artifact' })
  tableName!: string;

  @ApiProperty({ example: 'Decision artifact', description: 'Nombre legible derivado del nombre de tabla.' })
  entityName!: string;

  @ApiProperty({ example: 'artifacts', description: 'Módulo del bloque al que se atribuye la tabla.' })
  module!: string;

  @ApiProperty({ example: 12 })
  columnCount!: number;

  @ApiProperty({ type: [String], example: ['id'] })
  primaryKeyColumns!: string[];

  @ApiProperty({ example: false, description: 'Heurística por nombre de columna: datos personales identificables.' })
  containsPii!: boolean;

  @ApiProperty({ example: false, description: 'Heurística por nombre de columna: importes, saldos o límites.' })
  containsFinancialData!: boolean;

  @ApiProperty({ example: true, description: 'Heurística por nombre de columna: puntajes, decisiones o políticas.' })
  containsRiskData!: boolean;

  @ApiProperty({ example: true, description: 'La tabla sostiene evidencia que una auditoría necesita leer.' })
  isAuditCritical!: boolean;

  @ApiProperty({ example: 'Guarda el artefacto versionado que decide.', description: 'Propósito de negocio inferido.' })
  businessPurpose!: string;
}

export class CatalogManifestDto {
  @ApiProperty({ type: CatalogManifestBlockDto })
  block!: CatalogManifestBlockDto;

  @ApiProperty({ type: [CatalogManifestEndpointDto] })
  endpoints!: CatalogManifestEndpointDto[];

  @ApiProperty({ type: [CatalogManifestDataEntityDto] })
  dataEntities!: CatalogManifestDataEntityDto[];
}
