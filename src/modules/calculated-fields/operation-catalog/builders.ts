import type { OperationArgument } from './types';

export const num = (name: string, description: string, required = true): OperationArgument => ({
  name,
  types: ['INTEGER', 'DECIMAL', 'PERCENTAGE', 'CURRENCY'],
  required,
  description,
});
export const any = (name: string, description: string, required = true): OperationArgument => ({
  name,
  types: [],
  required,
  description,
});
export const text = (name: string, description: string, required = true): OperationArgument => ({
  name,
  types: ['STRING', 'LONG_TEXT', 'CODE', 'IDENTIFIER', 'ENUM'],
  required,
  description,
});
export const list = (name: string, description: string): OperationArgument => ({
  name,
  types: ['LIST'],
  required: true,
  description,
});
