import { Tokens } from './types';

export const any =
  (...words: string[]) =>
  (tokens: Tokens) =>
    words.some((word) => tokens.has(word));
export const all =
  (...tests: Array<(tokens: Tokens) => boolean>) =>
  (tokens: Tokens) =>
    tests.every((test) => test(tokens));
export const either =
  (...tests: Array<(tokens: Tokens) => boolean>) =>
  (tokens: Tokens) =>
    tests.some((test) => test(tokens));

export const NAME = any('nombre', 'name', 'nombres');
