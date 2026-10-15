import { PlatformRole } from '../../common/security/platform-roles';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';

/**
 * Quién puede intervenir sobre el caso de OTRO analista.
 *
 * La segregación de funciones vale entre PARES, no frente a quien supervisa. Exigir que sólo el
 * asignado resuelva impide que cualquiera abra y cierre un caso ajeno, y eso está bien; aplicado
 * también a supervisión produce un callejón sin salida real: un analista toma un caso, se va de
 * vacaciones o deja la empresa, y ese caso queda bloqueado para siempre —con un cliente esperando
 * al otro lado— porque el único que podía resolverlo ya no está.
 *
 * **Los nombres salen de `PlatformRole`, no de literales sueltos.** La lista decía
 * `['ADMIN', 'PLATFORM_ADMIN', 'OPERATIONS']` y `ADMIN` **no existe en esta plataforma**: no rompía
 * la compilación ni ninguna prueba, simplemente no lo tiene nadie y el permiso que este fichero
 * creía conceder no se concedía jamás. Es el fallo silencioso contra el que avisa
 * `platform-roles.ts`, y sólo el tipo lo atrapa.
 */
const SUPERVISION_ROLES: readonly string[] = [PlatformRole.OPERATIONS];

/**
 * `PLATFORM_ADMIN` cuenta aparte y sólo sobre identidad firmada, igual que en `RolesGuard`.
 *
 * Es un comodín global y el guard se niega a honrarlo en una clave de API, que ningún humano
 * custodia. Repetir aquí esa condición no es paranoia: sin ella, una clave con `PLATFORM_ADMIN` y
 * un rol concreto de la ruta entra por el rol concreto y recoge la supervisión por el comodín —
 * exactamente lo que el guard acaba de negarle una capa más arriba.
 */
export function supervisa(principal: AuthenticatedPrincipal): boolean {
  const roles = principal.roles ?? [];
  const comodinFirmado =
    roles.includes(PlatformRole.PLATFORM_ADMIN) &&
    (principal.authMethod === 'jwt' || principal.authMethod === 'identity_provider');
  return comodinFirmado || roles.some((role) => SUPERVISION_ROLES.includes(role));
}

/** La cola cuyas resoluciones tienen que volver al backend de identidad. */
const COLA_DE_IDENTIDAD = 'IDENTIDAD';

/**
 * A donde vuelve cada resolucion, por cola.
 *
 * Hasta el 2026-09-14 solo la cola de IDENTIDAD avisaba a AtlasBackend. Las otras dos que Atlas
 * delega —riesgo de onboarding y credito— se resolvian aqui y alla nadie se enteraba: el caso local
 * quedaba delegado (409 `MANUAL_REVIEW_DELEGADA_AL_MOTOR`) y la solicitud `under_review` para
 * siempre. Un callejon sin salida con las dos puertas cerradas a proposito.
 *
 * `MERCHANT_KYB` no esta y es correcto: AtlasBackend lo sincroniza por tiron (`sync_partner_kyb_reviews`).
 * Cualquier cola que no este aqui no avisa, y lo deja escrito en el log: es preferible a adivinar un
 * destino y llenar la auditoria de callbacks fallidos.
 */
export const RUTA_DE_CALLBACK_POR_COLA: Readonly<Record<string, string>> = {
  [COLA_DE_IDENTIDAD]: '/internal/identity/manual-review-callback',
  RIESGO_ONBOARDING: '/internal/risk/manual-review-callback',
  CREDIT_REVIEW: '/internal/credit/manual-review-callback',
};

/** La ruta de vuelta para una cola, o `null` si esa cola no se devuelve por callback. */
export function rutaDeCallback(queueCode: string | null | undefined): string | null {
  return RUTA_DE_CALLBACK_POR_COLA[String(queueCode ?? '')] ?? null;
}
