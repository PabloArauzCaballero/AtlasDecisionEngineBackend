import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
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
import { DATA_TYPES } from '../../common/contracts/data-types';

const POLICIES = ['FAIL', 'RETURN_NULL', 'RETURN_DEFAULT'] as const;
const IMPL_KINDS = ['OPERATION', 'JAVASCRIPT', 'PYTHON'] as const;

export class CalculatedFieldQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsString() @MaxLength(60) category?: string;
  @IsOptional() @IsIn([...IMPL_KINDS]) implementationKind?: (typeof IMPL_KINDS)[number];
  @IsOptional()
  @IsIn(['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'DEPRECATED', 'RETIRED'])
  status?: string;
}

export class CreateCalculatedFieldDto {
  @IsString() @Matches(/^[a-z][a-z0-9_]{2,119}$/) fieldCode!: string;
  @IsString() @MaxLength(160) name!: string;
  @IsString() @MaxLength(4_000) description!: string;
  /** Justificación funcional: por qué existe este cálculo (§5.2). */
  @IsString() @MaxLength(4_000) rationale!: string;
  @IsString() @MaxLength(60) category!: string;
  @IsString() @MaxLength(100) ownerTeam!: string;
}

export class CalculatedFieldInputDto {
  @IsString() @Matches(/^[a-z][a-z0-9_]{1,119}$/) id!: string;
  @IsString() @MaxLength(160) name!: string;
  @IsString() @MaxLength(2_000) description!: string;
  @IsIn([...DATA_TYPES]) dataType!: string;
  @IsBoolean() required!: boolean;
  @IsOptional() @IsObject() constraints?: Record<string, unknown>;
  @IsOptional() defaultValue?: unknown;
}

/** Contrato de retorno (§5.3). Sin él no se puede guardar la versión. */
export class CalculatedFieldReturnDto {
  @IsIn([...DATA_TYPES]) dataType!: string;
  @IsBoolean() nullable!: boolean;
  @IsOptional() @IsObject() constraints?: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0) @Max(10) precision?: number;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  nullConditions!: string[];

  @IsIn([...POLICIES]) divisionByZero!: (typeof POLICIES)[number];
  @IsIn([...POLICIES]) missingData!: (typeof POLICIES)[number];
  @IsIn([...POLICIES]) outOfRange!: (typeof POLICIES)[number];

  @IsString() @Matches(/^[A-Z0-9_]{3,80}$/) errorCode!: string;
  @IsOptional() @IsString() @MaxLength(2_000) description?: string;
}

/** Comentarios estructurados, fuera del código ejecutable (§5.4). */
export class CalculatedFieldCommentsDto {
  @IsOptional() @IsString() @MaxLength(4_000) overview?: string;
  @IsOptional() @IsString() @MaxLength(4_000) functional?: string;
  @IsOptional() @IsString() @MaxLength(4_000) inputsExplained?: string;
  @IsOptional() @IsString() @MaxLength(4_000) outputExplained?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  assumptions?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  limitations?: string[];
  @IsOptional() @IsString() @MaxLength(2_000) example?: string;
  @IsOptional() @IsString() @MaxLength(2_000) rationale?: string;
}

export class CalculatedFieldTestCaseDto {
  @IsString() @MaxLength(160) name!: string;
  @IsObject() inputs!: Record<string, unknown>;
  @IsOptional() expected?: unknown;
  @IsOptional() @IsString() @MaxLength(80) expectedErrorCode?: string;
}

export class CreateCalculatedFieldVersionDto {
  @IsIn([...IMPL_KINDS]) implementationKind!: (typeof IMPL_KINDS)[number];

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CalculatedFieldInputDto)
  inputs!: CalculatedFieldInputDto[];

  // `@ValidateNested()` no comprueba presencia: sobre `undefined` no hay nada que validar.
  // El contrato de retorno es obligatorio (§5.3), así que su ausencia debe ser un 400 aquí y
  // no un fallo del servidor más adelante.
  @IsDefined()
  @ValidateNested()
  @Type(() => CalculatedFieldReturnDto)
  returns!: CalculatedFieldReturnDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CalculatedFieldCommentsDto)
  comments?: CalculatedFieldCommentsDto;

  /** Árbol de operaciones cuando la modalidad es visual. */
  @IsOptional() @IsObject() operation?: Record<string, unknown>;
  /** Código de hasta tres líneas ejecutables cuando la modalidad es JS o Python. */
  @IsOptional() @IsString() @MaxLength(2_000) sourceCode?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Matches(DATABASE_ID_PATTERN, { each: true })
  libraryIds?: string[];

  @IsOptional() @IsInt() @Min(1) @Max(1_000) timeoutMs?: number;
  @IsOptional() @IsIn([...POLICIES]) errorPolicy?: (typeof POLICIES)[number];
  @IsOptional() defaultValue?: unknown;
  /** Ambiente al que va dirigida; limita qué librerías pueden usarse. */
  @IsOptional() @IsString() @MaxLength(40) environment?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CalculatedFieldTestCaseDto)
  testCases?: CalculatedFieldTestCaseDto[];
}

export class PromoteCalculatedFieldVersionDto {
  @IsIn(['IN_REVIEW', 'APPROVED', 'PUBLISHED', 'DEPRECATED', 'RETIRED']) status!: string;
  @IsOptional() @IsString() @MaxLength(2_000) note?: string;
}

/** Ejecución de prueba desde el panel (§6.1: "ejecutar ejemplos"). */
export class TryCalculatedFieldDto {
  @IsObject() inputs!: Record<string, unknown>;
}

/**
 * Generación de entradas de ejemplo a partir del contrato de la versión.
 *
 * Mismo vocabulario que el QA Lab (`GenerateSampleCasesDto`) a propósito: el
 * generador es el mismo, y dos nombres distintos para la misma clase de caso
 * acabarían significando cosas distintas.
 */
export class SampleCalculatedFieldInputsDto {
  @IsOptional() @IsIn(['VALID', 'BOUNDARY', 'INVALID']) kind?: 'VALID' | 'BOUNDARY' | 'INVALID';
  /** Repetir la semilla devuelve exactamente el mismo lote. */
  @IsOptional() @IsString() @MaxLength(120) seed?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) count?: number;
}
