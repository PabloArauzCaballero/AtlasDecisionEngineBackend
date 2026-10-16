import { type Provider } from '@nestjs/common';
import { type ClockPort } from './application/ports/runtime.ports';
import type { TemplateContract } from './domain/contracts/template-contract';
import type { DocumentBrand } from './domain/value-objects/document-brand';

export const PDF_WORKER_ENV = Symbol('PdfWorkerEnv');

export interface PdfWorkerModuleOptions {
  /** Expone `POST /pdf/generate` y compañía. `false` deja sólo el SDK en proceso. */
  readonly http?: boolean;
  /** Templates adicionales, además del catálogo incorporado. */
  readonly templates?: readonly TemplateContract[];
  /** Marcas adicionales; la del entorno se registra siempre y es la de por defecto. */
  readonly brands?: readonly DocumentBrand[];
  /** Entorno alternativo; por omisión, `process.env`. Lo usan las pruebas. */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Quién sabe qué publica un artefacto.
   *
   * Lo provee el ANFITRIÓN: el adaptador real lee `decision_output_contract_field`
   * con Prisma y por eso vive en `src/modules/artifacts/`, fuera de este árbol.
   * Sin él, casar documentos con artefactos no está disponible y se dice con un
   * 503 explicado, en vez de con una lista vacía que se leería como «este motor
   * no tiene artefactos».
   */
  readonly artifactContract?: Provider;

  /**
   * ¿Corre como PROCESO SUELTO, sin nadie delante que autentique?
   *
   * Sólo entonces se registra `ServiceAuthGuard` como guardia global. Dentro del motor
   * (`app.module.ts`) el `APP_GUARD` del anfitrión ya cubre estas rutas —lo demostró que la
   * misma `GET /pdf/templates` respondiera 401 por el puerto del motor y 200 por el del
   * worker—, así que registrarlo también aquí obligaría al motor a mandarse una credencial a
   * sí mismo.
   *
   * Por omisión `false`, y eso NO es un valor por omisión inseguro: el único sitio del
   * repositorio que monta este módulo sin anfitrión es `src/pdf-worker.ts`, y allí se declara
   * `true`. Lo que sí viene encendido por omisión es `PDF_SERVICE_AUTH_ENABLED`, de modo que
   * declararse suelto y no configurar clave aborta el arranque.
   */
  readonly standalone?: boolean;

  /**
   * Reloj alternativo. Con `FixedClock` la composición se vuelve determinista, que es lo que
   * permite comparar la huella visual de dos ejecuciones (§46) y afirmar sobre `createdAt` en
   * las pruebas sin margen de un segundo.
   */
  readonly clock?: ClockPort;
}
