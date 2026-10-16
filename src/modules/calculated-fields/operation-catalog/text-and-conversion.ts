import type { OperationDefinition } from './types';
import { num, any, text } from './builders';

export const TEXT_AND_CONVERSION_OPERATIONS: readonly OperationDefinition[] = [
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
];
