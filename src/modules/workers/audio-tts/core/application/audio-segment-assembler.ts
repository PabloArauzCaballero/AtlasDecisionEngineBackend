import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import type { AudioTtsConfig } from '../config/audio-tts.env';
import { voiceSettingsFrom } from '../config/voice-settings';
import type {
  AudioAssetRecord,
  AudioSegmentsSummary,
  AudioTemplateRecord,
} from '../domain/audio.types';
import type { AudioSegmentRepositoryPort } from '../domain/ports/audio-segment.repository';
import type { TtsProviderPort } from '../domain/ports/tts-provider.port';
import { buildAudioSegmentKey } from './audio-asset-key';
import type { AudioValueCipher } from './audio-value-cipher';
import { hasTemplateTokens, splitTemplate } from './template-renderer';

/**
 * Genera un audio ENSAMBLANDO segmentos, pagando sólo los que faltan.
 *
 * El proveedor cobra por carácter y la caché de frases sólo ahorra cuando la
 * frase se repite ENTERA: cambiar el nombre en una plantilla de doscientos
 * caracteres volvía a pagar los doscientos. Aquí cada tramo —fijo o variable—
 * se busca primero en la caché de segmentos, se sintetiza sólo lo ausente y el
 * resultado se cose en orden. La primera frase de una plantilla cuesta lo
 * mismo; cada frase nueva paga sólo sus variables.
 *
 * El precio que se acepta a cambio, y que el resultado DECLARA, es la prosodia:
 * tramos sintetizados por separado no entonan como una toma continua.
 *
 * Sólo formatos que se pueden concatenar sin cirugía: los MP3 son tramas
 * autocontenidas y el PCM es crudo. Un WAV lleva cabecera con la duración —
 * concatenarlo produce un archivo que miente— y ahí se renuncia al corte.
 */
const CONCATENABLE_FORMAT = /^(mp3|pcm)/i;

export interface SegmentAssembly {
  audio: Buffer;
  mimeType: string;
  checksumSha256: string;
  /** Sólo lo sintetizado ahora: los tramos de caché ya se pagaron en su día. */
  usageUnits: number;
  summary: AudioSegmentsSummary;
}

export class AudioSegmentAssembler {
  constructor(
    private readonly config: AudioTtsConfig,
    private readonly segments: AudioSegmentRepositoryPort,
    private readonly tts: TtsProviderPort,
    private readonly cipher: AudioValueCipher,
  ) {}

  /**
   * `null` significa «este audio no se corta»: sin variables guardadas, con la
   * plantilla cambiada de versión, o con un formato que no admite costura. El
   * llamante genera entonces de una pieza, que es el camino de siempre.
   */
  async assemble(
    asset: AudioAssetRecord,
    template: AudioTemplateRecord | null,
  ): Promise<SegmentAssembly | null> {
    if (!asset.variablesEncrypted) return null;
    if (!template || !template.isActive) return null;
    if (template.version !== asset.templateVersion) return null;
    if (!CONCATENABLE_FORMAT.test(asset.outputFormat)) return null;
    if (!hasTemplateTokens(template.templateText)) return null;

    const variables = JSON.parse(
      this.cipher.decrypt(asset.variablesEncrypted, asset.assetKey),
    ) as Record<string, string>;
    const tramos = splitTemplate(template.templateText, variables);
    // Con un solo tramo no hay nada que ahorrar: la frase ES el segmento.
    if (tramos.length < 2) return null;

    const voiceSettings = voiceSettingsFrom(this.config);
    const partes: Buffer[] = [];
    let mimeType = '';
    let usageUnits = 0;
    let cached = 0;

    for (const tramo of tramos) {
      const segmentKey = buildAudioSegmentKey({
        text: tramo.text,
        language: asset.language,
        provider: asset.provider,
        model: asset.providerModel,
        voiceProfile: asset.voiceProfile,
        voiceVersion: asset.voiceVersion,
        providerVoiceRef: asset.providerVoiceRef,
        outputFormat: asset.outputFormat,
        sampleRate: asset.sampleRate,
        voiceSettings,
      });

      const existente = await this.segments.findByKey(segmentKey);
      if (existente) {
        partes.push(existente.audio);
        mimeType = mimeType || existente.mimeType;
        cached += 1;
        continue;
      }

      const generado = await this.tts.synthesize({
        text: tramo.text,
        language: asset.language,
        voiceProfile: asset.voiceProfile,
        providerVoiceRef: asset.providerVoiceRef,
        model: asset.providerModel,
        outputFormat: asset.outputFormat,
        sampleRate: asset.sampleRate,
        requestId: randomUUID(),
      });
      partes.push(generado.audio);
      mimeType = mimeType || generado.mimeType;
      usageUnits += generado.usageUnits;
      await this.segments.saveIfMissing({
        id: randomUUID(),
        segmentKey,
        textEncrypted: this.cipher.encrypt(tramo.text, segmentKey),
        audio: generado.audio,
        mimeType: generado.mimeType,
        checksumSha256: createHash('sha256').update(generado.audio).digest('hex'),
        usageUnits: generado.usageUnits,
      });
    }

    const audio = Buffer.concat(partes);
    return {
      audio,
      mimeType,
      checksumSha256: createHash('sha256').update(audio).digest('hex'),
      usageUnits,
      summary: { total: tramos.length, cached, generated: tramos.length - cached },
    };
  }
}
