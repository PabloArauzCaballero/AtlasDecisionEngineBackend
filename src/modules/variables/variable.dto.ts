import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../common/http/pagination';
import { DATA_TYPES } from '../../common/contracts/data-types';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class VariableSourceDto {
  @IsString() @IsNotEmpty() @MaxLength(100) sourceSystemCode!: string;
  @IsString() @IsNotEmpty() @MaxLength(500) sourcePath!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) sourceField!: string;
  @IsInt() @Min(1) freshnessSlaSeconds!: number;
  @IsInt() @Min(1) precedence!: number;
  @IsBoolean() isAuthoritative!: boolean;
}

export class VariableValidationRuleDto {
  @IsString() @MaxLength(50) ruleType!: string;
  @IsObject() config!: Record<string, unknown>;
  @IsString() @MaxLength(30) severity!: string;
  @IsString() @MaxLength(100) errorCode!: string;
}

const SENSITIVITY = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'PII',
  'SENSITIVE_PII',
  'SECRET',
] as const;
const ORIGINS = ['REQUEST', 'PROVIDER', 'DERIVED', 'CALCULATED_FIELD', 'GRAPH_NODE'] as const;

export class VariableVersionDto {
  @IsIn([...DATA_TYPES]) dataType!: string;
  @IsOptional() @IsString() @MaxLength(40) unitCode?: string;
  @IsBoolean() nullable!: boolean;
  @IsOptional() defaultValue?: unknown;
  @IsOptional() @IsObject() validationSchema?: Record<string, unknown>;
  @IsOptional() @IsObject() derivationExpression?: Record<string, unknown>;
  @IsOptional() @IsDateString() effectiveFrom?: string;

  // --- §1.1: lo que un contrato de variable debe declarar como mínimo ---
  /** Nombre visible de esta versión; puede cambiar sin tocar el código técnico. */
  @IsOptional() @IsString() @MaxLength(160) displayName?: string;
  @IsOptional() @IsString() @MaxLength(8_000) description?: string;
  /** Restricciones normalizadas. Autoritativas frente a `validationSchema`. */
  @IsOptional() @IsObject() constraints?: Record<string, unknown>;
  /** Mensaje mostrado cuando el valor incumple el contrato. */
  @IsOptional() @IsString() @MaxLength(400) validationMessage?: string;
  @IsOptional() exampleValid?: unknown;
  @IsOptional() exampleInvalid?: unknown;
  @IsOptional() @IsIn([...ORIGINS]) expectedOrigin?: (typeof ORIGINS)[number];
  @IsOptional() @IsString() @MaxLength(20) contractVersion?: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariableSourceDto)
  sources!: VariableSourceDto[];
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariableValidationRuleDto)
  validationRules!: VariableValidationRuleDto[];
}

export class CreateVariableDefinitionDto {
  @IsString() @Matches(/^[a-zA-Z][a-zA-Z0-9_\.\-]{1,119}$/) variableCode!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) canonicalName!: string;
  @IsString() @IsNotEmpty() @MaxLength(8_000) businessDescription!: string;
  @IsString() @IsNotEmpty() @MaxLength(50) dataClassification!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) ownerTeam!: string;
  @IsBoolean() isSensitive!: boolean;
  // `@ValidateNested()` no comprueba presencia: sobre `undefined` no hay nada que validar y
  // lo deja pasar. Sin `@IsDefined()` la petición llegaba al servicio sin contrato y
  // reventaba leyendo `dataType`, devolviendo un 500 donde toca un 400.
  @IsDefined()
  @ValidateNested()
  @Type(() => VariableVersionDto)
  initialVersion!: VariableVersionDto;
}

export class CreateVariableVersionDto extends VariableVersionDto {}

/**
 * Validación del contrato ANTES de guardarlo (§1.2). Devuelve los incumplimientos y
 * comprueba los ejemplos declarados, para que el autor no descubra el problema al
 * publicar una versión que ya es inmutable.
 */
export class ValidateVariableContractDto extends VariableVersionDto {
  /** Valores extra con los que probar el contrato, además de los ejemplos declarados. */
  @IsOptional() @IsArray() @ArrayMaxSize(20) sampleValues?: unknown[];
}

/** Actualiza los metadatos de gobierno de la definición (§1.1). */
export class UpdateVariableDefinitionDto {
  @IsOptional() @IsString() @MaxLength(160) canonicalName?: string;
  @IsOptional() @IsString() @MaxLength(8_000) businessDescription?: string;
  @IsOptional() @IsString() @MaxLength(100) ownerTeam?: string;
  @IsOptional() @IsIn([...SENSITIVITY]) sensitivityClass?: (typeof SENSITIVITY)[number];
  @IsOptional() @IsIn(['DRAFT', 'ACTIVE', 'DEPRECATED', 'RETIRED']) lifecycleState?: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class CreateReasonCodeDto {
  @IsString() @Matches(/^[A-Z0-9_\-]{2,120}$/) reasonCode!: string;
  @IsString() @MaxLength(50) category!: string;
  @IsString() @MaxLength(2_000) publicMessage!: string;
  @IsString() @MaxLength(8_000) internalMessage!: string;
  @IsString() @MaxLength(30) severity!: string;
  @IsBoolean() isAdverseAction!: boolean;
}

export class VariableListQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  /** Sentido en el que los algoritmos usan la variable: entrada o salida. */
  @IsOptional() @IsIn(['INPUT', 'OUTPUT']) usage?: 'INPUT' | 'OUTPUT';
}

export class ReasonCodeListQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() @MaxLength(80) category?: string;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
}
