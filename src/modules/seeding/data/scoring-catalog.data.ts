import type { VariableSeed } from './types';

// Catálogo maestro de VARIABLES OBJETIVO (targets/outputs) que el motor de decisión
// produce: un score y una decisión por cada tipo de analítica, más los outputs de la
// decisión global. Son datos de referencia que se mantienen en producción — un artefacto
// declara cuáles emite mediante dependencias OUTPUT/OUTPUT_PRIMARY (output.<code>).
//
// Convención de unidades: SCORE_0_100 (puntaje normalizado), SCORE_0_1000 (escala de buró),
// PROBABILITY (0-1), PERCENT (0-100 %), BOB (bolivianos), MONTHS.

// ── Identidad / KYC ─────────────────────────────────────────────────────────
const identityScoring: VariableSeed[] = [
  {
    code: 'identity_verification_score',
    name: 'Puntaje de verificación de identidad',
    description:
      'Confianza agregada de que la identidad declarada es genuina y verificada (0-100).',
    type: 'NUMBER',
    kind: 'OUTPUT',
    unit: 'SCORE_0_100',
    validation: { minimum: 0, maximum: 100 },
  },
  {
    code: 'kyc_decision',
    name: 'Decisión KYC',
    description: 'Resultado del subproceso de identidad/KYC.',
    type: 'STRING',
    kind: 'OUTPUT',
    validation: { enum: ['PASS', 'REVIEW', 'FAIL'] },
  },
];

// ── Fraude ──────────────────────────────────────────────────────────────────
const fraudScoring: VariableSeed[] = [
  {
    code: 'fraud_score',
    name: 'Puntaje de fraude',
    description: 'Probabilidad consolidada de fraude en la solicitud (0-100).',
    type: 'NUMBER',
    kind: 'OUTPUT',
    unit: 'SCORE_0_100',
    validation: { minimum: 0, maximum: 100 },
  },
  {
    code: 'fraud_risk_band',
    name: 'Banda de riesgo de fraude',
    description: 'Clasificación categórica del riesgo de fraude.',
    type: 'STRING',
    kind: 'OUTPUT',
    validation: { enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
  },
  {
    code: 'fraud_decision',
    name: 'Decisión de fraude',
    description: 'Acción recomendada por el subproceso antifraude.',
    type: 'STRING',
    kind: 'OUTPUT',
    validation: { enum: ['CLEAR', 'REVIEW', 'BLOCK'] },
  },
];

// ── Riesgo de crédito ───────────────────────────────────────────────────────
const creditRiskScoring: VariableSeed[] = [
  {
    code: 'credit_risk_score',
    name: 'Puntaje de riesgo crediticio',
    description: 'Puntaje de riesgo de crédito calculado por el motor (0-1000).',
    type: 'INTEGER',
    kind: 'OUTPUT',
    unit: 'SCORE_0_1000',
    validation: { minimum: 0, maximum: 1000 },
  },
  {
    code: 'risk_band',
    name: 'Banda de riesgo',
    description: 'Clasificación categórica del riesgo crediticio asignada por el modelo.',
    type: 'STRING',
    kind: 'OUTPUT',
    validation: { enum: ['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'] },
  },
  {
    code: 'probability_of_default',
    name: 'Probabilidad de incumplimiento',
    description: 'Probabilidad estimada de default en el horizonte de la política (0-1).',
    type: 'NUMBER',
    kind: 'OUTPUT',
    unit: 'PROBABILITY',
    validation: { minimum: 0, maximum: 1 },
  },
  {
    code: 'expected_loss_amount',
    name: 'Pérdida esperada',
    description: 'Pérdida esperada estimada de la operación expresada en bolivianos.',
    type: 'NUMBER',
    kind: 'OUTPUT',
    unit: 'BOB',
    validation: { minimum: 0 },
  },
  {
    code: 'credit_risk_decision',
    name: 'Decisión de riesgo crediticio',
    description: 'Resultado del subproceso de riesgo de crédito.',
    type: 'STRING',
    kind: 'OUTPUT',
    validation: { enum: ['PASS', 'REVIEW', 'FAIL'] },
  },
];

// ── Capacidad de pago (affordability) ───────────────────────────────────────
const affordabilityScoring: VariableSeed[] = [
  {
    code: 'affordability_score',
    name: 'Puntaje de capacidad de pago',
    description: 'Puntaje que resume la capacidad de pago del solicitante (0-100).',
    type: 'NUMBER',
    kind: 'OUTPUT',
    unit: 'SCORE_0_100',
    validation: { minimum: 0, maximum: 100 },
  },
  {
    code: 'max_affordable_installment',
    name: 'Cuota máxima asumible',
    description: 'Cuota mensual máxima que el solicitante puede asumir según el análisis.',
    type: 'NUMBER',
    kind: 'OUTPUT',
    unit: 'BOB',
    validation: { minimum: 0 },
  },
  {
    code: 'affordability_decision',
    name: 'Decisión de capacidad de pago',
    description: 'Resultado del subproceso de capacidad de pago.',
    type: 'STRING',
    kind: 'OUTPUT',
    validation: { enum: ['PASS', 'FAIL'] },
  },
];

// ── Elegibilidad ────────────────────────────────────────────────────────────
const eligibilityScoring: VariableSeed[] = [
  {
    code: 'eligibility_score',
    name: 'Puntaje de elegibilidad',
    description:
      'Grado de ajuste del solicitante a los criterios de elegibilidad del producto (0-100).',
    type: 'NUMBER',
    kind: 'OUTPUT',
    unit: 'SCORE_0_100',
    validation: { minimum: 0, maximum: 100 },
  },
  {
    code: 'eligibility_decision',
    name: 'Decisión de elegibilidad',
    description: 'Resultado del subproceso de elegibilidad.',
    type: 'STRING',
    kind: 'OUTPUT',
    validation: { enum: ['ELIGIBLE', 'INELIGIBLE'] },
  },
];

// ── AML / Cumplimiento ──────────────────────────────────────────────────────
const amlComplianceScoring: VariableSeed[] = [
  {
    code: 'aml_risk_score',
    name: 'Puntaje de riesgo AML',
    description: 'Puntaje de riesgo de lavado de activos calculado por el motor (0-100).',
    type: 'NUMBER',
    kind: 'OUTPUT',
    unit: 'SCORE_0_100',
    sensitive: true,
    validation: { minimum: 0, maximum: 100 },
  },
  {
    code: 'aml_decision',
    name: 'Decisión AML',
    description: 'Acción recomendada por el subproceso AML.',
    type: 'STRING',
    kind: 'OUTPUT',
    sensitive: true,
    validation: { enum: ['CLEAR', 'REVIEW', 'BLOCK'] },
  },
  {
    code: 'compliance_decision',
    name: 'Decisión de cumplimiento',
    description: 'Resultado del subproceso de cumplimiento regulatorio.',
    type: 'STRING',
    kind: 'OUTPUT',
    validation: { enum: ['PASS', 'REVIEW', 'FAIL'] },
  },
];

// ── Cobranza / Recuperación ─────────────────────────────────────────────────
const collectionsScoring: VariableSeed[] = [
  {
    code: 'collections_priority_score',
    name: 'Puntaje de prioridad de cobranza',
    description: 'Prioridad de gestión de cobranza asignada a la cuenta (0-100).',
    type: 'NUMBER',
    kind: 'OUTPUT',
    unit: 'SCORE_0_100',
    validation: { minimum: 0, maximum: 100 },
  },
  {
    code: 'recovery_propensity_score',
    name: 'Puntaje de propensión a recuperar',
    description: 'Probabilidad estimada de recuperar la deuda en gestión (0-100).',
    type: 'NUMBER',
    kind: 'OUTPUT',
    unit: 'SCORE_0_100',
    validation: { minimum: 0, maximum: 100 },
  },
  {
    code: 'collections_strategy',
    name: 'Estrategia de cobranza',
    description: 'Estrategia de gestión recomendada para la cuenta en mora.',
    type: 'STRING',
    kind: 'OUTPUT',
    validation: {
      enum: ['SELF_CURE', 'SOFT_CONTACT', 'INTENSIVE_CONTACT', 'RESTRUCTURE', 'LEGAL', 'WRITE_OFF'],
    },
  },
];

// ── Decisión global (resultado de la política) ──────────────────────────────
const decisionScoring: VariableSeed[] = [
  {
    code: 'scoring',
    name: 'Puntaje ATLAS',
    description: 'Puntaje compuesto principal producido por la política de decisión.',
    type: 'NUMBER',
    kind: 'OUTPUT',
    unit: 'SCORE_0_1000',
    validation: { minimum: 0, maximum: 1000 },
  },
  {
    code: 'decision_outcome',
    name: 'Resultado de la decisión',
    description: 'Veredicto final de la política de decisión.',
    type: 'STRING',
    kind: 'OUTPUT',
    validation: { enum: ['APPROVED', 'APPROVED_WITH_CONDITIONS', 'DECLINED', 'MANUAL_REVIEW'] },
  },
  {
    code: 'decision_confidence',
    name: 'Confianza de la decisión',
    description: 'Confianza del motor en el resultado emitido (0-100).',
    type: 'NUMBER',
    kind: 'OUTPUT',
    unit: 'SCORE_0_100',
    validation: { minimum: 0, maximum: 100 },
  },
  {
    code: 'approved_amount',
    name: 'Monto aprobado',
    description: 'Monto de crédito aprobado expresado en bolivianos.',
    type: 'NUMBER',
    kind: 'OUTPUT',
    unit: 'BOB',
    validation: { minimum: 0 },
  },
  {
    code: 'approved_credit_limit',
    name: 'Línea de crédito aprobada',
    description: 'Límite de crédito asignado al solicitante expresado en bolivianos.',
    type: 'NUMBER',
    kind: 'OUTPUT',
    unit: 'BOB',
    validation: { minimum: 0 },
  },
  {
    code: 'approved_term_months',
    name: 'Plazo aprobado',
    description: 'Plazo del crédito aprobado expresado en meses.',
    type: 'INTEGER',
    kind: 'OUTPUT',
    unit: 'MONTHS',
    validation: { minimum: 0, maximum: 360 },
  },
  {
    code: 'annual_percentage_rate',
    name: 'Tasa anual efectiva',
    description: 'Tasa anual efectiva ofrecida para la operación aprobada.',
    type: 'NUMBER',
    kind: 'OUTPUT',
    unit: 'PERCENT',
    validation: { minimum: 0, maximum: 500 },
  },
  {
    code: 'pricing_tier',
    name: 'Nivel de precio (pricing)',
    description: 'Nivel de precio/tasa asignado según el riesgo del solicitante.',
    type: 'STRING',
    kind: 'OUTPUT',
    validation: { enum: ['A', 'B', 'C', 'D', 'E'] },
  },
  {
    code: 'adverse_action_reason_codes',
    name: 'Motivos de decisión adversa',
    description:
      'Lista serializada de reason codes que sustentan una decisión adversa (adverse action notice).',
    type: 'STRING',
    kind: 'OUTPUT',
  },
];

export const scoringCatalog: VariableSeed[] = [
  ...identityScoring,
  ...fraudScoring,
  ...creditRiskScoring,
  ...affordabilityScoring,
  ...eligibilityScoring,
  ...amlComplianceScoring,
  ...collectionsScoring,
  ...decisionScoring,
];
