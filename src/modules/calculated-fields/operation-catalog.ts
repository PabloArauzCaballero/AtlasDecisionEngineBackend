/**
 * Catálogo de operaciones del constructor visual (§6.1).
 *
 * Es una lista blanca cerrada: el árbol de operaciones que llega del frontend solo
 * puede invocar lo que está aquí. Cualquier operación desconocida se rechaza, así que
 * el "constructor visual" no es una vía alternativa para ejecutar código arbitrario.
 */
import type { DataType } from '../../common/contracts/data-types';

export type OperationCategory =
  | 'MATH'
  | 'STATISTICS'
  | 'DATE'
  | 'TEXT'
  | 'CONVERSION'
  | 'COMPARISON'
  | 'LOGIC'
  | 'LIST'
  | 'AGGREGATION'
  | 'DATA';

export interface OperationArgument {
  name: string;
  /** Tipos admitidos; vacío = cualquiera. */
  types: DataType[];
  required: boolean;
  description: string;
}

export interface OperationDefinition {
  id: string;
  label: string;
  category: OperationCategory;
  description: string;
  args: OperationArgument[];
  /** Tipo del valor devuelto. */
  returns: DataType;
  /** Aridad variable (SUM, MIN, MAX sobre N argumentos). */
  variadic?: boolean;
  /** Documentación breve mostrada en el panel. */
  example: string;
}

const num = (name: string, description: string, required = true): OperationArgument => ({
  name,
  types: ['INTEGER', 'DECIMAL', 'PERCENTAGE', 'CURRENCY'],
  required,
  description,
});
const any = (name: string, description: string, required = true): OperationArgument => ({
  name,
  types: [],
  required,
  description,
});
const text = (name: string, description: string, required = true): OperationArgument => ({
  name,
  types: ['STRING', 'LONG_TEXT', 'CODE', 'IDENTIFIER', 'ENUM'],
  required,
  description,
});
const list = (name: string, description: string): OperationArgument => ({
  name,
  types: ['LIST'],
  required: true,
  description,
});

export const OPERATIONS: readonly OperationDefinition[] = [
  // Matemáticas
  {
    id: 'ADD',
    label: 'Sumar',
    category: 'MATH',
    description: 'Suma dos o más números',
    args: [num('a', 'Primer sumando'), num('b', 'Segundo sumando')],
    returns: 'DECIMAL',
    variadic: true,
    example: 'ADD(1200, 300) = 1500',
  },
  {
    id: 'SUBTRACT',
    label: 'Restar',
    category: 'MATH',
    description: 'Resta el segundo número del primero',
    args: [num('a', 'Minuendo'), num('b', 'Sustraendo')],
    returns: 'DECIMAL',
    example: 'SUBTRACT(1500, 300) = 1200',
  },
  {
    id: 'MULTIPLY',
    label: 'Multiplicar',
    category: 'MATH',
    description: 'Multiplica dos o más números',
    args: [num('a', 'Factor'), num('b', 'Factor')],
    returns: 'DECIMAL',
    variadic: true,
    example: 'MULTIPLY(1200, 0.35) = 420',
  },
  {
    id: 'DIVIDE',
    label: 'Dividir',
    category: 'MATH',
    description:
      'Divide el primero entre el segundo; división por cero según la política declarada',
    args: [num('a', 'Dividendo'), num('b', 'Divisor')],
    returns: 'DECIMAL',
    example: 'DIVIDE(450, 1200) = 0.375',
  },
  {
    id: 'ABS',
    label: 'Valor absoluto',
    category: 'MATH',
    description: 'Valor absoluto',
    args: [num('a', 'Número')],
    returns: 'DECIMAL',
    example: 'ABS(-3) = 3',
  },
  {
    id: 'ROUND',
    label: 'Redondear',
    category: 'MATH',
    description: 'Redondea a los decimales indicados',
    args: [num('a', 'Número'), num('decimals', 'Decimales', false)],
    returns: 'DECIMAL',
    example: 'ROUND(0.3756, 2) = 0.38',
  },
  {
    id: 'FLOOR',
    label: 'Truncar abajo',
    category: 'MATH',
    description: 'Redondea hacia abajo',
    args: [num('a', 'Número')],
    returns: 'INTEGER',
    example: 'FLOOR(3.9) = 3',
  },
  {
    id: 'CEIL',
    label: 'Truncar arriba',
    category: 'MATH',
    description: 'Redondea hacia arriba',
    args: [num('a', 'Número')],
    returns: 'INTEGER',
    example: 'CEIL(3.1) = 4',
  },
  {
    id: 'POWER',
    label: 'Potencia',
    category: 'MATH',
    description: 'Eleva a una potencia',
    args: [num('base', 'Base'), num('exponent', 'Exponente')],
    returns: 'DECIMAL',
    example: 'POWER(2, 10) = 1024',
  },
  {
    id: 'CLAMP',
    label: 'Acotar',
    category: 'MATH',
    description: 'Limita un número a un rango',
    args: [num('a', 'Número'), num('min', 'Mínimo'), num('max', 'Máximo')],
    returns: 'DECIMAL',
    example: 'CLAMP(120, 0, 100) = 100',
  },

  // Estadística
  {
    id: 'MIN',
    label: 'Mínimo',
    category: 'STATISTICS',
    description: 'El menor de los valores',
    args: [num('a', 'Valor'), num('b', 'Valor')],
    returns: 'DECIMAL',
    variadic: true,
    example: 'MIN(5000, 4200) = 4200',
  },
  {
    id: 'MAX',
    label: 'Máximo',
    category: 'STATISTICS',
    description: 'El mayor de los valores',
    args: [num('a', 'Valor'), num('b', 'Valor')],
    returns: 'DECIMAL',
    variadic: true,
    example: 'MAX(0, -3) = 0',
  },
  {
    id: 'AVERAGE',
    label: 'Promedio',
    category: 'STATISTICS',
    description: 'Media aritmética de una lista',
    args: [list('values', 'Lista de números')],
    returns: 'DECIMAL',
    example: 'AVERAGE([1,2,3]) = 2',
  },
  {
    id: 'MEDIAN',
    label: 'Mediana',
    category: 'STATISTICS',
    description: 'Mediana de una lista',
    args: [list('values', 'Lista de números')],
    returns: 'DECIMAL',
    example: 'MEDIAN([1,3,10]) = 3',
  },
  {
    id: 'STDDEV',
    label: 'Desviación estándar',
    category: 'STATISTICS',
    description: 'Desviación estándar poblacional',
    args: [list('values', 'Lista de números')],
    returns: 'DECIMAL',
    example: 'STDDEV([2,4,4,4,5,5,7,9]) = 2',
  },

  // Fechas
  {
    id: 'AGE_YEARS',
    label: 'Edad en años',
    category: 'DATE',
    description: 'Años completos entre dos fechas',
    args: [
      { name: 'from', types: ['DATE', 'DATETIME'], required: true, description: 'Fecha inicial' },
      {
        name: 'to',
        types: ['DATE', 'DATETIME'],
        required: true,
        description: 'Fecha de referencia',
      },
    ],
    returns: 'INTEGER',
    example: 'AGE_YEARS("1990-05-01", "2026-07-30") = 36',
  },
  {
    id: 'DAYS_BETWEEN',
    label: 'Días entre fechas',
    category: 'DATE',
    description: 'Días completos entre dos fechas',
    args: [
      { name: 'from', types: ['DATE', 'DATETIME'], required: true, description: 'Fecha inicial' },
      { name: 'to', types: ['DATE', 'DATETIME'], required: true, description: 'Fecha final' },
    ],
    returns: 'INTEGER',
    example: 'DAYS_BETWEEN("2026-01-01", "2026-01-31") = 30',
  },
  {
    id: 'MONTHS_BETWEEN',
    label: 'Meses entre fechas',
    category: 'DATE',
    description: 'Meses completos entre dos fechas',
    args: [
      { name: 'from', types: ['DATE', 'DATETIME'], required: true, description: 'Fecha inicial' },
      { name: 'to', types: ['DATE', 'DATETIME'], required: true, description: 'Fecha final' },
    ],
    returns: 'INTEGER',
    example: 'MONTHS_BETWEEN("2026-01-01", "2026-07-01") = 6',
  },

  // Texto
  {
    id: 'CONCAT',
    label: 'Concatenar',
    category: 'TEXT',
    description: 'Une textos',
    args: [text('a', 'Texto'), text('b', 'Texto')],
    returns: 'STRING',
    variadic: true,
    example: 'CONCAT("A", "B") = "AB"',
  },
  {
    id: 'UPPER',
    label: 'Mayúsculas',
    category: 'TEXT',
    description: 'Convierte a mayúsculas',
    args: [text('a', 'Texto')],
    returns: 'STRING',
    example: 'UPPER("bo") = "BO"',
  },
  {
    id: 'LOWER',
    label: 'Minúsculas',
    category: 'TEXT',
    description: 'Convierte a minúsculas',
    args: [text('a', 'Texto')],
    returns: 'STRING',
    example: 'LOWER("BO") = "bo"',
  },
  {
    id: 'TRIM',
    label: 'Quitar espacios',
    category: 'TEXT',
    description: 'Elimina espacios al inicio y al final',
    args: [text('a', 'Texto')],
    returns: 'STRING',
    example: 'TRIM(" x ") = "x"',
  },
  {
    id: 'LENGTH',
    label: 'Longitud',
    category: 'TEXT',
    description: 'Número de caracteres',
    args: [text('a', 'Texto')],
    returns: 'INTEGER',
    example: 'LENGTH("abc") = 3',
  },

  // Conversión
  {
    id: 'TO_NUMBER',
    label: 'A número',
    category: 'CONVERSION',
    description: 'Convierte texto a número',
    args: [any('a', 'Valor')],
    returns: 'DECIMAL',
    example: 'TO_NUMBER("12.5") = 12.5',
  },
  {
    id: 'TO_TEXT',
    label: 'A texto',
    category: 'CONVERSION',
    description: 'Convierte a texto',
    args: [any('a', 'Valor')],
    returns: 'STRING',
    example: 'TO_TEXT(12) = "12"',
  },
  {
    id: 'TO_PERCENTAGE',
    label: 'A porcentaje',
    category: 'CONVERSION',
    description: 'Convierte una fracción 0-1 en porcentaje 0-100',
    args: [num('a', 'Fracción')],
    returns: 'PERCENTAGE',
    example: 'TO_PERCENTAGE(0.375) = 37.5',
  },

  // Comparación y lógica
  {
    id: 'EQUALS',
    label: 'Igual a',
    category: 'COMPARISON',
    description: 'Compara dos valores',
    args: [any('a', 'Valor'), any('b', 'Valor')],
    returns: 'BOOLEAN',
    example: 'EQUALS("A", "A") = true',
  },
  {
    id: 'GREATER_THAN',
    label: 'Mayor que',
    category: 'COMPARISON',
    description: 'a > b',
    args: [num('a', 'Valor'), num('b', 'Valor')],
    returns: 'BOOLEAN',
    example: 'GREATER_THAN(3, 2) = true',
  },
  {
    id: 'LESS_THAN',
    label: 'Menor que',
    category: 'COMPARISON',
    description: 'a < b',
    args: [num('a', 'Valor'), num('b', 'Valor')],
    returns: 'BOOLEAN',
    example: 'LESS_THAN(2, 3) = true',
  },
  {
    id: 'BETWEEN',
    label: 'Entre',
    category: 'COMPARISON',
    description: 'Comprueba si está en un rango inclusivo',
    args: [num('a', 'Valor'), num('min', 'Mínimo'), num('max', 'Máximo')],
    returns: 'BOOLEAN',
    example: 'BETWEEN(5, 1, 10) = true',
  },
  {
    id: 'AND',
    label: 'Y lógico',
    category: 'LOGIC',
    description: 'Conjunción',
    args: [
      { name: 'a', types: ['BOOLEAN'], required: true, description: 'Condición' },
      { name: 'b', types: ['BOOLEAN'], required: true, description: 'Condición' },
    ],
    returns: 'BOOLEAN',
    variadic: true,
    example: 'AND(true, false) = false',
  },
  {
    id: 'OR',
    label: 'O lógico',
    category: 'LOGIC',
    description: 'Disyunción',
    args: [
      { name: 'a', types: ['BOOLEAN'], required: true, description: 'Condición' },
      { name: 'b', types: ['BOOLEAN'], required: true, description: 'Condición' },
    ],
    returns: 'BOOLEAN',
    variadic: true,
    example: 'OR(true, false) = true',
  },
  {
    id: 'NOT',
    label: 'Negación',
    category: 'LOGIC',
    description: 'Niega una condición',
    args: [{ name: 'a', types: ['BOOLEAN'], required: true, description: 'Condición' }],
    returns: 'BOOLEAN',
    example: 'NOT(true) = false',
  },
  {
    id: 'IF',
    label: 'Si… entonces',
    category: 'LOGIC',
    description: 'Devuelve un valor u otro según la condición',
    args: [
      { name: 'condition', types: ['BOOLEAN'], required: true, description: 'Condición' },
      any('then', 'Valor si se cumple'),
      any('else', 'Valor si no se cumple'),
    ],
    returns: 'STRING',
    example: 'IF(true, "A", "B") = "A"',
  },
  {
    id: 'COALESCE',
    label: 'Primer valor presente',
    category: 'LOGIC',
    description: 'Primer argumento no nulo',
    args: [any('a', 'Valor'), any('b', 'Valor')],
    returns: 'STRING',
    variadic: true,
    example: 'COALESCE(null, 3) = 3',
  },

  // Listas y agregación
  {
    id: 'COUNT',
    label: 'Contar',
    category: 'LIST',
    description: 'Número de elementos',
    args: [list('values', 'Lista')],
    returns: 'INTEGER',
    example: 'COUNT([1,2]) = 2',
  },
  {
    id: 'SUM',
    label: 'Sumatoria',
    category: 'AGGREGATION',
    description: 'Suma los elementos de una lista',
    args: [list('values', 'Lista de números')],
    returns: 'DECIMAL',
    example: 'SUM([1,2,3]) = 6',
  },
  {
    id: 'CONTAINS',
    label: 'Contiene',
    category: 'LIST',
    description: '¿La lista contiene el valor?',
    args: [list('values', 'Lista'), any('value', 'Valor buscado')],
    returns: 'BOOLEAN',
    example: 'CONTAINS(["A"], "A") = true',
  },

  // Datos
  {
    id: 'INPUT',
    label: 'Entrada',
    category: 'DATA',
    description: 'Valor de una entrada del campo calculado',
    args: [text('id', 'Identificador de la entrada')],
    returns: 'STRING',
    example: 'INPUT("ingreso_mensual")',
  },
  {
    id: 'CONSTANT',
    label: 'Constante',
    category: 'DATA',
    description: 'Valor literal',
    args: [any('value', 'Valor')],
    returns: 'STRING',
    example: 'CONSTANT(0.45)',
  },
];

export const OPERATIONS_BY_ID: ReadonlyMap<string, OperationDefinition> = new Map(
  OPERATIONS.map((operation) => [operation.id, operation]),
);

export const OPERATION_CATEGORIES: readonly OperationCategory[] = [
  ...new Set(OPERATIONS.map((operation) => operation.category)),
];
