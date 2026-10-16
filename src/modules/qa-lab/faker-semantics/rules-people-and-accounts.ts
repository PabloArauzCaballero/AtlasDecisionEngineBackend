import { comercio, cuenta, finanzas, persona } from './candidates';
import { NAME, all, any, either } from './matchers';
import { RuleDefinition } from './types';

/**
 * Reglas en ORDEN: la primera que casa gana. Las compuestas van delante de las sueltas
 * porque «tipo_documento» contiene «documento» y «nombre_banco» contiene «nombre».
 */
export const RULES_PEOPLE_AND_ACCOUNTS: readonly RuleDefinition[] = [
  // Fechas y edad.
  {
    field: 'persona.birthDate',
    type: 'caso',
    matches: either(any('nacimiento', 'birth', 'birthdate', 'dob'), all(any('fecha'), any('nac'))),
    pick: persona('birthDate'),
  },
  { field: 'persona.age', type: 'caso', matches: any('edad', 'age'), pick: persona('age') },

  // Comercio.
  {
    field: 'comercio.legalName',
    type: 'comercio',
    matches: either(all(any('razon'), any('social')), all(any('legal'), NAME)),
    pick: comercio('legalName'),
  },
  {
    field: 'comercio.tradeName',
    type: 'comercio',
    matches: either(
      all(NAME, any('comercial', 'comercio', 'negocio', 'fantasia', 'trade')),
      any('tradename'),
    ),
    pick: comercio('tradeName'),
  },
  { field: 'comercio.nit', type: 'comercio', matches: any('nit'), pick: comercio('nit') },
  { field: 'comercio.mcc', type: 'comercio', matches: any('mcc'), pick: comercio('mcc') },
  {
    field: 'comercio.businessCategory',
    type: 'comercio',
    matches: either(any('rubro'), all(any('categoria', 'category'), any('comercio', 'business'))),
    pick: comercio('businessCategory'),
  },

  // Cuenta bancaria (antes que los nombres: «nombre_banco», «titular»).
  {
    field: 'cuentaBancaria.holderName',
    type: 'caso',
    matches: any('titular', 'holder'),
    pick: cuenta('holderName'),
  },
  {
    field: 'cuentaBancaria.bankCode',
    type: 'caso',
    matches: all(any('banco', 'bank'), any('codigo', 'code', 'cod')),
    pick: cuenta('bankCode'),
  },
  {
    field: 'cuentaBancaria.bankName',
    type: 'caso',
    matches: any('banco', 'bank'),
    pick: (record) => [...cuenta('bankName')(record), ...cuenta('bankCode')(record)],
  },
  {
    field: 'cuentaBancaria.accountType',
    type: 'caso',
    matches: all(any('tipo', 'type'), any('cuenta', 'account')),
    pick: cuenta('accountType'),
  },
  {
    field: 'cuentaBancaria.accountNumber',
    type: 'caso',
    matches: any('cuenta', 'account', 'iban'),
    pick: cuenta('accountNumber'),
  },

  // Empleo (antes que los nombres: «nombre_empleador»).
  {
    field: 'perfilFinanciero.employmentType',
    type: 'caso',
    matches: either(
      all(any('tipo', 'type'), any('empleo', 'trabajo', 'laboral', 'contrato', 'employment')),
      any('employment', 'ocupacion'),
    ),
    pick: finanzas('employmentType'),
  },
  {
    field: 'perfilFinanciero.yearsEmployed',
    type: 'caso',
    matches: either(
      any('antiguedad'),
      all(any('anios', 'years', 'anos'), any('empleo', 'trabajo', 'laboral', 'employed')),
    ),
    pick: finanzas('yearsEmployed'),
  },
  {
    field: 'perfilFinanciero.employerName',
    type: 'caso',
    matches: any('empleador', 'employer', 'empresa'),
    pick: finanzas('employerName'),
  },
];
