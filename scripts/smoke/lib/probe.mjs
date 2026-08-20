/**
 * Mecánica común de cada comprobación.
 *
 * La regla que ordena todo el smoke: para CADA ruta y CADA tipo de usuario,
 *
 *   - si sus roles alcanzan la ruta → el payload correcto debe funcionar, y cada payload
 *     erróneo debe ser rechazado con un código catalogado;
 *   - si no la alcanzan → la misma llamada debe responder 403 FORBIDDEN.
 *
 * Los payloads erróneos sólo se envían cuando el usuario tiene permiso. Enviarlos sin
 * permiso mediría el guardián de roles otra vez y ocultaría la validación, que es justo
 * lo que ese caso pretende comprobar.
 */
import { request } from './http.mjs';
import { evaluate, OUTCOME } from './report.mjs';

const SUCCESS = [200, 201, 202, 204];

/** Roles de la ruta vacíos = cualquier principal autenticado de la audiencia correcta. */
function reaches(principalRoles, routeRoles) {
  if (!routeRoles || routeRoles.length === 0) return true;
  return routeRoles.some((role) => principalRoles.includes(role));
}

export function createProbe({ reporter, principal, domain }) {
  const principalRoles = principal.expectedRoles ?? principal.roles ?? [];

  async function send({ method = 'GET', path, body, headers, raw }) {
    return request({ method, path, body, headers, auth: principal, raw });
  }

  return {
    reaches: (routeRoles) => reaches(principalRoles, routeRoles),

    /** Identidad con la que se está llamando; algunas rutas exigen que coincida. */
    principalId: principal.principalId,

    /**
     * Camino correcto de una ruta. Devuelve `{ entry, response, allowed }` para que el
     * llamante pueda encadenar estado (un id creado alimenta la siguiente llamada).
     */
    async ok({ id, title, method, path, roles, body, headers, raw, expect = {} }) {
      const allowed = reaches(principalRoles, roles);
      const response = await send({ method, path, body, headers, raw });
      const expectation = allowed
        ? { statusIn: expect.status ? undefined : (expect.statusIn ?? SUCCESS), ...expect }
        : { status: 403, errorCode: 'FORBIDDEN' };
      const entry = evaluate(reporter, {
        id: `${domain}.${id}.${allowed ? 'valid' : 'rbac-denied'}`,
        title: allowed ? title : `${title} — denegada por rol`,
        expect: expectation,
        response,
        extra: { roles: roles ?? [], principalRoles, allowed },
      });
      return { entry, response, allowed, passed: entry.outcome === OUTCOME.PASS };
    },

    /**
     * Payload erróneo.
     *
     * Si el usuario alcanza la ruta se exige el código de rechazo declarado. Si NO la
     * alcanza, la llamada se hace igual y se exige 403: los guardianes corren antes que la
     * validación, así que un payload roto de quien no tiene permiso debe morir en el
     * permiso y nunca en el validador. Comprobarlo cierra un agujero real —una ruta que
     * validara antes de autorizar filtraría por sus mensajes de error qué existe y qué no—
     * y convierte en evidencia lo que antes era una omisión.
     */
    async invalid({ id, case: caseName, title, method, path, roles, body, headers, expect }) {
      const allowed = reaches(principalRoles, roles);
      const checkId = `${domain}.${id}.invalid.${caseName}${allowed ? '' : '.rbac-denied'}`;
      const response = await send({ method, path, body, headers });
      return evaluate(reporter, {
        id: checkId,
        title: allowed ? title : `${title} — denegada por rol antes de validar`,
        expect: allowed ? expect : { status: 403, errorCode: 'FORBIDDEN' },
        response,
        extra: { roles: roles ?? [], principalRoles, allowed },
      });
    },

    /** Llamada suelta sin criterio de rol: la usa la preparación de estado. */
    send,

    /** Registra que un caso no se pudo intentar porque el estado previo no existe. */
    skip(id, title, reason) {
      return reporter.skip(`${domain}.${id}`, title, reason);
    },
  };
}
