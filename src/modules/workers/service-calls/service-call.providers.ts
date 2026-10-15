import { AudioSpeakCallHandler } from './audio-speak-call.handler';
import { BankStatementCallHandler } from './bank-statement-call.handler';
import { IdentityVerificationCallHandler } from './identity-verification-call.handler';
import { SemanticClassificationCallHandler } from './semantic-classification-call.handler';

/** Un manejador por servicio worker que un nodo del grafo puede invocar. */
export const SERVICE_CALL_PROVIDERS = [
  BankStatementCallHandler,
  SemanticClassificationCallHandler,
  AudioSpeakCallHandler,
  IdentityVerificationCallHandler,
];
