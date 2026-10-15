import { z } from 'zod';
import { runtimeCoreEnv } from './runtime-core.env';
import { jobsEnv } from './jobs.env';
import { dataStoresEnv } from './data-stores.env';
import { authEnv } from './auth.env';
import { httpAndObservabilityEnv } from './http-and-observability.env';
import { engineAndQaEnv } from './engine-and-qa.env';
import { semanticWorkerEnv } from './semantic-worker.env';
import { bankStatementEnv } from './bank-statement.env';
import { identityWorkerEnv } from './identity-worker.env';
import { audioTtsEnv } from './audio-tts.env';
import { scriptsAndRetentionEnv } from './scripts-and-retention.env';
import { nestedTreesAndOutboxEnv } from './nested-trees-and-outbox.env';
import { bootstrapEnv } from './bootstrap.env';
import { objectStorageEnv } from './object-storage.env';
import { callbackAndMonitoringEnv } from './callback-and-monitoring.env';
import { semanticTuningEnv } from './semantic-tuning.env';

/** Todas las variables de entorno, por dominio; el orden de los `...` es el orden del catálogo. */
export const envObject = z.object({
  ...runtimeCoreEnv,
  ...jobsEnv,
  ...dataStoresEnv,
  ...authEnv,
  ...httpAndObservabilityEnv,
  ...engineAndQaEnv,
  ...semanticWorkerEnv,
  ...bankStatementEnv,
  ...identityWorkerEnv,
  ...audioTtsEnv,
  ...scriptsAndRetentionEnv,
  ...nestedTreesAndOutboxEnv,
  ...bootstrapEnv,
  ...objectStorageEnv,
  ...callbackAndMonitoringEnv,
  ...semanticTuningEnv,
});

export type RawEnv = z.infer<typeof envObject>;
