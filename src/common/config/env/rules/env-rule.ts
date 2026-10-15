import type { z } from 'zod';
import type { RawEnv } from '../env-object';

/** Una comprobación entre variables que el esquema por campo no puede hacer. */
export type EnvRule = (value: RawEnv, ctx: z.RefinementCtx) => void;
