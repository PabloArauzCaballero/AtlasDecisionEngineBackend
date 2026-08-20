/** Datos ficticios de `credit-analysis-report@1.1.0`: los de la 1.0.0 más el desglose. */
import { creditAnalysisFixtureV1 } from '../1.0.0/preview.fixture';
import type { CreditAnalysisPayloadV11 } from './schema';

export const creditAnalysisFixtureV11 = (): CreditAnalysisPayloadV11 => ({
  ...creditAnalysisFixtureV1(),
  factors: [
    { code: 'dti_ratio', label: 'Relación cuota/ingreso', contribution: 84, value: 0.28 },
    { code: 'bureau_score', label: 'Puntaje de buró', contribution: 61, value: 712 },
    { code: 'tenure_months', label: 'Antigüedad laboral', contribution: 37, value: 74 },
    { code: 'inquiries_6m', label: 'Consultas al buró (6 meses)', contribution: -45, value: 6 },
    { code: 'delinquency_24m', label: 'Mora en 24 meses', contribution: 0, value: false },
  ],
});
