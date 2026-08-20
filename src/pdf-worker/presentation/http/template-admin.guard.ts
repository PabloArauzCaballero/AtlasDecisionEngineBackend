/**
 * Guardia de la administración de templates.
 *
 * Es la única superficie del worker que ACEPTA plantillas del exterior, así que es la única que
 * necesita puerta. Tres decisiones:
 *
 * 1. **Apagada por omisión.** Un despliegue que no publica templates por API no debe exponer
 *    la ruta. Con `PDF_TEMPLATE_ADMIN_ENABLED=false` responde 404 —no 403—: anunciar que existe
 *    una administración desactivada es decirle a quien sondea dónde volver a mirar.
 *
 * 2. **Clave comparada en tiempo CONSTANTE.** Una comparación con `===` termina en el primer
 *    byte distinto, y esa diferencia de tiempo permite adivinar la clave carácter a carácter
 *    contra un endpoint que se puede llamar mil veces. `timingSafeEqual` no.
 *
 * 3. **Esto NO sustituye a la autenticación del anfitrión.** Es una barrera de último recurso
 *    para el worker suelto. Montado dentro del motor, la ruta debe quedar además detrás de sus
 *    guardias de rol; está escrito en `docs/pdf-worker/integracion.md`.
 */
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import {
  TemplateAdminDisabledError,
  TemplateAdminUnauthorizedError,
} from '../../domain/errors/pdf-worker.errors';

export const TEMPLATE_ADMIN_CONFIG = Symbol('TemplateAdminConfig');

export interface TemplateAdminConfig {
  readonly enabled: boolean;
  readonly apiKey: string;
  readonly header: string;
}

@Injectable()
export class TemplateAdminGuard implements CanActivate {
  constructor(@Inject(TEMPLATE_ADMIN_CONFIG) private readonly config: TemplateAdminConfig) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.enabled) throw new TemplateAdminDisabledError();

    const request = context.switchToHttp().getRequest<Request>();
    const supplied = request.headers[this.config.header];
    const value = Array.isArray(supplied) ? supplied[0] : supplied;
    if (!value || !equalsInConstantTime(value, this.config.apiKey)) {
      throw new TemplateAdminUnauthorizedError();
    }
    return true;
  }
}

/**
 * Compara en tiempo constante.
 *
 * Se hashean los dos lados antes de comparar porque `timingSafeEqual` EXIGE búferes de la misma
 * longitud y lanza si no lo son — y ese lanzamiento, por sí solo, filtraría la longitud de la
 * clave. Con SHA-256 los dos búferes miden siempre 32 bytes.
 */
function equalsInConstantTime(supplied: string, expected: string): boolean {
  if (expected.length === 0) return false;
  const a = createHash('sha256').update(supplied).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
