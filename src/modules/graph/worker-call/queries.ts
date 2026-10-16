import type { GraphNodeSnapshot } from '../graph.types';

/**
 * Intermedias que un nodo LEE para alimentar los argumentos de su llamada.
 *
 * Se nombran sin el prefijo `intermediate.`, igual que las entradas de un campo calculado,
 * así que el validador de intermedias no las descubre recorriendo cadenas y necesita
 * preguntarlas aparte.
 */
export function workerArgumentIntermediatesOf(node: GraphNodeSnapshot): string[] {
  if (node.type !== 'WORKER') return [];
  const raw = (node.config as { arguments?: unknown }).arguments;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.values(raw as Record<string, unknown>)
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      const binding = entry as Record<string, unknown>;
      if (String(binding.source ?? '').toUpperCase() !== 'INTERMEDIATE') return '';
      return String(binding.path ?? '')
        .trim()
        .split('.')[0];
    })
    .filter((code) => code.length > 0);
}

/**
 * Intermedias que un nodo escribe por llamar a un servicio.
 *
 * El validador de intermedias las necesita para saber quién es el productor de cada
 * variable; se lee desde la configuración cruda y sin fallar, porque un nodo mal
 * configurado ya lo reporta `parseWorkerCall` y aquí solo interesa el destino.
 */
export function workerOutputCodesOf(node: GraphNodeSnapshot): string[] {
  if (node.type !== 'WORKER') return [];
  const raw = (node.config as { outputs?: unknown }).outputs;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) =>
      entry && typeof entry === 'object'
        ? String((entry as Record<string, unknown>).intermediateCode ?? '').trim()
        : '',
    )
    .filter((code) => code.length > 0);
}
