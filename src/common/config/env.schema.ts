import type { z } from 'zod';
import { compiledIdentity, resolveCommit } from './build-identity';
import { envObject } from './env/env-object';
import { ALWAYS_RULES, PRODUCTION_RULES } from './env/rules';

/**
 * El esquema completo de variables de entorno: los campos viven por dominio en `env/*.env.ts`,
 * las comprobaciones entre variables en `env/rules/`.
 */
export const envSchema = envObject.superRefine((value, ctx) => {
  for (const rule of ALWAYS_RULES) rule(value, ctx);
  if (value.NODE_ENV === 'production') {
    for (const rule of PRODUCTION_RULES) rule(value, ctx);
  }
});

export type AppEnv = z.infer<typeof envSchema>;

/** Parses, normalizes and validates the complete application environment. */
export function validateEnvironment(input: Record<string, unknown>): AppEnv {
  const parsed = envSchema.parse(input);
  // El commit sellado en el artefacto manda sobre COMMIT_SHA (ver build-identity.ts).
  return { ...parsed, COMMIT_SHA: resolveCommit(parsed.COMMIT_SHA, compiledIdentity()) };
}
