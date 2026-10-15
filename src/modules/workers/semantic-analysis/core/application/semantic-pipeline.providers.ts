import { CandidateRetrievalStage } from './candidate-retrieval.stage';
import { GlosaFallbackClassifier } from './glosa-fallback';
import { GlosaPreparationStage } from './glosa-preparation.stage';
import { RuleSafetyNet } from './rule-safety-net';
import { TieredModelClassifier } from './tiered-model-classifier';

/** Las etapas del pipeline semántico, sin el pipeline que las orquesta. */
export const SEMANTIC_PIPELINE_STAGE_PROVIDERS = [
  GlosaFallbackClassifier,
  RuleSafetyNet,
  GlosaPreparationStage,
  CandidateRetrievalStage,
  TieredModelClassifier,
];
