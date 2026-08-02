import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/http/pagination';
import { DATABASE_ID_PATTERN } from '../../common/http/id';

/** One entry of a reference's input mapping: how a child input variable gets its value. */
export class InputMappingEntryDto {
  @IsString() @Matches(/^[a-zA-Z][a-zA-Z0-9_]{0,159}$/) childVariableCode!: string;
  @IsIn(['VARIABLE', 'LITERAL', 'EXPRESSION']) source!: 'VARIABLE' | 'LITERAL' | 'EXPRESSION';
  /** Dot-path into the parent's variables/decision/output context, for source=VARIABLE. */
  @IsOptional() @IsString() @MaxLength(500) path?: string;
  /** Literal value, for source=LITERAL. */
  @IsOptional() value?: unknown;
  /** JSON-logic expression (same AST the rest of the engine uses), for source=EXPRESSION. */
  @IsOptional() @IsObject() expression?: Record<string, unknown>;
}

/**
 * One entry of a reference's output allowlist: which of the child's declared output
 * variable codes this reference exposes to the parent. The parent's own RESULT node
 * (mode=REFERENCE) then reads a specific value by this same code in its
 * `outputAssignments[].childOutputCode` and assigns it to one of ITS OWN declared
 * outputs — see execution-engine.service.ts.
 */
export class OutputMappingEntryDto {
  @IsString() @Matches(/^[a-zA-Z][a-zA-Z0-9_]{0,159}$/) childOutputCode!: string;
}

export class CreateArtifactReferenceDto {
  /** Key of the RESULT node (mode=REFERENCE) in the parent's graph that owns this reference. */
  @IsString() @Matches(/^[A-Za-z0-9_\-]{2,120}$/) nodeKey!: string;
  @IsString() @Matches(DATABASE_ID_PATTERN) childArtifactId!: string;
  @IsString() @Matches(DATABASE_ID_PATTERN) childArtifactVersionId!: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InputMappingEntryDto)
  inputMapping!: InputMappingEntryDto[];
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OutputMappingEntryDto)
  outputMapping!: OutputMappingEntryDto[];
  @IsOptional() @IsInt() @Min(50) @Max(60_000) timeoutMs?: number;
  @IsOptional() @IsIn(['FAIL', 'FALLBACK', 'SKIP']) onErrorPolicy?: 'FAIL' | 'FALLBACK' | 'SKIP';
  @IsOptional() @IsObject() fallbackOutput?: Record<string, unknown>;
  @IsOptional() @IsString() @Matches(/^[A-Z0-9_]{2,80}$/) requiredRole?: string;

  // --- §9: el resto de lo que una referencia debe poder configurar ---
  /** Ambiente en el que se resuelve el hijo. Vacío = el mismo que el padre. */
  @IsOptional() @IsString() @Matches(/^[A-Z0-9_]{2,40}$/) environmentCode?: string;
  /** EXACT fija la versión; ACTIVE_IN_ENVIRONMENT resuelve la activa del ambiente. */
  @IsOptional()
  @IsIn(['EXACT', 'ACTIVE_IN_ENVIRONMENT'])
  versionSelection?: 'EXACT' | 'ACTIVE_IN_ENVIRONMENT';
  @IsOptional() @IsInt() @Min(0) @Max(3) maxRetries?: number;
  @IsOptional() @IsInt() @Min(0) @Max(5_000) retryDelayMs?: number;
  /** Si no se cumple, la referencia se omite sin invocar al hijo. */
  @IsOptional() @IsObject() executionCondition?: Record<string, unknown>;
  /** Una referencia opcional que falla no tumba la decisión del padre. */
  @IsOptional() @IsBoolean() isRequired?: boolean;
  @IsOptional()
  @IsIn(['FULL', 'MASKED', 'REDACTED', 'EXCLUDED'])
  tracePolicy?: 'FULL' | 'MASKED' | 'REDACTED' | 'EXCLUDED';
}

export class UpdateArtifactReferenceDto {
  @IsOptional() @IsString() @Matches(DATABASE_ID_PATTERN) childArtifactVersionId?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InputMappingEntryDto)
  inputMapping?: InputMappingEntryDto[];
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OutputMappingEntryDto)
  outputMapping?: OutputMappingEntryDto[];
  @IsOptional() @IsInt() @Min(50) @Max(60_000) timeoutMs?: number;
  @IsOptional() @IsIn(['FAIL', 'FALLBACK', 'SKIP']) onErrorPolicy?: 'FAIL' | 'FALLBACK' | 'SKIP';
  @IsOptional() @IsObject() fallbackOutput?: Record<string, unknown>;
  @IsOptional() @IsString() @Matches(/^[A-Z0-9_]{2,80}$/) requiredRole?: string;

  // --- §9: el resto de lo que una referencia debe poder configurar ---
  /** Ambiente en el que se resuelve el hijo. Vacío = el mismo que el padre. */
  @IsOptional() @IsString() @Matches(/^[A-Z0-9_]{2,40}$/) environmentCode?: string;
  /** EXACT fija la versión; ACTIVE_IN_ENVIRONMENT resuelve la activa del ambiente. */
  @IsOptional()
  @IsIn(['EXACT', 'ACTIVE_IN_ENVIRONMENT'])
  versionSelection?: 'EXACT' | 'ACTIVE_IN_ENVIRONMENT';
  @IsOptional() @IsInt() @Min(0) @Max(3) maxRetries?: number;
  @IsOptional() @IsInt() @Min(0) @Max(5_000) retryDelayMs?: number;
  /** Si no se cumple, la referencia se omite sin invocar al hijo. */
  @IsOptional() @IsObject() executionCondition?: Record<string, unknown>;
  /** Una referencia opcional que falla no tumba la decisión del padre. */
  @IsOptional() @IsBoolean() isRequired?: boolean;
  @IsOptional()
  @IsIn(['FULL', 'MASKED', 'REDACTED', 'EXCLUDED'])
  tracePolicy?: 'FULL' | 'MASKED' | 'REDACTED' | 'EXCLUDED';
}

export class ReferenceListQueryDto extends PaginationQueryDto {}
