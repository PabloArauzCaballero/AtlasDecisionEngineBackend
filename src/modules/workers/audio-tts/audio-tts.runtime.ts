/**
 * Arma el núcleo del worker de locución para UN tenant.
 *
 * El paquete cableaba sus piezas con el contenedor de Nest y una sola conexión:
 * servía a una organización. En el motor hay muchas, y ni el catálogo de
 * plantillas ni la caché de audio ni el presupuesto pueden compartirse entre
 * ellas. Como el puerto del repositorio no lleva `tenantId` en ninguna firma
 * —no lo necesitaba—, el aislamiento vive en la INSTANCIA: aquí se construyen
 * un repositorio, una contabilidad y un almacenamiento ya atados al tenant, y
 * el núcleo se monta encima sin enterarse.
 *
 * Lo que sí es único por proceso es el proveedor TTS: sostiene el cortacircuitos,
 * el mamparo y el limitador de peticiones, que miden la salud del PROVEEDOR y
 * no la de un tenant. Construir uno por ejecución daría a cada una un
 * cortacircuitos recién cerrado, y entonces no protege de nada.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../../../common/observability/metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { EngineAudioLogger, EngineAudioMetrics } from './adapters/engine-audio-observability';
import { PrismaAudioAssetRepository } from './adapters/prisma-audio-asset.repository';
import { PrismaAudioQuotaRepository } from './adapters/prisma-audio-quota.repository';
import { PrismaAudioSegmentRepository } from './adapters/prisma-audio-segment.repository';
import { PrismaAudioStorageAdapter } from './adapters/prisma-audio-storage.adapter';
import { RunScopedAudioQueue } from './adapters/run-scoped-audio-queue';
import { buildAudioTtsConfig } from './audio-tts-config.bridge';
import type { AudioTtsConfig } from './core/config/audio-tts.env';
import type { AudioStoragePort } from './core/domain/ports/audio-storage.port';
import type { TtsProviderPort } from './core/domain/ports/tts-provider.port';
import { AudioAssetResolver } from './core/application/audio-asset-resolver.service';
import { AudioGenerationProcessor } from './core/application/audio-generation.processor';
import { LocalAudioStorageAdapter } from './core/infrastructure/storage/local-audio-storage.adapter';
import { DisabledTtsAdapter } from './core/infrastructure/tts/disabled-tts.adapter';
import { ElevenLabsHttpClient } from './core/infrastructure/tts/elevenlabs/elevenlabs-http.client';
import { ElevenLabsTtsAdapter } from './core/infrastructure/tts/elevenlabs/elevenlabs-tts.adapter';
import { FakeTtsAdapter } from './core/infrastructure/tts/fake-tts.adapter';

/** El núcleo ya atado a un tenant, listo para resolver y para generar. */
export interface AudioTtsRuntime {
  config: AudioTtsConfig;
  resolver: AudioAssetResolver;
  processor: AudioGenerationProcessor;
  repository: PrismaAudioAssetRepository;
  storage: AudioStoragePort;
  /** Lo que el resolutor dejó pendiente de generar, si dejó algo. */
  queue: RunScopedAudioQueue;
}

@Injectable()
export class AudioTtsRuntimeFactory {
  private readonly logger = new Logger(AudioTtsRuntimeFactory.name);
  private provider?: TtsProviderPort;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  /** La configuración del núcleo, resuelta una vez por llamada. */
  coreConfig(): AudioTtsConfig {
    return buildAudioTtsConfig(this.config);
  }

  forTenant(tenantId: bigint): AudioTtsRuntime {
    const core = this.coreConfig();
    const repository = new PrismaAudioAssetRepository(this.prisma, tenantId);
    const quota = new PrismaAudioQuotaRepository(this.prisma, tenantId);
    const storage = this.storageFor(core, tenantId);
    const queue = new RunScopedAudioQueue();
    const logger = new EngineAudioLogger({ tenantId: tenantId.toString() });
    const metrics = new EngineAudioMetrics(this.metrics);

    return {
      config: core,
      repository,
      storage,
      queue,
      resolver: new AudioAssetResolver(core, repository, quota, queue, logger, metrics),
      processor: new AudioGenerationProcessor(
        core,
        repository,
        new PrismaAudioSegmentRepository(this.prisma, tenantId),
        quota,
        storage,
        this.ttsProvider(core),
        logger,
        metrics,
      ),
    };
  }

  /** El nombre del proveedor activo. Lo publica el catálogo. */
  providerName(): string {
    return this.coreConfig().AUDIO_TTS_PROVIDER;
  }

  /**
   * El almacenamiento del despliegue.
   *
   * El de base va atado al tenant —los bytes viven en la fila del asset, bajo
   * su misma política de aislamiento—; el de disco del paquete no puede estarlo
   * y por eso queda para desarrollo, donde hay un solo tenant y a nadie le
   * importa que el directorio se vaya con el contenedor.
   */
  private storageFor(core: AudioTtsConfig, tenantId: bigint): AudioStoragePort {
    if (core.AUDIO_STORAGE_DRIVER === 'local') {
      return new LocalAudioStorageAdapter(core);
    }
    return new PrismaAudioStorageAdapter(this.prisma, tenantId);
  }

  /**
   * Perezoso y memorizado.
   *
   * Perezoso porque construir el adaptador de ElevenLabs levanta el mamparo, el
   * limitador y el cortacircuitos, y un proceso con el worker apagado no debe
   * pagar nada de eso. Memorizado porque esos tres son el estado que hace que
   * protejan: uno nuevo por ejecución no protege de nada.
   */
  private ttsProvider(core: AudioTtsConfig): TtsProviderPort {
    if (this.provider) return this.provider;
    if (core.AUDIO_TTS_PROVIDER === 'elevenlabs') {
      this.provider = new ElevenLabsTtsAdapter(
        core,
        new EngineAudioMetrics(this.metrics),
        new ElevenLabsHttpClient(core),
      );
    } else if (core.AUDIO_TTS_PROVIDER === 'fake') {
      // Sintetiza un MP3 válido y determinista, sin salir a la red ni gastar
      // cuota. El esquema de entorno lo prohíbe en producción: un audio de
      // prueba servido a una persona real sería peor que no servir ninguno.
      this.provider = new FakeTtsAdapter();
      this.logger.warn('Proveedor de locución «fake»: el audio generado no es una voz real');
    } else {
      this.provider = new DisabledTtsAdapter();
    }
    return this.provider;
  }
}
