/**
 * Única decisión de «¿esta corrida siembra los datos de DEMOSTRACIÓN?».
 *
 * Los dos conjuntos de semillas tienen dueños distintos: BOOTSTRAP es el mínimo sin el
 * cual una instalación no opera y corre en TODOS los ambientes; MOCKUP son artefactos de
 * ejemplo —con despliegues ACTIVOS, incluido uno en PROD— que en una base productiva son
 * basura con apariencia de política aprobada.
 *
 * Antes cada entrada decidía por su cuenta y decidían distinto: el CLI (`prisma/seed.ts`)
 * leía `SEED_INCLUDE_MOCKUP` y el arranque (`SeedingService`) sólo miraba
 * `NODE_ENV === 'development'`. Como la imagen fija `NODE_ENV=production` —es la misma que
 * se despliega—, poner `SEED_INCLUDE_MOCKUP=true` en una máquina de desarrollo sembraba el
 * demo por el Job pero NO por el arranque: exactamente la confusión que ese fichero
 * documenta como ya resuelta. Con una sola función, la regla es una y se puede probar.
 *
 * `NODE_ENV` NO sirve como guarda de producción en el contenedor de siembra, porque ahí
 * vale `production` incluso en un portátil. La guarda real es explícita y visible en el
 * compose: `docker-compose.prod.yml` fija `SEED_INCLUDE_MOCKUP: "false"`.
 */

export interface MockupDecision {
  includeMockup: boolean;
  /** Por qué, en texto, para que la corrida deje dicho de dónde salió la decisión. */
  reason: string;
}

const TRUE_VALUES = new Set(['true', '1', 'yes']);
const FALSE_VALUES = new Set(['false', '0', 'no']);

export function resolveMockupPolicy(env: NodeJS.ProcessEnv = process.env): MockupDecision {
  const raw = env.SEED_INCLUDE_MOCKUP?.trim().toLowerCase();

  if (raw) {
    if (TRUE_VALUES.has(raw)) return { includeMockup: true, reason: 'SEED_INCLUDE_MOCKUP=true' };
    if (FALSE_VALUES.has(raw)) return { includeMockup: false, reason: 'SEED_INCLUDE_MOCKUP=false' };
    // Un valor irreconocible NO se degrada a `false` en silencio. Ese silencio ya costó
    // una tarde: una base con catálogos y sin un solo artefacto ejecutable, y el motor
    // respondiendo «no active deployment» a todo sin decir por qué.
    throw new Error(
      `SEED_INCLUDE_MOCKUP='${env.SEED_INCLUDE_MOCKUP}' no es un booleano reconocible ` +
        `(true/false, 1/0, yes/no). Se declara explícitamente o se deja sin declarar.`,
    );
  }

  const nodeEnv = env.NODE_ENV ?? 'development';
  return { includeMockup: nodeEnv === 'development', reason: `NODE_ENV=${nodeEnv}` };
}

/** Línea de bitácora de la decisión. El caso ruidoso es sembrar el demo, no omitirlo. */
export function describeMockupDecision(decision: MockupDecision): string {
  return decision.includeMockup
    ? `SEMBRANDO DATOS DE DEMOSTRACIÓN (${decision.reason}) — no aptos para una base productiva`
    : `Datos de demostración omitidos (${decision.reason}); sólo se siembra el catálogo base`;
}
