/**
 * Puerta del generador documental cuando corre como PROCESO SUELTO.
 *
 * Existe por un hallazgo medido, no por prudencia genérica. El mismo `PdfWorkerModule` se
 * despliega de dos maneras —dentro del motor y como servicio aparte— y hasta ahora sólo una de
 * las dos estaba protegida:
 *
 *     GET  :3000/pdf/templates  → 401   (dentro del motor: lo cubre su APP_GUARD)
 *     GET  :3100/pdf/templates  → 200   (suelto: no lo cubría nada)
 *     POST :3100/pdf/generate   → 422   (validación, o sea: pasó de largo la autenticación)
 *
 * Dos modos de despliegue del mismo código con posturas de seguridad opuestas. Y el catálogo
 * que devolvía el 200 lleva plantillas clasificadas `CONFIDENTIAL`, mientras que el `generate`
 * dispara Chromium con cuerpos de hasta 8 MiB: agotar la máquina no requería credencial alguna.
 *
 * Cuatro decisiones:
 *
 * 1. **Encendida por omisión**, al revés que `TemplateAdminGuard`. La administración se apaga
 *    por defecto porque es una capacidad que la mayoría de los despliegues no usa; la
 *    autenticación no es una capacidad, es el suelo. Un valor por omisión inseguro sólo protege
 *    a quien lee la documentación entera, y el `docker-compose` no es documentación.
 *
 * 2. **Sólo se registra en modo suelto** (`PdfWorkerModule.register({ standalone: true })`).
 *    Dentro del motor autentica el `APP_GUARD` del anfitrión; exigir además una clave de
 *    servicio obligaría al motor a mandarse una credencial a sí mismo.
 *
 * 3. **`GET /pdf/health` queda fuera.** Es la sonda del contenedor —el `HEALTHCHECK` del
 *    Dockerfile la llama sin cabeceras— y es el mismo criterio que el motor aplica a su
 *    `/health`. Publica estado de vida, no datos: ni plantillas, ni documentos, ni configuración.
 *
 * 4. **Comparación en tiempo constante**, por la misma razón que en `template-admin.guard.ts`:
 *    un `===` termina en el primer byte distinto y esa diferencia permite adivinar la clave
 *    carácter a carácter contra un endpoint que se puede llamar mil veces.
 */
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { ServiceUnauthorizedError } from '../../domain/errors/pdf-worker.errors';

export const SERVICE_AUTH_CONFIG = Symbol('ServiceAuthConfig');

export interface ServiceAuthConfig {
  readonly enabled: boolean;
  readonly apiKey: string;
  readonly header: string;
}

/**
 * Rutas que responden sin credencial.
 *
 * Es una lista CERRADA y se compara por ruta completa, no por prefijo: `/pdf/health` abre la
 * sonda, y nada más. Con `startsWith` un futuro `/pdf/health-detallado` —o peor,
 * `/pdf/healthcheck-dump`— entraría solo por parecerse de nombre.
 */
const RUTAS_PUBLICAS: readonly string[] = ['/pdf/health'];

@Injectable()
export class ServiceAuthGuard implements CanActivate {
  constructor(@Inject(SERVICE_AUTH_CONFIG) private readonly config: ServiceAuthConfig) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.enabled) return true;

    const request = context.switchToHttp().getRequest<Request>();
    // `request.path` y no `request.url`: el segundo arrastra la cadena de consulta, y entonces
    // `/pdf/health?x=1` dejaría de coincidir con la lista y la sonda empezaría a fallar.
    if (RUTAS_PUBLICAS.includes(request.path)) return true;

    const supplied = request.headers[this.config.header];
    const value = Array.isArray(supplied) ? supplied[0] : supplied;
    if (!value || !equalsInConstantTime(value, this.config.apiKey)) {
      throw new ServiceUnauthorizedError();
    }
    return true;
  }
}

/** Longitud mínima de la clave de servicio. Más que la de administración: ésta cubre TODO. */
export const LONGITUD_MINIMA_CLAVE = 32;

/**
 * Exige que el modo suelto esté configurado, o aborta el arranque.
 *
 * Vive aquí y no en el esquema de entorno por una razón concreta: `loadPdfWorkerEnv()` también
 * se ejecuta cuando el módulo se monta DENTRO del motor, donde no hay clave de servicio porque
 * autentica el anfitrión. Exigirla allí habría impedido arrancar el motor entero por una
 * credencial que nunca iba a usar — un endurecimiento que rompe el caso bueno no es
 * endurecimiento, es una caída con mejor prensa.
 *
 * Aborta en vez de degradar a modo abierto. Un servicio que se abre solo cuando le falta la
 * clave es un servicio sin autenticación con pasos extra, y su fallo se descubre con la primera
 * petición anónima, que es demasiado tarde.
 */
export function assertServiceAuthConfigured(config: {
  readonly enabled: boolean;
  readonly apiKey?: string;
}): void {
  if (!config.enabled) return;
  if ((config.apiKey ?? '').length < LONGITUD_MINIMA_CLAVE) {
    throw new Error(
      'PDF_SERVICE_API_KEY: el generador documental corre suelto y su puerta viene encendida, ' +
        `así que hace falta una clave de al menos ${LONGITUD_MINIMA_CLAVE} caracteres. ` +
        'Apagarla (PDF_SERVICE_AUTH_ENABLED=false) sólo es admisible si algo delante autentica.',
    );
  }
}

/**
 * Compara en tiempo constante.
 *
 * Se hashean los dos lados porque `timingSafeEqual` EXIGE búferes de la misma longitud y lanza
 * si no lo son — y ese lanzamiento, por sí solo, filtraría la longitud de la clave. Con SHA-256
 * los dos búferes miden siempre 32 bytes.
 */
function equalsInConstantTime(supplied: string, expected: string): boolean {
  if (expected.length === 0) return false;
  const a = createHash('sha256').update(supplied).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
