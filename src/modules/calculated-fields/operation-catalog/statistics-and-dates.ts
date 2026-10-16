import type { OperationDefinition } from './types';
import { num, list } from './builders';

export const STATISTICS_AND_DATE_OPERATIONS: readonly OperationDefinition[] = [
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
];
