import type { Prisma, PrismaClient } from '@prisma/client';

export interface ConditionDefinition {
  code: string;
  name: string;
  expression: unknown;
}
export interface ActionDefinition {
  code: string;
  type: string;
  payload: Record<string, unknown>;
  terminal: boolean;
  reason?: string;
}
export interface NodeDefinition {
  key: string;
  type: string;
  label: string;
  order: number;
  terminal: boolean;
  config: Record<string, unknown>;
}
export interface EdgeDefinition {
  key: string;
  from: string;
  to: string;
  priority: number;
  default: boolean;
  condition?: string;
}

export interface DemoGraphResult {
  conditionDefinitions: ConditionDefinition[];
  actionDefinitions: ActionDefinition[];
  nodeDefinitions: NodeDefinition[];
  nodeActionBindings: Record<string, string[]>;
  edgeDefinitions: EdgeDefinition[];
  conditionByCode: Record<string, { id: bigint }>;
  actionByCode: Record<string, { id: bigint }>;
  nodeByKey: Record<string, { id: bigint }>;
  edgeRows: Array<{ row: { id: bigint }; definition: EdgeDefinition }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Expression-AST builders. Thin wrappers around the JSON shapes ExpressionEvaluator
// understands (src/modules/graph/expression-evaluator.ts) — the evaluator has no
// pow/log/exp/now(), only and/or/not/if/eq/gt/gte/lt/lte/in/add/sub/mul/div/min/max/round.
// Every formula below is deliberately built from that set (see the design notes in the
// per-domain sections): additive point scorecards and banded (nested-if) lookups, which is
// how real bureau/behavioral scorecards are implemented anyway (WoE-bucketed points, not a
// raw sigmoid) — see docs/nested-decision-trees.md for the broader graph model this composes
// into.
// ─────────────────────────────────────────────────────────────────────────────
const V = (path: string) => ({ var: path });
const L = (value: unknown) => ({ value });
const EQ = (left: unknown, right: unknown) => ({ op: 'eq', left, right });
const GT = (left: unknown, right: unknown) => ({ op: 'gt', left, right });
const GTE = (left: unknown, right: unknown) => ({ op: 'gte', left, right });
const LT = (left: unknown, right: unknown) => ({ op: 'lt', left, right });
const LTE = (left: unknown, right: unknown) => ({ op: 'lte', left, right });
const IN = (left: unknown, values: unknown[]) => ({ op: 'in', left, right: L(values) });
const AND = (...args: unknown[]) => ({ op: 'and', args });
const OR = (...args: unknown[]) => ({ op: 'or', args });
const NOT = (arg: unknown) => ({ op: 'not', arg });
const IF = (condition: unknown, then: unknown, els: unknown) => ({
  op: 'if',
  condition,
  then,
  else: els,
});
const ADD = (...args: unknown[]) => ({ op: 'add', args });
const MUL = (...args: unknown[]) => ({ op: 'mul', args });
const MIN = (...args: unknown[]) => ({ op: 'min', args });
const MAX = (...args: unknown[]) => ({ op: 'max', args });
const ROUND = (arg: unknown, precision = 0) => ({ op: 'round', arg, precision });
/** Clamps a numeric expression to [lo, hi]. */
const CLAMP = (arg: unknown, lo: number, hi: number) => MIN(MAX(arg, L(lo)), L(hi));
/** A boolean input coerces to 1/0 under add/mul (ExpressionEvaluator.asNumber(true) === 1). */
const IF_TRUE = (variableCode: string, points: number) => MUL(V(variableCode), L(points));
// Shorthand for referencing an output this same execution already computed in an earlier node.
// Uses the `decision.output.<code>` namespace, not a bare `output.<code>`: the runtime exposes
// both (execution-engine.service.ts `context()`), but only the `decision.*` namespace is on the
// graph expression validator's allowlist (graph-expression.validator.ts) — a bare `output.*`
// root would be flagged UNDECLARED_VARIABLE_DEPENDENCY since no variable is literally named
// "output".
const OUT = (code: string) => V(`decision.output.${code}`);

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1 — Identity / KYC. Weighted identity-assurance score (mirrors combining verification
// strength across evidence types, as in NIST 800-63A IAL) plus a small set of hard KYC gates.
// ─────────────────────────────────────────────────────────────────────────────
const identityVerificationScoreExpr = ROUND(
  ADD(
    MUL(V('identity_confidence_score'), L(0.3)),
    MUL(V('biometric_match_score'), L(0.2)),
    IF_TRUE('national_id_verified', 15),
    IF_TRUE('liveness_check_passed', 15),
    IF_TRUE('address_verified', 10),
    IF_TRUE('phone_verified', 5),
    IF_TRUE('email_verified', 5),
  ),
);
const kycDecisionExpr = IF(
  OR(EQ(V('kyc_status'), L('REJECTED')), NOT(V('consent_active')), NOT(V('liveness_check_passed')), NOT(V('national_id_verified'))),
  L('FAIL'),
  IF(
    OR(EQ(V('kyc_status'), L('PENDING')), V('pep_status'), LT(OUT('identity_verification_score'), L(60))),
    L('REVIEW'),
    L('PASS'),
  ),
);

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 — Fraud. Additive risk-point model (as in rules+score hybrid fraud engines, e.g.
// Sift/Kount/Feedzai): continuous provider scores contribute proportionally, known-bad facts
// add fixed penalties. BLOCK is reserved for confirmed/known-bad facts only (never for an
// opaque score alone), so every automatic decline still has a concrete, named cause.
// ─────────────────────────────────────────────────────────────────────────────
const fraudScoreExpr = ROUND(
  CLAMP(
    ADD(
      IF_TRUE('known_fraud_device_flag', 35),
      IF_TRUE('known_fraud_email_flag', 30),
      IF_TRUE('known_fraud_phone_flag', 30),
      IF_TRUE('previous_fraud_case_flag', 40),
      IF(EQ(V('device_reputation'), L('BLOCKLISTED')), L(25), IF(EQ(V('device_reputation'), L('SUSPICIOUS')), L(12), L(0))),
      IF_TRUE('sim_swap_detected', 20),
      IF_TRUE('geolocation_mismatch_flag', 15),
      IF_TRUE('browser_automation_detected', 15),
      IF_TRUE('ip_tor_detected', 10),
      IF_TRUE('fraud_signal', 20),
      MUL(V('device_risk_score'), L(0.15)),
      MUL(V('ip_address_risk_score'), L(0.15)),
      MUL(V('synthetic_identity_score'), L(0.2)),
      MUL(V('account_takeover_risk_score'), L(0.1)),
      IF(GTE(V('velocity_applications_24h'), L(5)), L(10), IF(GTE(V('velocity_applications_24h'), L(3)), L(5), L(0))),
    ),
    0,
    100,
  ),
);
const fraudRiskBandExpr = IF(
  LT(OUT('fraud_score'), L(25)),
  L('LOW'),
  IF(LT(OUT('fraud_score'), L(50)), L('MEDIUM'), IF(LT(OUT('fraud_score'), L(75)), L('HIGH'), L('CRITICAL'))),
);
const fraudDecisionExpr = IF(
  OR(V('known_fraud_device_flag'), V('known_fraud_email_flag'), V('known_fraud_phone_flag'), V('previous_fraud_case_flag'), EQ(V('device_reputation'), L('BLOCKLISTED'))),
  L('BLOCK'),
  IF(OR(GTE(OUT('fraud_score'), L(40)), V('sim_swap_detected'), V('ip_tor_detected')), L('REVIEW'), L('CLEAR')),
);

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 — Eligibility. A hard-gate checklist (age/employment/amount/term), not a points
// threshold: real underwriting eligibility screens are binary pass/fail gates run before the
// continuous risk model, unlike credit risk itself which genuinely is probabilistic. Keeping
// eligibility_score purely diagnostic (share of gates passed) keeps it consistent with
// eligibility_decision being an exact AND of the same gates used to route declines below.
// ─────────────────────────────────────────────────────────────────────────────
const eligibilityAgeFail = LT(V('age'), L(18));
const eligibilityEmploymentFail = IN(V('employment_status'), ['UNEMPLOYED', 'STUDENT']);
const eligibilityAmountFail = OR(LT(V('requested_amount'), L(200)), GT(V('requested_amount'), L(15000)));
const eligibilityTermFail = OR(LT(V('requested_term_months'), L(1)), GT(V('requested_term_months'), L(24)));
const eligibilityScoreExpr = ADD(
  IF(NOT(eligibilityAgeFail), L(25), L(0)),
  IF(NOT(eligibilityEmploymentFail), L(25), L(0)),
  IF(NOT(eligibilityAmountFail), L(25), L(0)),
  IF(NOT(eligibilityTermFail), L(25), L(0)),
);
const eligibilityDecisionExpr = IF(
  OR(eligibilityAgeFail, eligibilityEmploymentFail, eligibilityAmountFail, eligibilityTermFail),
  L('INELIGIBLE'),
  L('ELIGIBLE'),
);

// ─────────────────────────────────────────────────────────────────────────────
// Stage 4 — Credit risk. Additive scorecard (offset + WoE-style banded point contributions),
// the standard way real bureau/custom scorecards are built — not a raw logistic sigmoid, which
// this DSL cannot express anyway (no exp/log). probability_of_default reads the score off a
// calibrated master scale (rating-grade PD term structure, as under Basel/IFRS9) instead of
// computing a sigmoid — a fixed lookup table is equally realistic and stays exactly
// deterministic. expected_loss_amount applies the textbook EL = PD x LGD x EAD identity, with a
// flat unsecured-retail LGD benchmark (BNPL originations here are unsecured, so no collateral
// term applies).
// ─────────────────────────────────────────────────────────────────────────────
const creditRiskBankruptcyFail = V('bankruptcy_flag');
const creditRiskChargeOffFail = OR(GT(V('charge_off_count'), L(0)), EQ(V('worst_delinquency_status'), L('CHARGE_OFF')));
const utilizationPoints = IF(
  LT(V('revolving_utilization_ratio'), L(0.3)),
  L(40),
  IF(LT(V('revolving_utilization_ratio'), L(0.6)), L(15), IF(LT(V('revolving_utilization_ratio'), L(0.9)), L(-15), L(-40))),
);
const dtiPoints = IF(
  LT(V('debt_to_income_ratio'), L(0.2)),
  L(40),
  IF(LT(V('debt_to_income_ratio'), L(0.36)), L(15), IF(LT(V('debt_to_income_ratio'), L(0.5)), L(-15), L(-45))),
);
const delinquencyPoints = IF(EQ(V('delinquency_count_12m'), L(0)), L(30), IF(LTE(V('delinquency_count_12m'), L(2)), L(-20), L(-60)));
const inquiryPoints = IF(LTE(V('inquiries_last_6m'), L(2)), L(10), IF(LTE(V('inquiries_last_6m'), L(5)), L(-5), L(-20)));
const hardDerogatoryPenalty = IF(OR(creditRiskBankruptcyFail, creditRiskChargeOffFail), L(-300), L(0));
const publicRecordPoints = IF(EQ(V('public_records_count'), L(0)), L(10), L(-40));
const thinFilePoints = IF(OR(V('thin_file_flag'), V('no_hit_flag')), L(-50), L(0));
const historyLengthPoints = IF(GTE(V('oldest_trade_age_months'), L(60)), L(20), IF(GTE(V('oldest_trade_age_months'), L(24)), L(10), L(0)));
const creditRiskScoreExpr = ROUND(
  CLAMP(
    ADD(
      L(100),
      MUL(V('bureau_score'), L(0.45)),
      MUL(V('payment_history_score'), L(0.8)),
      MUL(V('credit_mix_score'), L(0.2)),
      utilizationPoints,
      dtiPoints,
      delinquencyPoints,
      inquiryPoints,
      hardDerogatoryPenalty,
      publicRecordPoints,
      thinFilePoints,
      historyLengthPoints,
    ),
    0,
    1000,
  ),
);
const riskBandExpr = IF(
  GTE(OUT('credit_risk_score'), L(750)),
  L('LOW'),
  IF(GTE(OUT('credit_risk_score'), L(600)), L('MEDIUM'), IF(GTE(OUT('credit_risk_score'), L(450)), L('HIGH'), L('VERY_HIGH'))),
);
// Master-scale PD calibration (anchor points typical of a retail unsecured rating-grade term
// structure) rather than a computed sigmoid — see the stage banner comment above.
const probabilityOfDefaultExpr = IF(
  GTE(OUT('credit_risk_score'), L(850)),
  L(0.005),
  IF(
    GTE(OUT('credit_risk_score'), L(750)),
    L(0.015),
    IF(
      GTE(OUT('credit_risk_score'), L(650)),
      L(0.035),
      IF(
        GTE(OUT('credit_risk_score'), L(550)),
        L(0.07),
        IF(GTE(OUT('credit_risk_score'), L(450)), L(0.13), IF(GTE(OUT('credit_risk_score'), L(350)), L(0.22), L(0.35))),
      ),
    ),
  ),
);
// Flat unsecured-retail LGD benchmark (~80%, within the typical 75-90% Basel IRB retail-unsecured
// range) — BNPL originations here carry no collateral term.
const UNSECURED_LGD = 0.8;
const expectedLossAmountExpr = ROUND(MUL(OUT('probability_of_default'), L(UNSECURED_LGD), V('requested_amount')), 2);
const creditRiskDecisionExpr = IF(
  OR(creditRiskBankruptcyFail, creditRiskChargeOffFail, LT(OUT('credit_risk_score'), L(450))),
  L('FAIL'),
  IF(LT(OUT('credit_risk_score'), L(600)), L('REVIEW'), L('PASS')),
);

// ─────────────────────────────────────────────────────────────────────────────
// Stage 5 — Affordability. Residual-income (disposable-income) method: a fixed ceiling on the
// share of *disposable* income committable to debt service is the same logic behind the
// classic mortgage 28/36 rule and the CFPB ATR/QM 43% DTI backstop — 35% of disposable income
// sits between those as a conservative BNPL/consumer-credit policy ceiling.
// ─────────────────────────────────────────────────────────────────────────────
const affordabilityRatioFail = GT(V('affordability_ratio'), L(0.45));
const affordabilityNsfFail = GTE(V('bank_statement_nsf_count'), L(6));
const affordabilityRatioPenalty = IF(
  GT(V('affordability_ratio'), L(0.4)),
  L(-50),
  IF(GT(V('affordability_ratio'), L(0.3)), L(-20), IF(GT(V('affordability_ratio'), L(0.2)), L(0), L(10))),
);
// min(nsf, 3) * -10: capped at -30 so a handful of NSF events don't dominate the score.
const nsfPenalty = MUL(MIN(V('bank_statement_nsf_count'), L(3)), L(-10));
const selfEmployedPenalty = IF(AND(V('self_employed_flag'), NOT(V('tax_return_verified'))), L(-15), L(0));
const affordabilityScoreExpr = CLAMP(
  ADD(L(100), affordabilityRatioPenalty, MUL(V('income_stability_score'), L(0.2)), nsfPenalty, selfEmployedPenalty),
  0,
  100,
);
const MAX_AFFORDABLE_SHARE_OF_DISPOSABLE_INCOME = 0.35;
const maxAffordableInstallmentExpr = ROUND(MUL(V('disposable_income'), L(MAX_AFFORDABLE_SHARE_OF_DISPOSABLE_INCOME)), 2);
const affordabilityDisposableFail = OR(LTE(V('disposable_income'), L(0)), LT(OUT('affordability_score'), L(40)));
const affordabilityDecisionExpr = IF(
  OR(affordabilityRatioFail, affordabilityNsfFail, affordabilityDisposableFail),
  L('FAIL'),
  L('PASS'),
);

// ─────────────────────────────────────────────────────────────────────────────
// Stage 6 — AML / sanctions. FATF/Wolfsberg-style weighted customer risk-rating factors.
// A confirmed sanctions/OFAC hit is a legal hard-block (SANCTIONS_CONFIRMED_MATCH — added to
// the reason catalog for this; the existing OFAC_POTENTIAL_MATCH is deliberately softer and
// review-only), everything else is a weighted score feeding CLEAR/REVIEW.
// ─────────────────────────────────────────────────────────────────────────────
const amlSanctionsConfirmed = OR(EQ(V('ofac_screening_result'), L('MATCH')), EQ(V('sanctions_screening_result'), L('CONFIRMED_MATCH')));
const pepIsHighRisk = OR(EQ(V('pep_relationship_type'), L('SELF')), EQ(V('pep_relationship_type'), L('FAMILY')), EQ(V('pep_relationship_type'), L('CLOSE_ASSOCIATE')));
const amlRiskScoreExpr = CLAMP(
  ADD(
    IF(EQ(V('ofac_screening_result'), L('MATCH')), L(30), IF(EQ(V('ofac_screening_result'), L('REVIEW_REQUIRED')), L(12), L(0))),
    IF(EQ(V('pep_relationship_type'), L('SELF')), L(25), IF(pepIsHighRisk, L(15), L(0))),
    IF(EQ(V('sanctions_screening_result'), L('CONFIRMED_MATCH')), L(20), IF(EQ(V('sanctions_screening_result'), L('POTENTIAL_MATCH')), L(10), L(0))),
    IF_TRUE('high_risk_jurisdiction_flag', 15),
    IF_TRUE('adverse_media_hit', 15),
    IF(NOT(V('source_of_funds_verified')), L(10), L(0)),
  ),
  0,
  100,
);
const amlDecisionExpr = IF(
  amlSanctionsConfirmed,
  L('BLOCK'),
  IF(OR(GTE(OUT('aml_risk_score'), L(40)), pepIsHighRisk, V('high_risk_jurisdiction_flag'), V('adverse_media_hit')), L('REVIEW'), L('CLEAR')),
);
const complianceDecisionExpr = IF(EQ(OUT('aml_decision'), L('BLOCK')), L('FAIL'), IF(EQ(OUT('aml_decision'), L('REVIEW')), L('REVIEW'), L('PASS')));

// ─────────────────────────────────────────────────────────────────────────────
// Final composition. `scoring` blends the domain scores the way a "second-generation" BNPL
// score typically blends bureau + behavioral + identity signals; pricing_tier/APR follow the
// standard risk-based-pricing grid pattern (ECOA risk-based-pricing notices assume exactly this
// shape: a risk tier maps to a rate premium, capped by the jurisdiction's usury ceiling).
// ─────────────────────────────────────────────────────────────────────────────
const scoringExpr = ROUND(
  CLAMP(
    ADD(
      MUL(OUT('credit_risk_score'), L(0.55)),
      MUL(ADD(L(100), MUL(OUT('fraud_score'), L(-1))), L(10), L(0.15)),
      MUL(OUT('identity_verification_score'), L(10), L(0.1)),
      MUL(OUT('affordability_score'), L(10), L(0.15)),
      MUL(OUT('eligibility_score'), L(10), L(0.05)),
    ),
    0,
    1000,
  ),
);
const pricingTierExpr = IF(
  GTE(OUT('credit_risk_score'), L(800)),
  L('A'),
  IF(GTE(OUT('credit_risk_score'), L(700)), L('B'), IF(GTE(OUT('credit_risk_score'), L(600)), L('C'), IF(GTE(OUT('credit_risk_score'), L(450)), L('D'), L('E')))),
);
const BASE_APR_PERCENT = 24;
const tierPremiumExpr = IF(
  EQ(OUT('pricing_tier'), L('A')),
  L(0),
  IF(EQ(OUT('pricing_tier'), L('B')), L(6), IF(EQ(OUT('pricing_tier'), L('C')), L(14), IF(EQ(OUT('pricing_tier'), L('D')), L(24), L(40)))),
);
// usury_cap_rate is stored as a ratio (e.g. 0.6 = 60%), converted to percent to compare against
// annual_percentage_rate (unit PERCENT).
const annualPercentageRateExpr = MIN(ADD(L(BASE_APR_PERCENT), tierPremiumExpr), MUL(V('usury_cap_rate'), L(100)));
const MAX_POLICY_CREDIT_LIMIT_BOB = 5000;
const AFFORDABLE_LIMIT_HORIZON_MONTHS = 12;
const approvedCreditLimitExpr = ROUND(
  MIN(L(MAX_POLICY_CREDIT_LIMIT_BOB), MUL(OUT('max_affordable_installment'), L(AFFORDABLE_LIMIT_HORIZON_MONTHS))),
  2,
);
const approvedAmountExpr = ROUND(MIN(V('requested_amount'), OUT('approved_credit_limit')), 2);
const MAX_POLICY_TERM_MONTHS = 24;
const approvedTermMonthsExpr = MIN(V('requested_term_months'), L(MAX_POLICY_TERM_MONTHS));
const decisionConfidenceExpr = CLAMP(
  ADD(
    L(100),
    MUL(
      ADD(
        IF(EQ(OUT('kyc_decision'), L('REVIEW')), L(1), L(0)),
        IF(EQ(OUT('fraud_decision'), L('REVIEW')), L(1), L(0)),
        IF(EQ(OUT('credit_risk_decision'), L('REVIEW')), L(1), L(0)),
        IF(EQ(OUT('aml_decision'), L('REVIEW')), L(1), L(0)),
      ),
      L(-25),
    ),
  ),
  0,
  100,
);
const reviewNeededExpr = OR(
  EQ(OUT('kyc_decision'), L('REVIEW')),
  EQ(OUT('fraud_decision'), L('REVIEW')),
  EQ(OUT('credit_risk_decision'), L('REVIEW')),
  EQ(OUT('aml_decision'), L('REVIEW')),
  EQ(OUT('compliance_decision'), L('REVIEW')),
);
const decisionOutcomeApprovedExpr = IF(
  OR(V('pep_status'), NOT(V('source_of_funds_verified'))),
  L('APPROVED_WITH_CONDITIONS'),
  L('APPROVED'),
);

// ─────────────────────────────────────────────────────────────────────────────
// Graph assembly. Each domain "stage" computes its outputs via SET_FIELD actions (an ACTION
// node's bound actions run unconditionally in order and may reference outputs set earlier in
// the SAME execution, since ExecutionEngineService rebuilds the expression context from the
// live `state.output` before every action) and then branches: on the first matching decline
// cause it routes to a dedicated reason node and on to the shared DECLINED_RESULT terminal;
// otherwise it falls through to the next stage's compute node. A RESULT node always terminates
// execution in this engine (ExecutionEngineService.execute), so it is used only for the three
// true endpoints (declined / manual review / approved) — everything upstream of that uses
// ACTION nodes with SET_FIELD, which is the mechanism that leaves an outputs contract-validated
// but keeps the graph flowing.
// ─────────────────────────────────────────────────────────────────────────────
interface DeclineCause {
  code: string;
  condition: unknown;
  reason: string;
}
interface Stage {
  key: string;
  label: string;
  fields: Array<{ field: string; expression: unknown }>;
  declineCauses: DeclineCause[];
}

const STAGES: Stage[] = [
  {
    key: 'IDENTITY',
    label: 'Identidad y KYC',
    fields: [
      { field: 'identity_verification_score', expression: identityVerificationScoreExpr },
      { field: 'kyc_decision', expression: kycDecisionExpr },
    ],
    declineCauses: [
      { code: 'KYC_INVALID', condition: OR(EQ(V('kyc_status'), L('REJECTED')), NOT(V('consent_active'))), reason: 'KYC_OR_CONSENT_INVALID' },
      { code: 'KYC_LIVENESS', condition: NOT(V('liveness_check_passed')), reason: 'LIVENESS_CHECK_FAILED' },
      { code: 'KYC_ID', condition: NOT(V('national_id_verified')), reason: 'DOCUMENT_ILLEGIBLE' },
    ],
  },
  {
    key: 'FRAUD',
    label: 'Señales de fraude',
    fields: [
      { field: 'fraud_score', expression: fraudScoreExpr },
      { field: 'fraud_risk_band', expression: fraudRiskBandExpr },
      { field: 'fraud_decision', expression: fraudDecisionExpr },
    ],
    declineCauses: [
      { code: 'FRAUD_DEVICE', condition: V('known_fraud_device_flag'), reason: 'KNOWN_FRAUD_DEVICE' },
      { code: 'FRAUD_EMAIL', condition: V('known_fraud_email_flag'), reason: 'KNOWN_FRAUD_EMAIL' },
      { code: 'FRAUD_PHONE', condition: V('known_fraud_phone_flag'), reason: 'KNOWN_FRAUD_PHONE' },
      { code: 'FRAUD_PRIOR_CASE', condition: V('previous_fraud_case_flag'), reason: 'PREVIOUS_FRAUD_CASE' },
      { code: 'FRAUD_DEVICE_BLOCKLISTED', condition: EQ(V('device_reputation'), L('BLOCKLISTED')), reason: 'DEVICE_BLOCKLISTED' },
    ],
  },
  {
    key: 'ELIGIBILITY',
    label: 'Elegibilidad',
    fields: [
      { field: 'eligibility_score', expression: eligibilityScoreExpr },
      { field: 'eligibility_decision', expression: eligibilityDecisionExpr },
    ],
    declineCauses: [
      { code: 'ELIG_AGE', condition: eligibilityAgeFail, reason: 'AGE_NOT_ELIGIBLE' },
      { code: 'ELIG_EMPLOYMENT', condition: eligibilityEmploymentFail, reason: 'EMPLOYMENT_STATUS_NOT_ELIGIBLE' },
      { code: 'ELIG_AMOUNT', condition: eligibilityAmountFail, reason: 'PRODUCT_AMOUNT_OUT_OF_RANGE' },
      { code: 'ELIG_TERM', condition: eligibilityTermFail, reason: 'TERM_OUT_OF_RANGE' },
    ],
  },
  {
    key: 'CREDIT_RISK',
    label: 'Riesgo de crédito',
    fields: [
      { field: 'credit_risk_score', expression: creditRiskScoreExpr },
      { field: 'risk_band', expression: riskBandExpr },
      { field: 'probability_of_default', expression: probabilityOfDefaultExpr },
      { field: 'expected_loss_amount', expression: expectedLossAmountExpr },
      { field: 'credit_risk_decision', expression: creditRiskDecisionExpr },
    ],
    declineCauses: [
      { code: 'CR_BANKRUPTCY', condition: creditRiskBankruptcyFail, reason: 'RECENT_BANKRUPTCY' },
      { code: 'CR_CHARGE_OFF', condition: creditRiskChargeOffFail, reason: 'RECENT_CHARGE_OFF' },
      { code: 'CR_SCORE', condition: LT(OUT('credit_risk_score'), L(450)), reason: 'BUREAU_SCORE_TOO_LOW' },
    ],
  },
  {
    key: 'AFFORDABILITY',
    label: 'Capacidad de pago',
    fields: [
      { field: 'affordability_score', expression: affordabilityScoreExpr },
      { field: 'max_affordable_installment', expression: maxAffordableInstallmentExpr },
      { field: 'affordability_decision', expression: affordabilityDecisionExpr },
    ],
    declineCauses: [
      { code: 'AFF_RATIO', condition: affordabilityRatioFail, reason: 'AFFORDABILITY_RATIO_EXCEEDED' },
      { code: 'AFF_NSF', condition: affordabilityNsfFail, reason: 'NSF_HISTORY_EXCESSIVE' },
      { code: 'AFF_DISPOSABLE', condition: affordabilityDisposableFail, reason: 'INSUFFICIENT_DISPOSABLE_INCOME' },
    ],
  },
  {
    key: 'AML',
    label: 'AML y sanciones',
    fields: [
      { field: 'aml_risk_score', expression: amlRiskScoreExpr },
      { field: 'aml_decision', expression: amlDecisionExpr },
      { field: 'compliance_decision', expression: complianceDecisionExpr },
    ],
    declineCauses: [
      { code: 'AML_SANCTIONS', condition: amlSanctionsConfirmed, reason: 'SANCTIONS_CONFIRMED_MATCH' },
    ],
  },
];

const FINAL_FIELDS: Array<{ field: string; expression: unknown }> = [
  { field: 'scoring', expression: scoringExpr },
  { field: 'pricing_tier', expression: pricingTierExpr },
  { field: 'annual_percentage_rate', expression: annualPercentageRateExpr },
  { field: 'approved_credit_limit', expression: approvedCreditLimitExpr },
  { field: 'approved_amount', expression: approvedAmountExpr },
  { field: 'approved_term_months', expression: approvedTermMonthsExpr },
  { field: 'decision_confidence', expression: decisionConfidenceExpr },
];

function computeNodeKey(stageKey: string): string {
  return `COMPUTE_${stageKey}`;
}
function declineNodeKey(stageKey: string, causeCode: string): string {
  return `DECLINE_${stageKey}_${causeCode}`;
}

/** Builds and persists the seed rule graph for the BNPL_CREDIT_DECISION demo artifact. */
export async function buildDemoGraph(
  prisma: PrismaClient,
  versionId: bigint,
  reasonByCode: Record<string, { id: bigint }>,
): Promise<DemoGraphResult> {
  const conditionDefinitions: ConditionDefinition[] = [];
  const actionDefinitions: ActionDefinition[] = [];
  const nodeDefinitions: NodeDefinition[] = [];
  const nodeActionBindings: Record<string, string[]> = {};
  const edgeDefinitions: EdgeDefinition[] = [];
  let order = 0;

  const addNode = (key: string, type: string, label: string, terminal: boolean, config: Record<string, unknown> = {}) => {
    order += 1;
    nodeDefinitions.push({ key, type, label, order, terminal, config });
  };
  const addAction = (code: string, type: string, payload: Record<string, unknown>, reason?: string) => {
    actionDefinitions.push({ code, type, payload, terminal: false, reason });
    return code;
  };
  const bindActions = (nodeKey: string, actionCodes: string[]) => {
    nodeActionBindings[nodeKey] = [...(nodeActionBindings[nodeKey] ?? []), ...actionCodes];
  };
  const addEdge = (definition: EdgeDefinition) => edgeDefinitions.push(definition);

  addNode('START', 'START', 'Inicio', false);
  addEdge({ key: 'E_START_FIRST_STAGE', from: 'START', to: computeNodeKey(STAGES[0].key), priority: 1, default: true });

  const declinedResultKey = 'DECLINED_RESULT';

  for (const stage of STAGES) {
    const stageComputeKey = computeNodeKey(stage.key);
    addNode(stageComputeKey, 'ACTION', `Calcular ${stage.label}`, false);
    const setFieldActionCodes = stage.fields.map(({ field, expression }) =>
      addAction(`SET_${field.toUpperCase()}`, 'SET_FIELD', { field, valueExpression: expression }),
    );
    bindActions(stageComputeKey, setFieldActionCodes);

    stage.declineCauses.forEach((cause, index) => {
      const conditionCode = `COND_${cause.code}`;
      conditionDefinitions.push({ code: conditionCode, name: `${stage.label}: ${cause.code}`, expression: cause.condition });

      const declineKey = declineNodeKey(stage.key, cause.code);
      addNode(declineKey, 'ACTION', `Rechazo: ${cause.reason}`, false);
      const reasonActionCode = addAction(`EMIT_${cause.code}`, 'EMIT_REASON', {}, cause.reason);
      const literalActionCode = addAction(`SET_ADVERSE_REASON_${cause.code}`, 'SET_FIELD', {
        field: 'adverse_action_reason_codes',
        value: cause.reason,
      });
      const confidenceActionCode = addAction(`SET_CONFIDENCE_${cause.code}`, 'SET_FIELD', {
        field: 'decision_confidence',
        value: 100,
      });
      bindActions(declineKey, [reasonActionCode, literalActionCode, confidenceActionCode]);

      addEdge({
        key: `E_${stageComputeKey}_${declineKey}`,
        from: stageComputeKey,
        to: declineKey,
        priority: index + 1,
        default: false,
        condition: conditionCode,
      });
      addEdge({ key: `E_${declineKey}_RESULT`, from: declineKey, to: declinedResultKey, priority: 1, default: true });
    });

    addEdge({
      key: `E_${stageComputeKey}_CONTINUE`,
      from: stageComputeKey,
      to: '', // filled in once the next stage's key is known, see below
      priority: 999,
      default: true,
    });
  }

  // Wire each stage's fall-through ("no decline cause matched") edge to the next stage — the
  // last one goes to COMPUTE_FINAL. Done as a second pass since each stage only knows its own
  // key while STAGES is being walked above.
  const stageComputeKeys = STAGES.map((stage) => computeNodeKey(stage.key));
  const nextComputeKey = (fromKey: string): string => {
    const index = stageComputeKeys.indexOf(fromKey);
    return index === stageComputeKeys.length - 1 ? 'COMPUTE_FINAL' : stageComputeKeys[index + 1];
  };
  for (const edge of edgeDefinitions) {
    if (edge.key.endsWith('_CONTINUE')) edge.to = nextComputeKey(edge.from);
  }

  addNode(declinedResultKey, 'RESULT', 'Resultado: rechazada', true, {
    mode: 'MAPPING',
    assignments: [{ outputCode: 'decision_outcome', source: 'LITERAL', value: 'DECLINED' }],
  });

  addNode('COMPUTE_FINAL', 'ACTION', 'Componer decisión final', false);
  const finalActionCodes = FINAL_FIELDS.map(({ field, expression }) =>
    addAction(`SET_${field.toUpperCase()}`, 'SET_FIELD', { field, valueExpression: expression }),
  );
  bindActions('COMPUTE_FINAL', finalActionCodes);

  conditionDefinitions.push({ code: 'COND_REVIEW_NEEDED', name: 'Alguna etapa requiere revisión manual', expression: reviewNeededExpr });
  addEdge({ key: 'E_FINAL_REVIEW', from: 'COMPUTE_FINAL', to: 'REVIEW_REASONS', priority: 1, default: false, condition: 'COND_REVIEW_NEEDED' });
  addEdge({ key: 'E_FINAL_APPROVE', from: 'COMPUTE_FINAL', to: 'APPROVE_REASONS', priority: 999, default: true });

  addNode('REVIEW_REASONS', 'ACTION', 'Derivar a revisión manual', false);
  const manualReviewActionCode = addAction(
    'CREATE_MANUAL_REVIEW',
    'CREATE_MANUAL_REVIEW',
    {
      queueCode: 'CREDIT_REVIEW',
      priority: 50,
      slaMinutes: 240,
      evidence: {
        kycDecision: '{{decision.output.kyc_decision}}',
        fraudDecision: '{{decision.output.fraud_decision}}',
        creditRiskDecision: '{{decision.output.credit_risk_decision}}',
        amlDecision: '{{decision.output.aml_decision}}',
        bureauScore: '{{bureau_score}}',
        requestedAmount: '{{requested_amount}}',
      },
    },
  );
  const reviewReasonActionCode = addAction('EMIT_SCORE_BAND_BORDERLINE', 'EMIT_REASON', {}, 'SCORE_BAND_BORDERLINE');
  const reviewAdverseFieldCode = addAction('SET_ADVERSE_REASON_REVIEW', 'SET_FIELD', {
    field: 'adverse_action_reason_codes',
    value: '',
  });
  bindActions('REVIEW_REASONS', [manualReviewActionCode, reviewReasonActionCode, reviewAdverseFieldCode]);
  addEdge({ key: 'E_REVIEW_RESULT', from: 'REVIEW_REASONS', to: 'REVIEW_RESULT', priority: 1, default: true });
  addNode('REVIEW_RESULT', 'RESULT', 'Resultado: revisión manual', true, {
    mode: 'MAPPING',
    assignments: [{ outputCode: 'decision_outcome', source: 'LITERAL', value: 'MANUAL_REVIEW' }],
  });

  addNode('APPROVE_REASONS', 'ACTION', 'Registrar aprobación', false);
  const approvedReasonActionCode = addAction('EMIT_APPROVED_POLICY', 'EMIT_REASON', {}, 'APPROVED_POLICY');
  const approveAdverseFieldCode = addAction('SET_ADVERSE_REASON_APPROVE', 'SET_FIELD', {
    field: 'adverse_action_reason_codes',
    value: '',
  });
  bindActions('APPROVE_REASONS', [approvedReasonActionCode, approveAdverseFieldCode]);
  addEdge({ key: 'E_APPROVE_RESULT', from: 'APPROVE_REASONS', to: 'APPROVE_RESULT', priority: 1, default: true });
  addNode('APPROVE_RESULT', 'RESULT', 'Resultado: aprobada', true, {
    mode: 'MAPPING',
    assignments: [
      { outputCode: 'decision_outcome', source: 'EXPRESSION', expression: decisionOutcomeApprovedExpr },
    ],
  });

  const conditionByCode: Record<string, { id: bigint }> = {};
  for (const condition of conditionDefinitions) {
    conditionByCode[condition.code] = await prisma.decisionRuleCondition.create({
      data: {
        artifactVersionId: versionId,
        conditionCode: condition.code,
        name: condition.name,
        expressionType: 'JSON_AST',
        expressionJson: condition.expression as Prisma.InputJsonValue,
        severity: 'BLOCKING',
        isReusable: false,
      },
    });
  }

  const actionByCode: Record<string, { id: bigint }> = {};
  for (const action of actionDefinitions) {
    const created = await prisma.decisionRuleAction.create({
      data: {
        artifactVersionId: versionId,
        actionCode: action.code,
        actionType: action.type,
        payloadTemplateJson: action.payload as Prisma.InputJsonValue,
        isTerminal: action.terminal,
      },
    });
    actionByCode[action.code] = created;
    if (action.reason) {
      await prisma.decisionActionReasonMapping.create({
        data: { actionId: created.id, reasonCodeId: reasonByCode[action.reason].id, priority: 10 },
      });
    }
  }

  const nodeByKey: Record<string, { id: bigint }> = {};
  for (const node of nodeDefinitions) {
    nodeByKey[node.key] = await prisma.decisionRuleNode.create({
      data: {
        artifactVersionId: versionId,
        nodeKey: node.key,
        nodeType: node.type,
        label: node.label,
        configJson: node.config as Prisma.InputJsonValue,
        xPos: node.order * 160,
        yPos: 100,
        orderIndex: node.order,
        isTerminal: node.terminal,
      },
    });
  }

  for (const [nodeKey, actionCodes] of Object.entries(nodeActionBindings)) {
    for (let index = 0; index < actionCodes.length; index += 1) {
      await prisma.decisionNodeAction.create({
        data: {
          nodeId: nodeByKey[nodeKey].id,
          actionId: actionByCode[actionCodes[index]].id,
          executionOrder: index + 1,
        },
      });
    }
  }

  const edgeRows: Array<{ row: { id: bigint }; definition: EdgeDefinition }> = [];
  for (const edge of edgeDefinitions) {
    const row = await prisma.decisionRuleEdge.create({
      data: {
        artifactVersionId: versionId,
        fromNodeId: nodeByKey[edge.from].id,
        toNodeId: nodeByKey[edge.to].id,
        edgeKey: edge.key,
        edgeType: edge.default ? 'DEFAULT' : 'CONDITIONAL',
        priority: edge.priority,
        isDefault: edge.default,
      },
    });
    edgeRows.push({ row, definition: edge });
    if (edge.condition) {
      await prisma.decisionEdgeCondition.create({
        data: {
          edgeId: row.id,
          conditionId: conditionByCode[edge.condition].id,
          evaluationOrder: 1,
        },
      });
    }
  }

  return {
    conditionDefinitions,
    actionDefinitions,
    nodeDefinitions,
    nodeActionBindings,
    edgeDefinitions,
    conditionByCode,
    actionByCode,
    nodeByKey,
    edgeRows,
  };
}
