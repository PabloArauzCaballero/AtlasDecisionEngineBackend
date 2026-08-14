import {
  buildAudioOutcome,
  describeReason,
} from '../src/modules/workers/audio-tts/audio-tts.result';
import type { AudioTtsRuntime } from '../src/modules/workers/audio-tts/audio-tts.runtime';
import type { AudioAssetRecord } from '../src/modules/workers/audio-tts/core/domain/audio.types';

/**
 * Las tres formas de terminar sin dar lo que se pidió.
 *
 * Un worker cache-first tiene un final más que los otros tres: puede terminar
 * BIEN y sin audio. Estas pruebas fijan que ninguno de esos tres finales se
 * cuele como éxito limpio, porque quien ve «completado» junto a un reproductor
 * no vuelve a comprobar si la voz que suena es la del respaldo genérico.
 */
function asset(overrides: Partial<AudioAssetRecord> = {}): AudioAssetRecord {
  return {
    id: 'asset-1',
    assetKey: 'a'.repeat(64),
    templateCode: 'onboarding.welcome.generic',
    templateVersion: 1,
    status: 'READY',
    renderedTextEncrypted: 'v2.k1.x.y.z',
    providerModel: 'eleven_v3',
    model: 'eleven_v3',
    reservedUnits: 42,
    attempts: 1,
    storageUri: 'db://audio/asset-1',
    mimeType: 'audio/mpeg',
    checksumSha256: 'b'.repeat(64),
    bytes: 2_048,
    language: 'es-419',
    provider: 'fake',
    providerVoiceRef: 'fake-default',
    voiceProfile: 'brand_es_latam_v1',
    voiceVersion: 1,
    outputFormat: 'mp3_44100_128',
    sampleRate: 44_100,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function runtimeWith(found: AudioAssetRecord | null): AudioTtsRuntime {
  return {
    repository: { findById: async () => found },
  } as unknown as AudioTtsRuntime;
}

describe('desenlace de una locución', () => {
  it('un acierto de caché es éxito limpio y no cuenta como generado', async () => {
    const outcome = await buildAudioOutcome(runtimeWith(asset()), {
      status: 'READY',
      assetId: 'asset-1',
      storageUri: 'db://audio/asset-1',
      cacheHit: true,
    });
    expect(outcome.warnings).toEqual([]);
    expect(outcome.result.cacheHit).toBe(true);
    expect(outcome.result.generated).toBe(false);
    expect(outcome.result.audioAvailable).toBe(true);
  });

  it('lo generado en esta ejecución se marca como generado', async () => {
    const outcome = await buildAudioOutcome(runtimeWith(asset()), {
      status: 'QUEUED',
      assetId: 'asset-1',
      cacheHit: false,
    });
    expect(outcome.result.generated).toBe(true);
    expect(outcome.warnings).toEqual([]);
  });

  it('el respaldo avisa: suena, pero no dice lo que se pidió', async () => {
    const outcome = await buildAudioOutcome(runtimeWith(asset()), {
      status: 'FALLBACK',
      assetId: 'asset-1',
      storageUri: 'db://audio/asset-1',
      reason: 'MONTHLY_BUDGET_RESERVED',
    });
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.warnings[0]).toMatch(/respaldo/i);
    // El motivo llega traducido, no como código del núcleo.
    expect(outcome.result.reason).toMatch(/presupuesto/i);
  });

  it('sin audio ni respaldo avisa y no publica identidad que no existe', async () => {
    const outcome = await buildAudioOutcome(runtimeWith(null), {
      status: 'UNAVAILABLE',
      reason: 'ACTOR_DAILY_LIMIT',
    });
    expect(outcome.assetId).toBeNull();
    expect(outcome.result.audioAvailable).toBe(false);
    expect(outcome.warnings[0]).toMatch(/tampoco respaldo/i);
    expect(outcome.result.provider).toBeNull();
  });

  it('encolado que no llegó a generarse avisa con el código del fallo', async () => {
    const outcome = await buildAudioOutcome(
      runtimeWith(
        asset({
          status: 'FAILED_RETRYABLE',
          storageUri: undefined,
          lastErrorCode: 'ELEVENLABS_TIMEOUT',
        }),
      ),
      { status: 'QUEUED', assetId: 'asset-1', cacheHit: false },
    );
    expect(outcome.result.generated).toBe(false);
    expect(outcome.warnings[0]).toContain('ELEVENLABS_TIMEOUT');
  });
});

describe('motivos de degradación', () => {
  it('se traducen a la consecuencia, no al mecanismo', () => {
    expect(describeReason('ACTOR_DAILY_LIMIT')).toMatch(/cupo/i);
    expect(describeReason('RUNTIME_GENERATION_DISABLED')).toMatch(/ya generado/i);
  });

  it('un motivo desconocido se publica tal cual en vez de perderse', () => {
    expect(describeReason('MOTIVO_NUEVO')).toBe('MOTIVO_NUEVO');
  });

  it('sin motivo no inventa ninguno', () => {
    expect(describeReason(null)).toBeNull();
  });
});
