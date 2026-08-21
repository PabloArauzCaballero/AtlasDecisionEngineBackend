/**
 * Inventario de rutas leído del ROUTER VIVO, no de un fichero.
 *
 * Nest ya sabe exactamente qué rutas sirve este proceso: lo sabe porque las montó. Recorrer sus
 * controladores con `DiscoveryService` y leer los mismos metadatos que leen los guards
 * (`PATH_METADATA`, `METHOD_METADATA`, `atlas.required-roles`, `atlas.public-route`) devuelve el
 * inventario REAL, no el inventario que alguien recordó actualizar. Un endpoint nuevo aparece en
 * el catálogo del portal en cuanto se despliega, y uno retirado desaparece; que es justo la
 * propiedad que un inventario de endpoints necesita para servir de algo en una auditoría.
 *
 * Se leen los metadatos de autorización —y no sólo el verbo y la ruta— porque el portal presenta
 * el inventario para responder «quién puede llamar a esto». Derivar los roles del nombre del
 * módulo sería adivinar; leerlos del mismo decorador que aplica el guard significa que si el
 * catálogo miente, es porque el guard también.
 */
import { Injectable, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { PUBLIC_ROUTE, REQUIRED_ROLES, REQUIRED_AUDIENCE } from '../../common/security/security.decorators';
import { CatalogManifestEndpointDto } from './platform-catalog.dto';
import { OpenApiDocumentRegistry } from './openapi-document.registry';
import {
  contractFromRequestBody,
  contractsFromParameters,
  successStatusCodes,
} from './openapi-contract.util';

/** Verbos que sólo leen. Cualquier otro muta algo y el catálogo debe decirlo. */
const READONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class RouteInventoryService {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly openApi: OpenApiDocumentRegistry,
  ) {}

  collect(routePrefix: string, blockPrefix: string): CatalogManifestEndpointDto[] {
    const endpoints: CatalogManifestEndpointDto[] = [];
    // El contrato de cada ruta, indexado por `MÉTODO ruta`. Se calcula una vez para todo el
    // recorrido: resolver `$ref` por endpoint sobre un documento de cientos de operaciones sería
    // repetir el mismo trabajo doscientas veces.
    const contracts = this.contractIndex();
    for (const wrapper of this.discovery.getControllers()) {
      const controller = wrapper.metatype as (new (...args: never[]) => object) | undefined;
      if (!controller?.prototype) continue;
      const controllerPath = this.normalize(Reflect.getMetadata(PATH_METADATA, controller));
      const moduleName = this.moduleNameOf(controller.name);

      for (const methodName of this.scanner.getAllMethodNames(controller.prototype)) {
        const prototype = controller.prototype as Record<string, unknown>;
        const handler = prototype[methodName];
        if (typeof handler !== 'function') continue;
        const verb = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
        if (verb === undefined) continue;

        const method = this.verbName(verb);
        const handlerPath = this.normalize(Reflect.getMetadata(PATH_METADATA, handler));
        const fullPath = this.joinPath(routePrefix, controllerPath, handlerPath);
        // Los roles y el plano se leen del HANDLER y, si no los declara, de la CLASE — el mismo
        // orden de resolución que usa el guard. Invertirlo haría que una ruta que restringe más
        // que su controlador se catalogara como si restringiera menos.
        const roles = this.metadataOf<string[]>(REQUIRED_ROLES, handler, controller) ?? [];
        const audience = this.metadataOf<string>(REQUIRED_AUDIENCE, handler, controller) ?? null;
        const isPublic = this.metadataOf<boolean>(PUBLIC_ROUTE, handler, controller) === true;

        endpoints.push({
          code: this.codeFor(blockPrefix, method, fullPath),
          module: moduleName,
          method,
          fullPath,
          controllerName: controller.name,
          handlerName: methodName,
          summary: this.summaryOf(handler, method, fullPath),
          requiresAuth: !isPublic,
          allowedRoles: roles,
          audience,
          isReadonly: READONLY_METHODS.has(method),
          isDestructive: method === 'DELETE',
          riskLevel: this.riskLevelOf(method, isPublic),
          ...(contracts.get(`${method} ${fullPath}`) ?? {}),
        });
      }
    }
    return endpoints.sort((left, right) => left.code.localeCompare(right.code));
  }

  /**
   * El contrato de entrada de cada ruta, leído del documento OpenAPI de este mismo proceso.
   *
   * El router vivo sabe el verbo, la ruta y los roles; los CAMPOS viven en los esquemas de
   * validación, y el documento OpenAPI es donde ya están traducidos. Sin esto, ATLAS cataloga los
   * endpoints de este bloque sin un solo campo y su laboratorio de QA no puede generar un payload
   * de prueba: hay que escribirlo a mano, que es lo que hace que nadie pruebe el caso inválido.
   *
   * Si el documento no se generó (`SWAGGER_ENABLED=false`) el índice queda vacío y el manifiesto
   * sale sin contratos, exactamente como antes. Es una mejora que se degrada, no una dependencia.
   */
  private contractIndex(): Map<string, Partial<CatalogManifestEndpointDto>> {
    const index = new Map<string, Partial<CatalogManifestEndpointDto>>();
    const document = this.openApi.get();
    if (!document) return index;

    for (const [path, item] of Object.entries(document.paths ?? {})) {
      if (!item || typeof item !== 'object') continue;
      const pathItem = item as Record<string, unknown>;
      for (const verb of ['get', 'post', 'put', 'patch', 'delete']) {
        const operation = pathItem[verb];
        if (!operation || typeof operation !== 'object') continue;
        const record = operation as Record<string, unknown>;
        const params = contractsFromParameters(document, record.parameters, pathItem.parameters);
        const body = contractFromRequestBody(document, record.requestBody);
        const codes = successStatusCodes(record.responses);
        // El documento escribe `{id}` y el router `:id`: sin normalizar, ninguna ruta con parámetro
        // casaría y justo las que reciben datos se quedarían sin contrato.
        index.set(`${verb.toUpperCase()} ${this.routerPath(path)}`, {
          ...(Object.keys(body).length ? { minPayloadSchema: body } : {}),
          ...(Object.keys(params.query).length ? { queryParamsSchema: params.query } : {}),
          ...(Object.keys(params.path).length ? { pathParamsSchema: params.path } : {}),
          ...(codes.length ? { expectedStatusCodes: codes } : {}),
        });
      }
    }
    return index;
  }

  /** `/v1/artifacts/{code}` → `/v1/artifacts/:code`, que es como lo escribe el router de Nest. */
  private routerPath(openApiPath: string): string {
    return openApiPath.replace(/\{([^}]+)\}/g, ':$1');
  }

  /** Metadato del handler con respaldo en la clase: el mismo orden que aplica el guard. */
  private metadataOf<T>(key: string, handler: object, controller: object): T | undefined {
    const own = Reflect.getMetadata(key, handler) as T | undefined;
    return own !== undefined ? own : (Reflect.getMetadata(key, controller) as T | undefined);
  }

  private summaryOf(handler: object, method: string, fullPath: string): string {
    // `@ApiOperation({ summary })` de Swagger. Si la ruta no lo declara, se compone uno legible
    // en vez de dejar el hueco: el catálogo se lee en una tabla y una celda vacía no informa.
    const operation = Reflect.getMetadata('swagger/apiOperation', handler) as { summary?: string } | undefined;
    return operation?.summary?.trim() || `${method} ${fullPath}`;
  }

  /**
   * Riesgo por forma de la ruta, no por su nombre.
   *
   * Una ruta pública que muta es lo más expuesto que hay: no hay identidad detrás del cambio.
   * Cualquier otra mutación es media, y las lecturas son bajas. Es una heurística y se declara
   * como tal — el catálogo la marca como inferida y el portal permite revisarla.
   */
  private riskLevelOf(method: string, isPublic: boolean): string {
    if (READONLY_METHODS.has(method)) return isPublic ? 'LOW' : 'LOW';
    return isPublic ? 'HIGH' : 'MEDIUM';
  }

  private codeFor(blockPrefix: string, method: string, fullPath: string): string {
    const slug = fullPath
      .replace(/[:{}]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase();
    return `${blockPrefix}_${method}_${slug || 'ROOT'}`.slice(0, 180);
  }

  private moduleNameOf(controllerName: string): string {
    return (
      controllerName
        .replace(/Controller$/, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase() || 'root'
    );
  }

  private verbName(verb: number): string {
    const name = (RequestMethod as Record<number, string | undefined>)[verb];
    return name && name !== 'ALL' ? name : 'GET';
  }

  private normalize(value: unknown): string {
    if (Array.isArray(value)) {
      const first: unknown = value[0];
      return typeof first === 'string' ? first : '';
    }
    return typeof value === 'string' ? value : '';
  }

  private joinPath(...segments: string[]): string {
    const path = segments
      .map((segment) => segment.replace(/^\/+|\/+$/g, ''))
      .filter(Boolean)
      .join('/');
    return `/${path}`;
  }
}
