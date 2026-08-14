import { buildAudioSegmentKey } from '../src/modules/workers/audio-tts/core/application/audio-asset-key';
import { buildCipher } from '../src/modules/workers/audio-tts/core/application/audio-cipher.factory';
import { AudioSegmentAssembler } from '../src/modules/workers/audio-tts/core/application/audio-segment-assembler';
import { splitTemplate } from '../src/modules/workers/audio-tts/core/application/template-renderer';
import type { AudioTtsConfig } from '../src/modules/workers/audio-tts/core/config/audio-tts.env';
import type {
  AudioAssetRecord,
  AudioTemplateRecord,
} from '../src/modules/workers/audio-tts/core/domain/audio.types';
import type {
  AudioSegmentRecord,
  AudioSegmentRepositoryPort,
  NewAudioSegment,
} from '../src/modules/workers/audio-tts/core/domain/ports/audio-segment.repository';
import type {
  TtsProviderPort,
  TtsSynthesisInput,
} from '../src/modules/workers/audio-tts/core/domain/ports/tts-provider.port';

/**
 * El corte por segmentos existe para UNA cosa: que cambiar una variable no
 * vuelva a pagar la plantilla entera. Estas pruebas fijan esa promesa donde
 * duele —cuántas veces se llama al proveedor y cuántas unidades se declaran—
 * y las renuncias que la hacen honesta: formatos que no admiten costura y
 * plantillas cambiadas de versión generan de una pieza, no un audio corrupto.
 */

describe('partir la plantilla en tramos', () => {
  it('separa lo fijo de lo variable, en orden de locución', () => {
    expect(
      splitTemplate('Hola {{nombre}}, tu clave es {{clave}}', {
        nombre: 'Ana',
        clave: '1234',
      }),
    ).toEqual([
      { kind: 'FIXED', text: 'Hola' },
      { kind: 'VARIABLE', text: 'Ana' },
      { kind: 'FIXED', text: ', tu clave es' },
      { kind: 'VARIABLE', text: '1234' },
    ]);
  });

  it('la puntuación suelta se pliega sobre el tramo anterior, no se locuta sola', () => {
    // «,» entre dos variables gastaría una llamada del proveedor en nada.
    expect(splitTemplate('{{a}}, {{b}}', { a: 'uno', b: 'dos' })).toEqual([
      { kind: 'VARIABLE', text: 'uno,' },
      { kind: 'VARIABLE', text: 'dos' },
    ]);
  });

  it('la puntuación inicial se pliega sobre el tramo que la sigue', () => {
    expect(splitTemplate('¿{{q}}?', { q: 'vienes' })).toEqual([
      { kind: 'VARIABLE', text: '¿vienes?' },
    ]);
  });

  it('una variable fuera del alfabeto seguro se rechaza igual que al renderizar', () => {
    expect(() => splitTemplate('Hola {{n}}', { n: '<script>' })).toThrow('Variable inválida');
  });
});

describe('la huella de un segmento', () => {
  const identidad = {
    text: 'Su clave dinámica es',
    language: 'es-419',
    provider: 'elevenlabs',
    model: 'eleven_v3',
    voiceProfile: 'brand_es_latam_v1',
    voiceVersion: 1,
    providerVoiceRef: 'voz-1',
    outputFormat: 'mp3_44100_128',
    sampleRate: 44_100,
    voiceSettings: null,
  };

  it('no depende de la plantilla: el mismo tramo con la misma voz es el mismo audio', () => {
    // No hay campo de plantilla que pasar: ésa es la decisión que se fija aquí.
    expect(buildAudioSegmentKey({ ...identidad })).toBe(buildAudioSegmentKey({ ...identidad }));
  });

  it('cambiar la versión de la voz cambia la huella: son dos audios', () => {
    expect(buildAudioSegmentKey({ ...identidad, voiceVersion: 2 })).not.toBe(
      buildAudioSegmentKey(identidad),
    );
  });
});

// --- Arnés del ensamblador --------------------------------------------------

const CONFIG = {
  NODE_ENV: 'test',
  AUDIO_TTS_DATA_KEY: 'clave-de-prueba-16',
  AUDIO_TTS_DATA_KEY_ID: 'k1',
  AUDIO_TTS_DATA_KEYS_PREVIOUS: '',
  ELEVENLABS_VOICE_STABILITY: -1,
  ELEVENLABS_VOICE_SIMILARITY_BOOST: -1,
  ELEVENLABS_VOICE_STYLE: -1,
  ELEVENLABS_VOICE_SPEAKER_BOOST: false,
  AUDIO_SEGMENT_CACHE_ENABLED: true,
} as unknown as AudioTtsConfig;

class SegmentosEnMemoria implements AudioSegmentRepositoryPort {
  readonly filas = new Map<string, AudioSegmentRecord>();
  async findByKey(segmentKey: string): Promise<AudioSegmentRecord | null> {
    return this.filas.get(segmentKey) ?? null;
  }
  async saveIfMissing(segmento: NewAudioSegment): Promise<void> {
    if (this.filas.has(segmento.segmentKey)) return;
    this.filas.set(segmento.segmentKey, {
      id: segmento.id,
      segmentKey: segmento.segmentKey,
      audio: segmento.audio,
      mimeType: segmento.mimeType,
      usageUnits: segmento.usageUnits,
    });
  }
}

class ProveedorContado implements TtsProviderPort {
  readonly providerName = 'fake';
  readonly textos: string[] = [];
  async synthesize(input: TtsSynthesisInput) {
    this.textos.push(input.text);
    return {
      audio: Buffer.from(`[${input.text}]`),
      mimeType: 'audio/mpeg',
      provider: 'fake',
      model: input.model,
      usageUnits: [...input.text].length,
      usageIsReported: false,
      durationMs: 1,
    };
  }
  async health() {
    return { provider: 'fake', configured: true };
  }
}

const cipher = buildCipher(CONFIG);

const PLANTILLA: AudioTemplateRecord = {
  code: 'onboarding.bienvenida',
  version: 3,
  strategy: 'DYNAMIC',
  templateText: 'Hola {{nombre}}, tu clave dinámica es {{clave}}',
  isActive: true,
};

function assetCon(
  variables: Record<string, string>,
  extra: Partial<AudioAssetRecord> = {},
): AudioAssetRecord {
  const assetKey = 'f'.repeat(64);
  return {
    id: 'asset-1',
    assetKey,
    templateCode: PLANTILLA.code,
    templateVersion: PLANTILLA.version,
    status: 'GENERATING',
    renderedTextEncrypted: 'no-se-usa-aquí',
    variablesEncrypted: cipher.encrypt(JSON.stringify(variables), assetKey),
    providerModel: 'eleven_v3',
    model: 'eleven_v3',
    reservedUnits: 100,
    attempts: 1,
    language: 'es-419',
    provider: 'fake',
    providerVoiceRef: 'fake-default',
    voiceProfile: 'brand_es_latam_v1',
    voiceVersion: 1,
    outputFormat: 'mp3_44100_128',
    sampleRate: 44_100,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...extra,
  };
}

describe('ensamblar un audio por segmentos', () => {
  it('la primera frase paga todos los tramos; la segunda sólo sus variables', async () => {
    const segmentos = new SegmentosEnMemoria();
    const proveedor = new ProveedorContado();
    const ensamblador = new AudioSegmentAssembler(CONFIG, segmentos, proveedor, cipher);

    const primera = await ensamblador.assemble(
      assetCon({ nombre: 'Ana', clave: '1234' }),
      PLANTILLA,
    );
    expect(primera).not.toBeNull();
    expect(primera?.summary).toEqual({ total: 4, cached: 0, generated: 4 });

    const llamadasTrasPrimera = proveedor.textos.length;
    const segunda = await ensamblador.assemble(
      assetCon({ nombre: 'Pablo', clave: '9876' }),
      PLANTILLA,
    );
    expect(segunda?.summary).toEqual({ total: 4, cached: 2, generated: 2 });
    // Sólo los dos tramos variables nuevos pasaron por el proveedor.
    expect(proveedor.textos.slice(llamadasTrasPrimera)).toEqual(['Pablo', '9876']);
    // Y el gasto declarado es SÓLO el de lo sintetizado ahora.
    expect(segunda?.usageUnits).toBe('Pablo'.length + '9876'.length);
  });

  it('el audio se cose en el orden de la frase', async () => {
    const ensamblador = new AudioSegmentAssembler(
      CONFIG,
      new SegmentosEnMemoria(),
      new ProveedorContado(),
      cipher,
    );
    const resultado = await ensamblador.assemble(
      assetCon({ nombre: 'Ana', clave: '1234' }),
      PLANTILLA,
    );
    expect(resultado?.audio.toString()).toBe('[Hola][Ana][, tu clave dinámica es][1234]');
  });

  it('renuncia con la plantilla cambiada de versión: cortar con otra letra miente', async () => {
    const ensamblador = new AudioSegmentAssembler(
      CONFIG,
      new SegmentosEnMemoria(),
      new ProveedorContado(),
      cipher,
    );
    const otraVersion = { ...PLANTILLA, version: 4 };
    expect(
      await ensamblador.assemble(assetCon({ nombre: 'Ana', clave: '1' }), otraVersion),
    ).toBeNull();
  });

  it('renuncia con un formato que no admite costura', async () => {
    const ensamblador = new AudioSegmentAssembler(
      CONFIG,
      new SegmentosEnMemoria(),
      new ProveedorContado(),
      cipher,
    );
    const wav = assetCon({ nombre: 'Ana', clave: '1' }, { outputFormat: 'wav_44100' });
    expect(await ensamblador.assemble(wav, PLANTILLA)).toBeNull();
  });

  it('renuncia sin variables guardadas: no hay con qué cortar', async () => {
    const ensamblador = new AudioSegmentAssembler(
      CONFIG,
      new SegmentosEnMemoria(),
      new ProveedorContado(),
      cipher,
    );
    const sinVariables = assetCon({});
    delete (sinVariables as { variablesEncrypted?: string }).variablesEncrypted;
    expect(await ensamblador.assemble(sinVariables, PLANTILLA)).toBeNull();
  });
});
