import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Códigos del catálogo de ambientes de decisión.
 *
 * `SANDBOX` es como se llamaba `DEV` cuando el catálogo tenía tres ambientes. Se
 * sigue aceptando para que una instalación que aún no ha migrado su catálogo no
 * reciba un 400 que no explica nada.
 */
export const LIVE_EXECUTION_ENVIRONMENT_CODES = [
  'DEV',
  'STAGING',
  'TEST',
  'PROD',
  'SANDBOX',
] as const;

export type LiveExecutionEnvironmentCode = (typeof LIVE_EXECUTION_ENVIRONMENT_CODES)[number];

/** Bounded query contract for a management-only live decision preview. */
export class LiveExecutionStreamQueryDto {
  @IsString() @MaxLength(100) artifactCode!: string;
  @IsIn([...LIVE_EXECUTION_ENVIRONMENT_CODES]) environmentCode!: LiveExecutionEnvironmentCode;
  @IsString()
  @MaxLength(120)
  @Matches(/^[A-Za-z0-9._:-]{8,120}$/)
  requestId!: string;
  /** JSON-encoded input variables, e.g. `?variables=%7B%22age%22%3A30%7D`. */
  @IsString() @MaxLength(16_384) variables!: string;
  @IsOptional() @IsString() @MaxLength(200) subjectReference?: string;
}
