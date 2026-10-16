import { RULES_IDENTITY_AND_CONTACT } from './rules-identity-and-contact';
import { RULES_LOCATION_FINANCE_DEVICE } from './rules-location-finance-device';
import { RULES_PEOPLE_AND_ACCOUNTS } from './rules-people-and-accounts';
import { RuleDefinition, SemanticRule } from './types';

const RULES: readonly RuleDefinition[] = [
  ...RULES_PEOPLE_AND_ACCOUNTS,
  ...RULES_IDENTITY_AND_CONTACT,
  ...RULES_LOCATION_FINANCE_DEVICE,
];

/** `ingresoMensualUSD` → {ingreso, mensual, usd}; sin tildes ni mayúsculas. */
export function tokensOf(code: string): Set<string> {
  const plain = code
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
  return new Set(plain.split(/[^a-z0-9]+/).filter(Boolean));
}

/** La regla que corresponde a la variable, o `null` si su nombre no dice qué dato es. */
export function semanticRuleFor(code: string): SemanticRule | null {
  const tokens = tokensOf(code);
  const rule = RULES.find((candidate) => candidate.matches(tokens));
  if (!rule) return null;
  // Un ingreso o gasto ANUAL es doce veces el mensual del faker.
  if (
    rule.field.startsWith('perfilFinanciero.monthly') &&
    ['anual', 'annual', 'yearly', 'anio'].some((word) => tokens.has(word))
  ) {
    return {
      ...rule,
      field: `${rule.field}×12`,
      pick: (record) =>
        rule.pick(record).map((value) => (typeof value === 'number' ? value * 12 : value)),
    };
  }
  return rule;
}
