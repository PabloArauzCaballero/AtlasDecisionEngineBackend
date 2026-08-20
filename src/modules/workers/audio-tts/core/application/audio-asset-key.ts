import { createHash } from 'node:crypto';
import type { VoiceSettings } from '../config/voice-settings';

export interface AudioAssetIdentity {
  templateCode: string;
  templateVersion: number;
  renderedText: string;
  language: string;
  provider: string;
  model: string;
  voiceProfile: string;
  voiceVersion: number;
  providerVoiceRef: string;
  outputFormat: string;
  sampleRate: number;
  /**
   * Cómo habla la voz. `null` cuando el proveedor no admite ajustes.
   *
   * Entra en la clave porque el audio que sale DEPENDE de ellos: el mismo texto
   * con la misma voz pero distinta expresividad son dos audios distintos, y sin
   * esto el segundo no se generaría nunca —la caché devolvería el primero y el
   * ajuste parecería no hacer nada—. Es exactamente el fallo que ya se pagó en
   * la idempotencia del worker de identidad, donde reenviar las mismas fotos
   * después de recalibrar devolvía el veredicto viejo.
   *
   * Va aparte de `AudioRenderIdentity` a propósito: aquélla tiene una columna
   * por campo en la base y esto no necesita ninguna. Sólo tiene que hacer
   * distinta la huella.
   */
  voiceSettings: VoiceSettings | null;
}

export function normalizeText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

/**
 * Identidad de un SEGMENTO de audio: un tramo de plantilla o el valor de una
 * variable, dicho por una voz concreta.
 *
 * A diferencia del asset, aquí NO entran `templateCode` ni `templateVersion`, y
 * es la decisión que hace útil la caché: «Su clave dinámica es» dicho por la
 * misma voz es EL MISMO audio lo pida la plantilla que lo pida, y el nombre de
 * una persona ya locutado se reutiliza en cualquier frase que lo lleve. Atarlo
 * a la plantilla pagaría el mismo tramo una vez por plantilla sin ganar nada.
 */
export interface AudioSegmentIdentity {
  text: string;
  language: string;
  provider: string;
  model: string;
  voiceProfile: string;
  voiceVersion: number;
  providerVoiceRef: string;
  outputFormat: string;
  sampleRate: number;
  voiceSettings: VoiceSettings | null;
}

export function buildAudioSegmentKey(input: AudioSegmentIdentity): string {
  const canonical = JSON.stringify({
    text: normalizeText(input.text),
    language: input.language.toLowerCase(),
    provider: input.provider,
    model: input.model,
    voiceProfile: input.voiceProfile,
    voiceVersion: input.voiceVersion,
    providerVoiceRef: input.providerVoiceRef,
    outputFormat: input.outputFormat,
    sampleRate: input.sampleRate,
    // Campo a campo por lo mismo que en `buildAudioAssetKey`: el orden de
    // inserción decide la huella, y dos huellas distintas del mismo audio se
    // pagan dos veces.
    voiceSettings: input.voiceSettings
      ? {
          stability: input.voiceSettings.stability,
          similarityBoost: input.voiceSettings.similarityBoost,
          style: input.voiceSettings.style,
          speakerBoost: input.voiceSettings.speakerBoost,
        }
      : null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function buildAudioAssetKey(input: AudioAssetIdentity): string {
  const canonical = JSON.stringify({
    templateCode: input.templateCode,
    templateVersion: input.templateVersion,
    renderedText: normalizeText(input.renderedText),
    language: input.language.toLowerCase(),
    provider: input.provider,
    model: input.model,
    voiceProfile: input.voiceProfile,
    voiceVersion: input.voiceVersion,
    providerVoiceRef: input.providerVoiceRef,
    outputFormat: input.outputFormat,
    sampleRate: input.sampleRate,
    // Campo a campo y no el objeto entero: `JSON.stringify` conserva el orden de
    // inserción, así que dos objetos con las mismas claves en distinto orden
    // darían huellas distintas y regenerarían audio idéntico. `null` cuando el
    // proveedor no admite ajustes, que es lo que deja intacta la huella de todo
    // lo generado hasta hoy con `fake` o con el worker apagado.
    voiceSettings: input.voiceSettings
      ? {
          stability: input.voiceSettings.stability,
          similarityBoost: input.voiceSettings.similarityBoost,
          style: input.voiceSettings.style,
          speakerBoost: input.voiceSettings.speakerBoost,
        }
      : null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
