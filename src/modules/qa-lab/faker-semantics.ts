/**
 * Qué dato realista corresponde a cada variable del contrato, leído de su NOMBRE.
 *
 * El generador del contrato sabe respetar reglas —rango, longitud, patrón, enumeración— pero
 * no sabe qué ES una variable: para él `nombre_cliente` y `codigo_interno` son dos textos, y
 * los rellenaba con letras al azar («frocuzfzj»). Un caso así pasa las propiedades técnicas,
 * pero nadie que lo mire reconoce a una persona, y cualquier regla que dependa de la forma
 * del dato (un carnet de 7 dígitos, un celular que empieza por 6 o 7) no se ejercita nunca.
 *
 * Aquí se decide, por el nombre de la variable, qué campo de un faker del servidor mock le
 * corresponde (`caso` para persona, contacto, dirección, dispositivo, finanzas y cuenta;
 * `comercio` para los datos de un comercio). Lo que no se reconoce NO se toca: sigue saliendo
 * del generador del contrato. Y lo que se reconoce sólo se usa si el contrato lo acepta
 * (`fitToContract`): el faker aporta realismo, el contrato sigue mandando.
 */
import { normalizeDataTypeOrString } from '../../common/contracts/data-types';
import {
  resolvedConstraintsOf,
  satisfiesContract,
  type GeneratorContractVariable,
} from './contract-value-factory';

export type FakerType = 'caso' | 'comercio';

/** Un elemento de cada faker pedido, para el mismo índice de caso. */
export interface FakerRecord {
  caso?: Record<string, unknown>;
  comercio?: Record<string, unknown>;
}

export interface SemanticRule {
  /** Nombre estable del dato, para el informe («persona.documentNumber»). */
  field: string;
  type: FakerType;
  /** Valores candidatos, en orden de preferencia; el primero que el contrato acepte gana. */
  pick: (record: Record<string, unknown>) => unknown[];
}

type Tokens = ReadonlySet<string>;

interface RuleDefinition extends SemanticRule {
  matches: (tokens: Tokens) => boolean;
}

const any =
  (...words: string[]) =>
  (tokens: Tokens) =>
    words.some((word) => tokens.has(word));
const all =
  (...tests: Array<(tokens: Tokens) => boolean>) =>
  (tokens: Tokens) =>
    tests.every((test) => test(tokens));
const either =
  (...tests: Array<(tokens: Tokens) => boolean>) =>
  (tokens: Tokens) =>
    tests.some((test) => test(tokens));

const NAME = any('nombre', 'name', 'nombres');

function section(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const persona = (key: string) => (record: Record<string, unknown>) => [
  section(record, 'persona')[key],
];
const direccion = (key: string) => (record: Record<string, unknown>) => [
  section(record, 'direccion')[key],
];
const finanzas = (key: string) => (record: Record<string, unknown>) => [
  section(record, 'perfilFinanciero')[key],
];
const cuenta = (key: string) => (record: Record<string, unknown>) => [
  section(record, 'cuentaBancaria')[key],
];
const dispositivo = (key: string) => (record: Record<string, unknown>) => [
  section(record, 'dispositivo')[key],
];
const snapshot = (key: string) => (record: Record<string, unknown>) => [
  section(section(record, 'dispositivo'), 'snapshot')[key],
];
const comercio = (key: string) => (record: Record<string, unknown>) => [record[key]];

/** El teléfono admite dos formas: internacional (+591…) y los 8 dígitos nacionales. */
function phoneCandidates(value: unknown): unknown[] {
  const text = String(value ?? '');
  const national = text.replace(/^\+591/, '');
  return [text, national];
}

/** El género se escribe de muchas maneras según quién diseñó el contrato. */
function genderCandidates(value: unknown): unknown[] {
  if (value === 'F') return ['F', 'FEMENINO', 'Femenino', 'MUJER', 'FEMALE', 'female', 'f'];
  if (value === 'M') return ['M', 'MASCULINO', 'Masculino', 'HOMBRE', 'MALE', 'male', 'm'];
  return [value];
}

/**
 * Reglas en ORDEN: la primera que casa gana. Las compuestas van delante de las sueltas
 * porque «tipo_documento» contiene «documento» y «nombre_banco» contiene «nombre».
 */
const RULES: readonly RuleDefinition[] = [
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

  // Nombres.
  {
    field: 'persona.fullName',
    type: 'caso',
    matches: all(NAME, any('completo', 'full')),
    pick: persona('fullName'),
  },
  {
    field: 'persona.secondName',
    type: 'caso',
    matches: either(all(any('segundo', 'second'), NAME), any('middle')),
    pick: persona('secondName'),
  },
  {
    field: 'persona.secondLastName',
    type: 'caso',
    matches: either(all(any('segundo', 'second'), any('apellido', 'last')), any('materno')),
    pick: persona('secondLastName'),
  },
  {
    field: 'persona.lastNames',
    type: 'caso',
    matches: any('apellidos'),
    pick: (record) => {
      const person = section(record, 'persona');
      return [`${String(person.lastName ?? '')} ${String(person.secondLastName ?? '')}`.trim()];
    },
  },
  {
    field: 'persona.lastName',
    type: 'caso',
    matches: either(any('apellido', 'surname', 'paterno', 'lastname'), all(any('last'), NAME)),
    pick: persona('lastName'),
  },
  {
    field: 'persona.firstName',
    type: 'caso',
    matches: either(all(any('primer', 'first'), NAME), any('firstname', 'nombres')),
    pick: (record) => {
      const person = section(record, 'persona');
      return [person.firstName];
    },
  },
  { field: 'persona.fullName', type: 'caso', matches: NAME, pick: persona('fullName') },

  // Documento de identidad.
  {
    field: 'persona.documentType',
    type: 'caso',
    matches: all(any('tipo', 'type'), any('documento', 'document', 'doc')),
    pick: persona('documentType'),
  },
  {
    field: 'persona.documentComplement',
    type: 'caso',
    matches: any('complemento', 'complement'),
    pick: persona('documentComplement'),
  },
  {
    field: 'persona.documentExtension',
    type: 'caso',
    matches: any('extension', 'expedido', 'expedicion', 'ext'),
    pick: persona('documentExtension'),
  },
  {
    field: 'persona.documentNumber',
    type: 'caso',
    matches: any('ci', 'carnet', 'cedula', 'documento', 'document', 'dni', 'identificacion'),
    pick: persona('documentNumber'),
  },

  // Contacto.
  {
    field: 'persona.phoneOperator',
    type: 'caso',
    matches: any('operador', 'operator'),
    pick: persona('phoneOperator'),
  },
  {
    field: 'persona.phone',
    type: 'caso',
    matches: any('telefono', 'celular', 'phone', 'movil', 'mobile', 'whatsapp', 'tel', 'cel'),
    pick: (record) => phoneCandidates(section(record, 'persona').phone),
  },
  {
    field: 'persona.email',
    type: 'caso',
    matches: any('email', 'correo', 'mail'),
    pick: persona('email'),
  },
  {
    field: 'persona.gender',
    type: 'caso',
    matches: any('genero', 'sexo', 'gender', 'sex'),
    pick: (record) => genderCandidates(section(record, 'persona').gender),
  },

  // Dirección.
  {
    field: 'direccion.departmentCode',
    type: 'caso',
    matches: all(any('departamento', 'department'), any('codigo', 'code', 'cod')),
    pick: direccion('departmentCode'),
  },
  {
    field: 'direccion.department',
    type: 'caso',
    matches: any('departamento', 'department', 'region'),
    pick: (record) => [...direccion('department')(record), ...direccion('departmentCode')(record)],
  },
  {
    field: 'direccion.city',
    type: 'caso',
    matches: any('ciudad', 'city', 'municipio', 'localidad'),
    pick: direccion('city'),
  },
  {
    field: 'direccion.zone',
    type: 'caso',
    matches: any('zona', 'barrio'),
    pick: direccion('zone'),
  },
  {
    field: 'direccion.country',
    type: 'caso',
    matches: any('pais', 'country'),
    pick: (record) => [...direccion('country')(record), 'Bolivia'],
  },
  {
    field: 'direccion.latitude',
    type: 'caso',
    matches: any('lat', 'latitud', 'latitude'),
    pick: direccion('latitude'),
  },
  {
    field: 'direccion.longitude',
    type: 'caso',
    matches: any('lon', 'lng', 'longitud', 'longitude'),
    pick: direccion('longitude'),
  },
  {
    field: 'persona.address',
    type: 'caso',
    matches: any('direccion', 'address', 'domicilio', 'calle'),
    pick: persona('address'),
  },

  // Finanzas.
  {
    field: 'perfilFinanciero.monthlyExpenses',
    type: 'caso',
    matches: any('gasto', 'gastos', 'egreso', 'egresos', 'expense', 'expenses'),
    pick: finanzas('monthlyExpenses'),
  },
  {
    field: 'perfilFinanciero.monthlyIncome',
    type: 'caso',
    matches: any('ingreso', 'ingresos', 'income', 'salario', 'sueldo', 'salary'),
    pick: finanzas('monthlyIncome'),
  },
  {
    field: 'perfilFinanciero.currency',
    type: 'caso',
    matches: any('moneda', 'currency', 'divisa'),
    pick: finanzas('currency'),
  },

  // Dispositivo.
  {
    field: 'dispositivo.deviceFingerprintHash',
    type: 'caso',
    matches: any('fingerprint', 'huella'),
    pick: dispositivo('deviceFingerprintHash'),
  },
  {
    field: 'dispositivo.userAgent',
    type: 'caso',
    matches: either(any('useragent'), all(any('user'), any('agent'))),
    pick: dispositivo('userAgent'),
  },
  {
    field: 'dispositivo.channel',
    type: 'caso',
    matches: any('canal', 'channel'),
    pick: dispositivo('channel'),
  },
  {
    field: 'dispositivo.isRooted',
    type: 'caso',
    matches: any('rooted', 'root', 'jailbreak'),
    pick: snapshot('isRooted'),
  },
  {
    field: 'dispositivo.isEmulator',
    type: 'caso',
    matches: any('emulador', 'emulator'),
    pick: snapshot('isEmulator'),
  },
  { field: 'dispositivo.vpn', type: 'caso', matches: any('vpn'), pick: snapshot('vpnDetected') },
  {
    field: 'dispositivo.osFamily',
    type: 'caso',
    matches: any('plataforma', 'platform'),
    pick: snapshot('osFamily'),
  },
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

const NUMERIC = new Set(['INTEGER', 'DECIMAL', 'CURRENCY', 'PERCENTAGE']);
const TEXTUAL = new Set(['STRING', 'LONG_TEXT', 'CODE', 'IDENTIFIER', 'ENUM']);

/** Formas equivalentes de un texto: tal cual, en mayúsculas y como código (`LA_PAZ`). */
function textVariants(text: string): string[] {
  const plain = text.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const code = plain
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return [...new Set([text, text.toUpperCase(), code, text.toLowerCase(), plain])];
}

/** Traduce un candidato al tipo del contrato, en todas las formas razonables. */
function asContractType(type: string, value: unknown): unknown[] {
  if (value === undefined || value === null || value === '') return [];
  if (NUMERIC.has(type)) {
    if (typeof value === 'number') return [value];
    const digits = String(value).replace(/^\+591/, '');
    return /^-?\d+(\.\d+)?$/.test(digits) ? [Number(digits)] : [];
  }
  if (type === 'BOOLEAN') return typeof value === 'boolean' ? [value] : [];
  if (type === 'DATE') return typeof value === 'string' ? [value.slice(0, 10)] : [];
  if (type === 'DATETIME') {
    return typeof value === 'string' ? [value.length === 10 ? `${value}T00:00:00Z` : value] : [];
  }
  if (TEXTUAL.has(type)) {
    if (typeof value === 'number') return [String(value)];
    return typeof value === 'string' ? textVariants(value) : [];
  }
  return [];
}

/** Lleva un número al rango del contrato, respetando entero o escala. */
function clampToContract(variable: GeneratorContractVariable, value: number): number | undefined {
  const type = normalizeDataTypeOrString(variable.dataType);
  const constraints = resolvedConstraintsOf(variable);
  const scale = type === 'INTEGER' ? 0 : (constraints.scale ?? 2);
  const step = 10 ** -scale;
  let min = constraints.min ?? -Infinity;
  let max = constraints.max ?? Infinity;
  if (constraints.exclusiveMin !== undefined) min = Math.max(min, constraints.exclusiveMin + step);
  if (constraints.exclusiveMax !== undefined) max = Math.min(max, constraints.exclusiveMax - step);
  if (min > max) return undefined;
  const clamped = Math.min(max, Math.max(min, value));
  const factor = 10 ** scale;
  const rounded =
    clamped === min
      ? Math.ceil(clamped * factor) / factor
      : clamped === max
        ? Math.floor(clamped * factor) / factor
        : Math.round(clamped * factor) / factor;
  return Number(rounded.toFixed(scale));
}

/**
 * El primer candidato que el contrato acepta, o `undefined` si ninguno.
 *
 * Un numérico fuera de rango se lleva al rango antes de rendirse: un ingreso realista de
 * 12 053 Bs sobre un contrato de 1 000 a 10 000 sigue siendo más útil como 10 000 que como
 * un número al azar. Todo lo demás, si el contrato no lo admite, se descarta y el campo se
 * queda con el valor del generador: el faker aporta realismo, nunca relaja una regla.
 */
export function fitToContract(
  variable: GeneratorContractVariable,
  candidates: readonly unknown[],
): unknown {
  const type = normalizeDataTypeOrString(variable.dataType);
  const typed = candidates.flatMap((candidate) => asContractType(type, candidate));
  for (const value of typed) {
    if (satisfiesContract(variable, value)) return value;
  }
  if (NUMERIC.has(type)) {
    const first = typed.find((value): value is number => typeof value === 'number');
    if (first !== undefined) {
      const clamped = clampToContract(variable, first);
      if (clamped !== undefined && satisfiesContract(variable, clamped)) return clamped;
    }
  }
  return undefined;
}
