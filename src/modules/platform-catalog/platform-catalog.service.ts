/**
 * Compone el manifiesto que este bloque publica sobre sí mismo.
 *
 * No guarda nada ni consulta un catálogo propio: junta las dos introspecciones vivas —router y
 * `information_schema`— y las presenta con la identidad del bloque. Deliberadamente sin caché:
 * se pide desde el federador de Atlas Backend cada varios minutos, no en un camino caliente, y
 * una caché aquí sólo serviría para que el catálogo mostrara una foto vieja justo después de un
 * despliegue, que es el momento en el que más importa que sea nueva.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CatalogManifestDto } from './platform-catalog.dto';
import { RouteInventoryService } from './route-inventory.service';
import { SchemaInventoryService } from './schema-inventory.service';

/** Prefijos de tabla → módulo del motor. Lo que no encaja se declara sin clasificar, no se inventa. */
const TABLE_MODULE_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['artifact', 'artifacts'],
  ['decision', 'runtime'],
  ['deployment', 'deployments'],
  ['compiled', 'deployments'],
  ['environment', 'deployments'],
  ['variable', 'variables'],
  ['library', 'libraries'],
  ['calculated', 'calculated-fields'],
  ['test', 'testing'],
  ['qa', 'qa-lab'],
  ['approval', 'governance'],
  ['policy', 'governance'],
  ['objective', 'traceability'],
  ['audit', 'audit'],
  ['outbox', 'outbox-relay'],
  ['notification', 'notifications'],
  ['outcome', 'model-monitoring'],
  ['model', 'model-monitoring'],
  ['manual_review', 'manual-review'],
  ['data_subject', 'privacy'],
  ['consent', 'privacy'],
  ['integration_client', 'security'],
  ['identity', 'security'],
  ['tenant', 'platform'],
  ['job', 'jobs'],
];

@Injectable()
export class PlatformCatalogService {
  constructor(
    private readonly config: ConfigService,
    private readonly routes: RouteInventoryService,
    private readonly schema: SchemaInventoryService,
  ) {}

  async manifest(): Promise<CatalogManifestDto> {
    const dataEntities = await this.schema.collect((tableName) => moduleForTable(tableName));
    return {
      block: {
        code: 'DECISION_ENGINE',
        name: 'ATLAS Decision Engine',
        repository: 'AtlasDecisionEngineBackend',
        service: 'atlas-decision-engine-backend',
        version: this.config.get<string>('BUILD_VERSION') ?? 'unknown',
        commit: this.config.get<string>('COMMIT_SHA') ?? 'unknown',
        // El motor no monta prefijo global: sus rutas ya llevan `/v1` en el controlador.
        routePrefix: '',
        generatedAt: new Date().toISOString(),
      },
      endpoints: this.routes.collect('', 'DE'),
      dataEntities,
    };
  }
}

function moduleForTable(tableName: string): string {
  const normalized = tableName.toLowerCase();
  for (const [prefix, moduleName] of TABLE_MODULE_PREFIXES) {
    if (normalized.startsWith(prefix)) return moduleName;
  }
  return 'sin-clasificar';
}
