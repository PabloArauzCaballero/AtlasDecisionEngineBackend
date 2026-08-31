/**
 * Solicitante base con el que las pruebas de extremo a extremo invocan el artefacto de demostración.
 *
 * Es una ENTRADA de la decisión, no dato sembrado: vivía en `modules/seeding/data/demo-workflow.ts`
 * junto al sembrador que publica el artefacto, y cuando ese conjunto se movió a la rama de semillas
 * este payload se quedó sin sitio. Su lugar natural es el test, que es quien lo usa: la rama publica
 * el ARTEFACTO, y la prueba aporta el caso que se le manda.
 *
 * Los valores describen a un solicitante limpio —KYC verificado, sin señales de fraude, buró alto—
 * para que cada prueba mueva sólo los campos que le interesan y el resto no interfiera.
 */
export const DEMO_BASE_APPLICANT: Record<string, unknown> = {
  // Identidad / KYC
  kyc_status: 'VERIFIED',
  consent_active: true,
  age: 34,
  national_id_verified: true,
  biometric_match_score: 96,
  liveness_check_passed: true,
  address_verified: true,
  phone_verified: true,
  email_verified: true,
  pep_status: false,
  identity_confidence_score: 92,
  // Fraude
  fraud_signal: false,
  device_reputation: 'TRUSTED',
  device_risk_score: 4,
  ip_address_risk_score: 5,
  ip_tor_detected: false,
  velocity_applications_24h: 1,
  synthetic_identity_score: 2,
  sim_swap_detected: false,
  geolocation_mismatch_flag: false,
  known_fraud_device_flag: false,
  known_fraud_email_flag: false,
  known_fraud_phone_flag: false,
  previous_fraud_case_flag: false,
  account_takeover_risk_score: 3,
  browser_automation_detected: false,
  // Elegibilidad
  employment_status: 'EMPLOYED',
  requested_amount: 2500,
  requested_term_months: 12,
  // Buró de crédito
  bureau_score: 820,
  delinquency_count_12m: 0,
  worst_delinquency_status: 'CURRENT',
  revolving_utilization_ratio: 0.2,
  inquiries_last_6m: 1,
  public_records_count: 0,
  bankruptcy_flag: false,
  charge_off_count: 0,
  payment_history_score: 95,
  debt_to_income_ratio: 0.15,
  credit_mix_score: 72,
  thin_file_flag: false,
  no_hit_flag: false,
  oldest_trade_age_months: 84,
  // Capacidad de pago
  disposable_income: 4200,
  affordability_ratio: 0.15,
  income_stability_score: 88,
  bank_statement_nsf_count: 0,
  self_employed_flag: false,
  tax_return_verified: false,
  // AML / sanciones
  pep_relationship_type: 'NONE',
  ofac_screening_result: 'CLEAR',
  sanctions_screening_result: 'CLEAR',
  high_risk_jurisdiction_flag: false,
  adverse_media_hit: false,
  source_of_funds_verified: true,
  // Regulatorio
  usury_cap_rate: 0.6,
};
