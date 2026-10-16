import { AudioTtsController } from './audio-tts/audio-tts.controller';
import { BankStatementController } from './bank-statement/bank-statement.controller';
import { FinancialInstitutionController } from './bank-statement/institutions/financial-institution.controller';
import { IdentityReviewController } from './identity-verification/review/identity-review.controller';
import { IdentityVerificationController } from './identity-verification/identity-verification.controller';
import { SemanticAnalysisController } from './semantic-analysis/semantic-analysis.controller';
import { SemanticCategoryController } from './semantic-analysis/semantic-category.controller';
import { SemanticModelSettingsController } from './semantic-analysis/model-settings/semantic-model-settings.controller';
import { StatementReviewController } from './bank-statement/review/statement-review.controller';
import { StorageReferencesController } from './storage-references.controller';
import { UnresolvedClassificationController } from './semantic-analysis/unresolved-classification.controller';
import { WorkersController } from './workers.controller';
import { Module } from '@nestjs/common';
import { AtlasCallbackModule } from '../atlas-callback/atlas-callback.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkerMetricsService } from './worker-metrics.service';
import { WorkerServiceInvokerService } from './worker-service-invoker.service';
import { AUDIO_TTS_PROVIDERS } from './providers/audio-tts.providers';
import { BANK_STATEMENT_PROVIDERS } from './providers/bank-statement.providers';
import { IDENTITY_PORT_PROVIDERS } from './providers/identity-ports.providers';
import { IDENTITY_VERIFICATION_PROVIDERS } from './providers/identity-verification.providers';
import { SEMANTIC_ANALYSIS_PROVIDERS } from './providers/semantic-analysis.providers';
import { AudioTtsRuntimeFactory } from './audio-tts/audio-tts.runtime';
import { AudioTtsService } from './audio-tts/audio-tts.service';
import { SemanticAnalysisService } from './semantic-analysis/semantic-analysis.service';

/**
 * Workers adicionales (ADR-0026): análisis semántico, extractos bancarios,
 * verificación de identidad y locución.
 *
 * Un módulo con **cuatro workers independientes dentro**. Comparten el catálogo
 * (`/v1/workers`) y la forma de sus ejecuciones, y nada más: cada uno tiene su
 * tabla, su trabajo de fondo, su processor, su configuración y sus pruebas.
 * Fundirlos en un processor común para ahorrar archivos habría acoplado un
 * fallo del lector de PDF con la cuota de un proveedor de modelos.
 *
 * El grueso de este archivo es el cableado de los puertos del worker semántico,
 * y ese es justamente el trabajo que su arquitectura hexagonal permitía hacer
 * **sin tocar su núcleo**: donde el paquete traía pg-boss, Sequelize y un
 * registro de Prometheus propios, ahora hay adaptadores contra la cola, el ORM
 * y el recolector que el motor ya tenía.
 *
 * No declara `imports`: los dos trabajos se registran solos en
 * `JobSchedulerService`, que es global, y la persistencia va por `PrismaService`.
 * Los servicios de fondo consultan `WORKER_ROLE` en su propio `onModuleInit`,
 * así que cargar este módulo en una réplica de API no arranca ningún worker.
 */
@Module({
  // La bandeja del motor, para avisar de un valor sin clasificar por el canal
  // estandar en vez de inventar uno propio.
  imports: [NotificationsModule, AtlasCallbackModule],
  controllers: [
    WorkersController,
    StorageReferencesController,
    AudioTtsController,
    BankStatementController,
    StatementReviewController,
    FinancialInstitutionController,
    SemanticModelSettingsController,
    IdentityVerificationController,
    IdentityReviewController,
    SemanticAnalysisController,
    SemanticCategoryController,
    UnresolvedClassificationController,
  ],
  providers: [
    ...BANK_STATEMENT_PROVIDERS,
    ...AUDIO_TTS_PROVIDERS,
    ...IDENTITY_VERIFICATION_PROVIDERS,
    ...IDENTITY_PORT_PROVIDERS,
    ...SEMANTIC_ANALYSIS_PROVIDERS,
    /**
     * Puente con el motor de decisión: un nodo `WORKER` del grafo llama a los servicios de
     * estos workers y proyecta su respuesta a variables intermedias. Vive aquí porque quien
     * conoce a los workers es este módulo; el motor solo conoce la interfaz
     * `WorkerServiceInvoker`, que recibe como argumento de llamada.
     */
    WorkerServiceInvokerService,
    // Salud de los workers: mide lo único que comparten, el ciclo de vida de sus ejecuciones.
    WorkerMetricsService,
  ],
  exports: [
    AudioTtsService,
    AudioTtsRuntimeFactory,
    SemanticAnalysisService,
    WorkerServiceInvokerService,
  ],
})
export class WorkersModule {}
