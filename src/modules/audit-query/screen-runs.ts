import type { ScreenRunSummary } from './ports/decision-audit-read.port';

/** Tope de grupos (cliente, pantalla, recurso, código) por consulta. */
export const SCREEN_RUNS_LIMIT = 5000;
const MAX_ROUTES_PER_SCREEN = 40;

export interface ScreenRun {
  client: string;
  screen: string;
  calls: number;
  failed: number;
  lastAt: Date | null;
  routes: Array<{ method: string; path: string; calls: number; failed: number }>;
}

/**
 * Funde los grupos por recurso y código en una entrada por pantalla, con la forma que lee
 * AtlasBackend (`indexBlockScreens`). Como en el resto de la evidencia, sólo el 5xx es un fallo: un
 * 400 o un 403 es el flujo haciendo su trabajo.
 */
export function agruparPantallas(filas: readonly ScreenRunSummary[]): ScreenRun[] {
  const porPantalla = new Map<string, ScreenRun>();
  for (const fila of filas) {
    const clave = `${fila.client} ${fila.screen}`;
    const pantalla = porPantalla.get(clave) ?? {
      client: fila.client,
      screen: fila.screen,
      calls: 0,
      failed: 0,
      lastAt: null,
      routes: [],
    };
    const fallos = (fila.status ?? 0) >= 500 ? fila.count : 0;
    pantalla.calls += fila.count;
    pantalla.failed += fallos;
    if (fila.lastAt && (!pantalla.lastAt || fila.lastAt > pantalla.lastAt))
      pantalla.lastAt = fila.lastAt;
    // `resource` es "MÉTODO Clase.handler": el método se separa para que la ruta se lea igual que en
    // los demás bloques.
    const [method = '', ...resto] = fila.resource.split(' ');
    const path = resto.join(' ');
    const ruta = pantalla.routes.find((r) => r.method === method && r.path === path);
    if (ruta) {
      ruta.calls += fila.count;
      ruta.failed += fallos;
    } else if (pantalla.routes.length < MAX_ROUTES_PER_SCREEN) {
      pantalla.routes.push({ method, path, calls: fila.count, failed: fallos });
    }
    porPantalla.set(clave, pantalla);
  }
  return [...porPantalla.values()].sort((a, b) =>
    `${a.client} ${a.screen}`.localeCompare(`${b.client} ${b.screen}`),
  );
}
