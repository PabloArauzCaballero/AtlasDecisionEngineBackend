/**
 * Lo que una locución terminada publica.
 *
 * Compone el desenlace del resolutor con los datos del audio que quedó, y es
 * deliberadamente **lo que se puede enseñar**: el texto locutado no aparece.
 * Ese texto lleva dentro las variables —el nombre de una persona, en la
 * plantilla dinámica— y la única copia vive cifrada en el asset. Publicarlo
 * aquí, en un JSON que el portal muestra y que cualquier lector de la ejecución
 * puede leer, anularía ese cifrado sin ganar nada: quien pidió la locución ya
 * sabe qué pidió, porque las variables van en la propia fila.
 *
 * Lo que sí se publica es la IDENTIDAD del audio —voz, modelo, formato, huella—
 * porque es lo que permite responder a «¿este audio es el que creo que es?».
 */
import type { AudioSegmentsSummary, ResolveAudioResult } from './core/domain/audio.types';
import type { AudioTtsRuntime } from './audio-tts.runtime';

export interface AudioRunResult {
  /** `READY`, `FALLBACK`, `QUEUED` o `UNAVAILABLE`, tal como los define el núcleo. */
  outcome: ResolveAudioResult['status'];
  /** Si el audio ya existía. `false` significa que esta ejecución lo pagó. */
  cacheHit: boolean;
  /** Si esta ejecución llegó a llamar al proveedor. */
  generated: boolean;
  /** Si hay audio que reproducir. `UNAVAILABLE` es el único caso en que no. */
  audioAvailable: boolean;
  /** Por qué se degradó, cuando se degradó. */
  reason: string | null;

  templateCode: string | null;
  templateVersion: number | null;
  language: string | null;
  provider: string | null;
  model: string | null;
  voiceProfile: string | null;
  voiceVersion: number | null;
  outputFormat: string | null;
  sampleRate: number | null;

  mimeType: string | null;
  bytes: number | null;
  checksumSha256: string | null;
  /**
   * Cómo se compuso: cuántos tramos, cuántos de caché, cuántos pagados ahora.
   * `null` en audio generado de una pieza. Se publica porque un audio cosido no
   * entona como una toma continua, y eso se declara, no se esconde.
   */
  segments: AudioSegmentsSummary | null;
}

export interface AudioRunOutcome {
  result: AudioRunResult;
  warnings: string[];
  assetId: string | null;
}

/**
 * Qué significa cada degradación, en la lengua de quien la lee.
 *
 * El núcleo devuelve códigos (`ACTOR_DAILY_LIMIT`, `MONTHLY_BUDGET_RESERVED`…)
 * que describen el mecanismo. Aquí se traducen a la consecuencia, que es lo que
 * hay que decidir: «se agotó tu cupo de hoy» es accionable; «MONTHLY_BUDGET»
 * obliga a preguntarle a alguien qué significa.
 */
const REASON_LABEL: Record<string, string> = {
  TTS_DISABLED: 'La locución está apagada en este entorno.',
  PROVIDER_DISABLED: 'No hay proveedor de voz configurado en este entorno.',
  RUNTIME_GENERATION_DISABLED:
    'Este entorno sólo sirve audio ya generado: no se permite generar bajo demanda.',
  PRODUCTION_LICENSE_NOT_CONFIRMED:
    'Falta declarar por escrito la licencia de uso de la voz en producción.',
  ACTOR_DAILY_LIMIT: 'Se agotó el cupo de locuciones de hoy para esta cuenta.',
  MONTHLY_BUDGET_RESERVED: 'Se agotó el presupuesto de locución de este mes.',
};

export function describeReason(reason: string | null): string | null {
  if (!reason) return null;
  return REASON_LABEL[reason] ?? reason;
}

/** Compone el resultado leyendo el asset que quedó, si quedó alguno. */
export async function buildAudioOutcome(
  runtime: AudioTtsRuntime,
  resolved: ResolveAudioResult,
): Promise<AudioRunOutcome> {
  const assetId = resolved.status === 'UNAVAILABLE' ? null : resolved.assetId;
  const asset = assetId ? await runtime.repository.findById(assetId) : null;
  // Se generó si esta ejecución encontró el audio ausente y acabó habiéndolo.
  const generated = resolved.status === 'QUEUED' && asset?.status === 'READY';
  const audioAvailable = Boolean(asset?.storageUri) && asset?.status === 'READY';

  const reason = 'reason' in resolved ? resolved.reason : null;
  const result: AudioRunResult = {
    outcome: resolved.status,
    cacheHit: 'cacheHit' in resolved ? resolved.cacheHit : false,
    generated,
    audioAvailable,
    reason: describeReason(reason),
    templateCode: asset?.templateCode ?? null,
    templateVersion: asset?.templateVersion ?? null,
    language: asset?.language ?? null,
    provider: asset?.provider ?? null,
    model: asset?.providerModel ?? null,
    voiceProfile: asset?.voiceProfile ?? null,
    voiceVersion: asset?.voiceVersion ?? null,
    outputFormat: asset?.outputFormat ?? null,
    sampleRate: asset?.sampleRate ?? null,
    mimeType: asset?.mimeType ?? null,
    bytes: asset?.bytes ?? null,
    checksumSha256: asset?.checksumSha256 ?? null,
    segments: asset?.segmentsSummary ?? null,
  };

  return { result, warnings: warningsFor(result, asset?.lastErrorCode ?? null), assetId };
}

/**
 * Cuándo una locución terminada merece una advertencia.
 *
 * Las tres que hay corresponden a las tres formas de terminar sin dar lo que se
 * pidió. Colapsarlas con el éxito escondería justo lo que hay que mirar: quien
 * ve «completado» y un reproductor no vuelve a comprobar si la voz que suena es
 * la del respaldo genérico.
 */
function warningsFor(result: AudioRunResult, lastErrorCode: string | null): string[] {
  const warnings: string[] = [];
  if (result.outcome === 'FALLBACK') {
    warnings.push(
      `Se sirvió el audio de respaldo, no el que se pidió. ${result.reason ?? ''}`.trim(),
    );
  }
  if (result.outcome === 'UNAVAILABLE') {
    warnings.push(
      `No hay audio para esta locución y tampoco respaldo. ${result.reason ?? ''}`.trim(),
    );
  }
  if (result.outcome === 'QUEUED' && !result.audioAvailable) {
    warnings.push(
      lastErrorCode
        ? `El audio no llegó a generarse (${lastErrorCode}).`
        : 'El audio no llegó a generarse.',
    );
  }
  return warnings;
}
