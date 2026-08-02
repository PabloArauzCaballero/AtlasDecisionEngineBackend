/**
 * Referencia interactiva de la API (Scalar).
 *
 * Convive con el Swagger UI existente en vez de sustituirlo: hay herramientas y enlaces que
 * ya apuntan a `/docs`, y romperlos para cambiar de visor no le aporta nada a nadie. Scalar
 * se monta en una ruta propia y ambos leen EL MISMO documento generado por
 * `buildOpenApiDocument`, así que no pueden mostrar contratos distintos.
 *
 * Se monta únicamente cuando `SWAGGER_ENABLED=true`, y el env schema prohíbe ese valor en
 * producción: la referencia interactiva no se expone en el ambiente productivo.
 */
import type { INestApplication } from '@nestjs/common';
import { apiReference } from '@scalar/nestjs-api-reference';

export interface ApiReferenceIdentity {
  apiVersion: string;
  buildVersion: string;
  nodeEnv: string;
}

/**
 * @param path Ruta donde se sirve la referencia, sin barra inicial.
 * @param specUrl Ruta del documento OpenAPI que la referencia debe cargar.
 */
export function mountApiReference(
  app: INestApplication,
  path: string,
  specUrl: string,
  identity: ApiReferenceIdentity,
): void {
  const isProductionLike = identity.nodeEnv === 'production';
  app.use(
    `/${path}`,
    apiReference({
      // La referencia carga el contrato por URL en vez de incrustarlo: así una recarga del
      // navegador refleja el contrato que el proceso sirve AHORA, no el del arranque.
      url: specUrl,
      // Advertencia visible: quien abre esta página puede lanzar peticiones reales contra
      // el ambiente que la sirve, y confundirlo con producción es un error caro.
      pageTitle: `ATLAS Decision Platform API · ${identity.apiVersion} · ${identity.nodeEnv.toUpperCase()}`,
      theme: 'purple',
      darkMode: true,
      hideDownloadButton: false,
      // Un ambiente no productivo no debe insinuar que lo es.
      ...(isProductionLike ? {} : { showSidebar: true }),
    }),
  );
}
