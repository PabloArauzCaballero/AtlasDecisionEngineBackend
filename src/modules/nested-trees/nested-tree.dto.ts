import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/http/pagination';

/** One entry of a reference's input mapping: how a child input variable gets its value. */
export class InputMappingEntryDto {
  @IsString() @Matches(/^[a-zA-Z][a-zA-Z0-9_]{0,159}$/) childVariableCode!: string;
  @IsIn(['VARIABLE', 'LITERAL', 'EXPRESSION']) source!: 'VARIABLE' | 'LITERAL' | 'EXPRESSION';
  /** Dot-path into the parent's variables/decision/output context, for source=VARIABLE. */
  @IsOptional() @IsString() path?: string;
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
  @IsString() childArtifactId!: string;
  @IsString() childArtifactVersionId!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => InputMappingEntryDto)
  inputMapping!: InputMappingEntryDto[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => OutputMappingEntryDto)
  outputMapping!: OutputMappingEntryDto[];
  @IsOptional() @IsInt() @Min(50) @Max(60_000) timeoutMs?: number;
  @IsOptional() @IsIn(['FAIL', 'FALLBACK', 'SKIP']) onErrorPolicy?: 'FAIL' | 'FALLBACK' | 'SKIP';
  @IsOptional() @IsObject() fallbackOutput?: Record<string, unknown>;
  @IsOptional() @IsString() @Matches(/^[A-Z0-9_]{2,80}$/) requiredRole?: string;
}

export class UpdateArtifactReferenceDto {
  @IsOptional() @IsString() childArtifactVersionId?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => InputMappingEntryDto)
  inputMapping?: InputMappingEntryDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OutputMappingEntryDto)
  outputMapping?: OutputMappingEntryDto[];
  @IsOptional() @IsInt() @Min(50) @Max(60_000) timeoutMs?: number;
  @IsOptional() @IsIn(['FAIL', 'FALLBACK', 'SKIP']) onErrorPolicy?: 'FAIL' | 'FALLBACK' | 'SKIP';
  @IsOptional() @IsObject() fallbackOutput?: Record<string, unknown>;
  @IsOptional() @IsString() @Matches(/^[A-Z0-9_]{2,80}$/) requiredRole?: string;
}

export class ReferenceListQueryDto extends PaginationQueryDto {}
