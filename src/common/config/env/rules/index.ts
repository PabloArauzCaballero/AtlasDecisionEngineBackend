import { retainIdentityImagesOnlyWithStorage } from './object-storage.rules';
import { keepIdempotencyLeaseAboveLongestDecision } from './runtime-coherence.rules';
import { requireWellFormedRetiredAuditSecrets } from './audit-hash.rules';
import { requireWellFormedDataRoutingRules } from './data-routing.rules';
import { requireCredentialsForAuthMode } from './auth.rules';
import { requireCoherentIdentityThresholds } from './identity-coherence.rules';
import { requireCoherentAudioTtsSettings } from './audio-tts-coherence.rules';
import { forbidFakeAudioInProduction } from './production/audio-tts-production.rules';
import { requireSemanticWorkerSafeguards } from './production/semantic-production.rules';
import { requireCalibratedIdentityInProduction } from './production/identity-production.rules';
import { requireAtlasCallbackPair } from './production/atlas-callback-production.rules';
import { requireHardenedPlatformInProduction } from './production/platform-production.rules';
import type { EnvRule } from './env-rule';

/** Valen en cualquier entorno, en este orden. */
export const ALWAYS_RULES: readonly EnvRule[] = [
  retainIdentityImagesOnlyWithStorage,
  keepIdempotencyLeaseAboveLongestDecision,
  requireWellFormedRetiredAuditSecrets,
  requireWellFormedDataRoutingRules,
  requireCredentialsForAuthMode,
  requireCoherentIdentityThresholds,
  requireCoherentAudioTtsSettings,
];

/** Sólo cuando NODE_ENV=production, en este orden. */
export const PRODUCTION_RULES: readonly EnvRule[] = [
  forbidFakeAudioInProduction,
  requireSemanticWorkerSafeguards,
  requireCalibratedIdentityInProduction,
  requireAtlasCallbackPair,
  requireHardenedPlatformInProduction,
];
