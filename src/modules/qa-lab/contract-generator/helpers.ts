import { type DataType } from '../../../common/contracts/data-types';

export function isTextual(type: DataType): boolean {
  return ['STRING', 'LONG_TEXT', 'CODE', 'IDENTIFIER', 'ENUM'].includes(type);
}

export function listOf(size: number): number[] {
  return Array.from({ length: Math.max(0, size) }, (_, index) => index);
}

/** Corta la basura binaria de la aritmética flotante al proponer un borde. */
export function round(value: number): number {
  return Number(value.toFixed(10));
}

/** Un valor de otro tipo, garantizado incompatible con `type`. */
export function typeMismatchFor(type: DataType): unknown {
  if (['INTEGER', 'DECIMAL', 'PERCENTAGE', 'CURRENCY'].includes(type)) return 'no-soy-un-numero';
  if (type === 'BOOLEAN') return 'quizá';
  if (type === 'LIST') return { noSoy: 'una lista' };
  if (type === 'OBJECT' || type === 'STRUCTURED_RESULT') return ['no', 'soy', 'un', 'objeto'];
  return 12345;
}
