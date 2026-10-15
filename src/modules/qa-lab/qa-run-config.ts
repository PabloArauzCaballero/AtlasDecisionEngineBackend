import type { Prisma } from '@prisma/client';
import type { FakerReport } from './qa-fakers.service';

/**
 * Lo que se archiva como «ambiente» de una corrida.
 *
 * El QA Lab NO ejecuta contra ningún ambiente: evalúa el artefacto compilado dentro del
 * propio proceso de la API y no persiste ni una ejecución. El formulario ofrecía elegir DEV,
 * TEST o STAGING y ese valor sólo se guardaba, sin cambiar nada; ahora se archiva lo que es.
 */
export const QA_LAB_ENVIRONMENT = 'EN_PROCESO';

/**
 * A partir de aquí una corrida `RUNNING` está muerta, no ocupada.
 *
 * Es el techo que admite `timeoutMs` (600 s) más un margen. La ejecución sobrevive a la
 * petición que la lanzó, así que un reinicio del proceso a mitad de tanda deja la fila en
 * `RUNNING` para siempre: el portal la sondearía sin fin y el historial mentiría diciendo
 * que sigue trabajando.
 */
export const ABANDONED_RUN_MS = 660_000;

/** `plannedCases` de una configuración archivada; 0 en las corridas anteriores al campo. */
export function plannedCasesOf(config: Prisma.JsonValue): number {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return 0;
  const planned = (config as Record<string, unknown>).plannedCases;
  return typeof planned === 'number' && Number.isFinite(planned) ? planned : 0;
}

/**
 * La carga con la que se lanzó una corrida, leída de su configuración archivada.
 *
 * `null` y no un valor por omisión cuando el dato no está: las corridas anteriores a este
 * campo no llevan concurrencia guardada, y rellenarla con el 8 de serie inventaría una
 * medición —diría que aquella corrida iba a ocho en paralelo sin que nadie lo sepa—.
 */
export function loadOf(config: Prisma.JsonValue): {
  plannedCases: number;
  concurrency: number | null;
  checkDeterminism: boolean | null;
} {
  const planned = plannedCasesOf(config);
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { plannedCases: planned, concurrency: null, checkDeterminism: null };
  }
  const record = config as Record<string, unknown>;
  const concurrency = record.concurrency;
  const determinism = record.checkDeterminism;
  return {
    plannedCases: planned,
    concurrency:
      typeof concurrency === 'number' && Number.isFinite(concurrency) ? concurrency : null,
    checkDeterminism: typeof determinism === 'boolean' ? determinism : null,
  };
}

/** Lo que el lote archivó sobre los fakers; `null` en corridas anteriores a este campo. */
export function fakersOf(config: Prisma.JsonValue): FakerReport | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const fakers = (config as Record<string, unknown>).fakers;
  return fakers && typeof fakers === 'object' ? (fakers as unknown as FakerReport) : null;
}
