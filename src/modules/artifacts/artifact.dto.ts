/**
 * Authoring contracts with explicit cardinality and identifier bounds; these limits protect both
 * reviewer usability and transaction size when a complete graph is replaced.
 */
import { Type } from 'class-transformer';
import { VersionStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/http/pagination';
import { DATABASE_ID_PATTERN } from '../../common/http/id';
import { CalculatedFieldCallDto, ContractExtensionsDto } from './artifact-contract.dto';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateArtifactDto {
  @IsString() @Matches(/^[A-Z0-9_\-]{3,100}$/) artifactCode!: string;
  @IsString() @IsNotEmpty() @MaxLength(50) artifactType!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(8_000) description?: string;
  @IsString() @IsNotEmpty() @MaxLength(100) ownerTeam!: string;
  @IsString() @IsNotEmpty() @MaxLength(8_000) businessPurpose!: string;
  @IsString() @IsNotEmpty() @MaxLength(50) riskDomain!: string;
  @IsOptional() @IsString() @MaxLength(40) semanticVersion?: string;
}

export class CloneVersionDto {
  @IsString() @IsNotEmpty() @MaxLength(8_000) changeSummary!: string;
  @IsOptional() @IsString() @MaxLength(40) semanticVersion?: string;
}

export class DependencyDto {
  @IsString() @Matches(DATABASE_ID_PATTERN) variableVersionId!: string;
  /**
   * INTERMEDIATE no es un valor válido aquí a propósito: una intermedia no cuelga del
   * catálogo global de variables (§2.1) y se declara en `ReplaceGraphDto.intermediates`.
   */
  @IsIn(['INPUT', 'OUTPUT', 'OUTPUT_PRIMARY'], {
    message:
      'usageType debe ser INPUT, OUTPUT u OUTPUT_PRIMARY. Las variables intermedias se declaran en "intermediates", no como dependencia del catálogo.',
  })
  usageType!: 'INPUT' | 'OUTPUT' | 'OUTPUT_PRIMARY';
  @IsBoolean() isRequired!: boolean;
  @IsString() @MaxLength(50) fallbackPolicy!: string;
  @IsString() @Matches(/^(input|output)\.[a-zA-Z][a-zA-Z0-9_.-]{1,199}$/) dependencyPath!: string;
}

export class ConditionDto {
  @IsString() @Matches(/^[A-Z0-9_\-]{2,120}$/) code!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsString() @MaxLength(50) expressionType!: string;
  @IsObject() expression!: Record<string, unknown>;
  @IsString() @MaxLength(30) severity!: string;
  @IsBoolean() reusable!: boolean;
}

export class ActionReasonDto {
  @IsString() @Matches(DATABASE_ID_PATTERN) reasonCodeId!: string;
  @IsInt() @Min(1) priority!: number;
  @IsOptional() @IsObject() messageTemplate?: Record<string, unknown>;
}

export class ActionDto {
  @IsString() @Matches(/^[A-Z0-9_\-]{2,120}$/) code!: string;
  @IsString() @MaxLength(50) type!: string;
  @IsOptional() @IsObject() payloadSchema?: Record<string, unknown>;
  @IsObject() payload!: Record<string, unknown>;
  @IsBoolean() terminal!: boolean;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ActionReasonDto)
  reasonCodes!: ActionReasonDto[];
}

export class NodeConditionBindingDto {
  @IsString() @Matches(/^[A-Z0-9_\-]{2,120}$/) conditionCode!: string;
  @IsInt() @Min(1) order!: number;
  @IsBoolean() expected!: boolean;
}

export class NodeActionBindingDto {
  @IsString() @Matches(/^[A-Z0-9_\-]{2,120}$/) actionCode!: string;
  @IsInt() @Min(1) order!: number;
}

export class NodeDto {
  @IsString() @Matches(/^[A-Za-z0-9_\-]{2,120}$/) key!: string;
  @IsIn([
    'START',
    'CONDITION',
    'SWITCH',
    'EXPRESSION',
    'DECISION_TABLE',
    'SCORE',
    'ACTION',
    'RESULT',
    'MANUAL_REVIEW',
    'WORKER',
    'END',
  ])
  type!:
    | 'START'
    | 'CONDITION'
    | 'SWITCH'
    | 'EXPRESSION'
    | 'DECISION_TABLE'
    | 'SCORE'
    | 'ACTION'
    | 'RESULT'
    | 'MANUAL_REVIEW'
    | 'WORKER'
    | 'END';
  @IsString() @MaxLength(200) label!: string;
  @IsObject() config!: Record<string, unknown>;
  @IsNumber() x!: number;
  @IsNumber() y!: number;
  @IsInt() @Min(0) order!: number;
  @IsBoolean() terminal!: boolean;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NodeConditionBindingDto)
  conditions!: NodeConditionBindingDto[];
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NodeActionBindingDto)
  actions!: NodeActionBindingDto[];

  /** Campos calculados que este nodo invoca (§5.1). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CalculatedFieldCallDto)
  calculatedFieldCalls?: CalculatedFieldCallDto[];
}

export class EdgeConditionBindingDto {
  @IsString() @Matches(/^[A-Z0-9_\-]{2,120}$/) conditionCode!: string;
  @IsInt() @Min(1) order!: number;
}

export class EdgeDto {
  @IsString() @Matches(/^[A-Za-z0-9_\-]{2,120}$/) key!: string;
  @IsString() @Matches(/^[A-Za-z0-9_\-]{2,120}$/) from!: string;
  @IsString() @Matches(/^[A-Za-z0-9_\-]{2,120}$/) to!: string;
  @IsString() @MaxLength(50) type!: string;
  @IsInt() @Min(0) priority!: number;
  @IsBoolean() default!: boolean;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EdgeConditionBindingDto)
  conditions!: EdgeConditionBindingDto[];
}

export class ReplaceGraphDto extends ContractExtensionsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DependencyDto)
  dependencies!: DependencyDto[];

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ConditionDto)
  conditions!: ConditionDto[];

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ActionDto)
  actions!: ActionDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => NodeDto)
  nodes!: NodeDto[];

  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => EdgeDto)
  edges!: EdgeDto[];
}

export class ArtifactListQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(VersionStatus) status?: VersionStatus;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
}

export class UpdateVersionNotesDto {
  @IsOptional() @IsString() @MaxLength(8000) notes?: string;
}
