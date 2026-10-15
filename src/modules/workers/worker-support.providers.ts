import { BANK_STATEMENT_RUN_PROVIDERS } from './bank-statement/bank-statement-run.providers';
import { SEMANTIC_PIPELINE_STAGE_PROVIDERS } from './semantic-analysis/core/application/semantic-pipeline.providers';
import { SERVICE_CALL_PROVIDERS } from './service-calls/service-call.providers';

/** Los colaboradores internos de los workers: etapas semánticas, almacén de extractos y llamadas de nodo. */
export const WORKER_SUPPORT_PROVIDERS = [
  ...SEMANTIC_PIPELINE_STAGE_PROVIDERS,
  ...BANK_STATEMENT_RUN_PROVIDERS,
  ...SERVICE_CALL_PROVIDERS,
];
