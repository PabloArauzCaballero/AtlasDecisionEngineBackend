/** Datos ficticios de `credit-analysis-report@1.0.0`. */
import type { CreditAnalysisPayloadV1 } from './schema';

export const creditAnalysisFixtureV1 = (): CreditAnalysisPayloadV1 => ({
  customerName: 'Juan Pérez Añez',
  customerDocument: '4821903 SC',
  score: 782,
  decision: 'REVIEW',
  amount: 50_000,
  currency: 'BOB',
  termMonths: 36,
  evaluatedAt: '2026-02-11T14:32:00.000Z',
  reasons: [
    'Relación cuota/ingreso dentro del umbral (0,28 frente a 0,35).',
    'Seis consultas al buró en los últimos seis meses; el umbral son cuatro.',
    'Sin mora registrada en los últimos 24 meses.',
  ],
});
