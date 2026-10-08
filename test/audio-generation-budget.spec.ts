import { AudioGenerationProcessor } from '../src/modules/workers/audio-tts/core/application/audio-generation.processor';
import type { AudioTtsConfig } from '../src/modules/workers/audio-tts/core/config/audio-tts.env';
import type { AudioAssetRecord } from '../src/modules/workers/audio-tts/core/domain/audio.types';
import { buildCipher } from '../src/modules/workers/audio-tts/core/application/audio-cipher.factory';
import { TtsProviderError } from '../src/modules/workers/audio-tts/core/domain/errors';

/**
 * La contabilidad de la reserva de presupuesto de una locución.
 *
 * Una reserva se hace una vez, al crear el asset; se devuelve UNA vez, cuando el asset deja de
 * poder generarse. Antes se devolvía en cada petición de un asset agotado (el contador mensual
 * bajaba sin límite) y nunca si la ejecución se rendía con el asset en FAILED_RETRYABLE.
 */

const config = {
  NODE_ENV: 'test',
  AUDIO_TTS_DATA_KEY_ID: 'k1',
  AUDIO_TTS_DATA_KEY: 'clave-de-prueba-16', // gitleaks:allow — fixture inventado
  AUDIO_TTS_DATA_KEYS_PREVIOUS: '',
  AUDIO_TTS_MONTHLY_BUDGET_UNITS: 1_000_000,
  AUDIO_TTS_SAFETY_RESERVE_UNITS: 0,
  AUDIO_TTS_PROVIDER: 'fake',
  AUDIO_GENERATION_LEASE_SECONDS: 60,
  AUDIO_QUEUE_RETRY_LIMIT: 3,
  AUDIO_SEGMENT_CACHE_ENABLED: false,
} as unknown as AudioTtsConfig;

function asset(parcial: Partial<AudioAssetRecord> = {}): AudioAssetRecord {
  return {
    id: 'a1',
    provider: 'fake',
    assetKey: 'ak',
    renderedTextEncrypted: buildCipher(config).encrypt('hola', 'ak'),
    reservedUnits: 50,
    status: 'FAILED_RETRYABLE',
    attempts: 1,
    createdAt: new Date('2026-09-30T23:59:00Z'),
    ...parcial,
  } as unknown as AudioAssetRecord;
}

function armar(repo: Record<string, jest.Mock>) {
  const quota = {
    releaseBudget: jest.fn().mockResolvedValue(undefined),
    settleBudget: jest.fn().mockResolvedValue(undefined),
    readBudget: jest.fn().mockResolvedValue({ reservedUnits: 0, settledUnits: 0 }),
    releaseActorGeneration: jest.fn(),
  };
  const logger = { child: () => logger, info: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const metrics = { increment: jest.fn(), observe: jest.fn() };
  const tts = {
    providerName: 'fake',
    synthesize: jest.fn().mockResolvedValue({
      audio: Buffer.from('a'),
      mimeType: 'audio/mpeg',
      usageUnits: 40,
      usageIsReported: true,
    }),
  };
  const storage = {
    store: jest.fn().mockResolvedValue({ storageUri: 's://a', checksumSha256: 'c', sizeBytes: 1 }),
  };
  const processor = new AudioGenerationProcessor(
    config,
    repo as never,
    {} as never,
    quota as never,
    storage as never,
    tts as never,
    logger as never,
    metrics as never,
  );
  return { processor, quota, tts };
}

describe('reserva de presupuesto de la locución', () => {
  it('un asset ya agotado NO vuelve a devolver su reserva en cada petición', async () => {
    const repo = {
      claimForGeneration: jest.fn().mockResolvedValue({
        outcome: 'EXHAUSTED',
        asset: asset({ status: 'FAILED_PERMANENT' }),
        transitioned: false,
      }),
    };
    const { processor, quota } = armar(repo);

    await processor.process('a1');
    await processor.process('a1');

    expect(quota.releaseBudget).not.toHaveBeenCalled();
  });

  it('la transición a agotado devuelve la reserva UNA vez, en el mes en que se hizo', async () => {
    const repo = {
      claimForGeneration: jest.fn().mockResolvedValue({
        outcome: 'EXHAUSTED',
        asset: asset(),
        transitioned: true,
      }),
    };
    const { processor, quota } = armar(repo);

    await processor.process('a1');

    expect(quota.releaseBudget).toHaveBeenCalledTimes(1);
    expect(quota.releaseBudget).toHaveBeenCalledWith({ provider: 'fake', monthKey: '2026-09' }, 50);
  });

  it('un fallo permanente repetido no devuelve la reserva dos veces', async () => {
    const repo = {
      claimForGeneration: jest.fn().mockResolvedValue({ outcome: 'CLAIMED', asset: asset() }),
      markFailed: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    };
    const { processor, quota, tts } = armar(repo);
    tts.synthesize.mockRejectedValue(new TtsProviderError('no', 'VOZ_INVALIDA', false));

    await processor.process('a1');
    await processor.process('a1');

    expect(quota.releaseBudget).toHaveBeenCalledTimes(1);
  });

  it('liquida contra el mes de la reserva, no contra el de hoy', async () => {
    const repo = {
      claimForGeneration: jest.fn().mockResolvedValue({ outcome: 'CLAIMED', asset: asset() }),
      markReady: jest.fn().mockResolvedValue(true),
    };
    const { processor, quota } = armar(repo);

    await processor.process('a1');

    expect(quota.settleBudget).toHaveBeenCalledWith(
      { provider: 'fake', monthKey: '2026-09' },
      50,
      40,
    );
  });

  it('abandon: la ejecución que se rinde con el asset reintentable devuelve la reserva', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(asset()),
      markFailed: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    };
    const { processor, quota } = armar(repo);

    await processor.abandon('a1');
    await processor.abandon('a1');

    expect(repo.markFailed).toHaveBeenCalledWith('a1', 'AUDIO_RUN_RETRIES_EXHAUSTED', false);
    expect(quota.releaseBudget).toHaveBeenCalledTimes(1);
  });

  it('abandon no toca un asset que ya quedó listo', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(asset({ status: 'READY' })),
      markFailed: jest.fn(),
    };
    const { processor, quota } = armar(repo);

    await processor.abandon('a1');

    expect(repo.markFailed).not.toHaveBeenCalled();
    expect(quota.releaseBudget).not.toHaveBeenCalled();
  });
});
