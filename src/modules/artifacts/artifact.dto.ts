import { Type } from 'class-transformer';
import { VersionStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/http/pagination';
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
  @IsOptional() @IsString() description?: string;
  @IsString() @IsNotEmpty() @MaxLength(100) ownerTeam!: string;
  @IsString() @IsNotEmpty() businessPurpose!: string;
  @IsString() @IsNotEmpty() @MaxLength(50) riskDomain!: string;
  @IsOptional() @IsString() @MaxLength(40) semanticVersion?: string;
}

export class CloneVersionDto {
  @IsString() @IsNotEmpty() changeSummary!: string;
  @IsOptional() @IsString() @MaxLength(40) semanticVersion?: string;
}

export class DependencyDto {
  @IsString() variableVersionId!: string;
  @IsIn(['INPUT', 'OUTPUT', 'OUTPUT_PRIMARY']) usageType!: 'INPUT' | 'OUTPUT' | 'OUTPUT_PRIMARY';
  @IsBoolean() isRequired!: boolean;
  @IsString() fallbackPolicy!: string;
  @IsString() @Matches(/^(input|output)\.[a-zA-Z][a-zA-Z0-9_.-]{1,199}$/) dependencyPath!: string;
}

export class ConditionDto {
  @IsString() @Matches(/^[A-Z0-9_\-]{2,120}$/) code!: string;
  @IsString() name!: string;
  @IsString() expressionType!: string;
  @IsObject() expression!: Record<string, unknown>;
  @IsString() severity!: string;
  @IsBoolean() reusable!: boolean;
}

export class ActionReasonDto {
  @IsString() reasonCodeId!: string;
  @IsInt() @Min(1) priority!: number;
  @IsOptional() @IsObject() messageTemplate?: Record<string, unknown>;
}

export class ActionDto {
  @IsString() @Matches(/^[A-Z0-9_\-]{2,120}$/) code!: string;
  @IsString() type!: string;
  @IsOptional() @IsObject() payloadSchema?: Record<string, unknown>;
  @IsObject() payload!: Record<string, unknown>;
  @IsBoolean() terminal!: boolean;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ActionReasonDto)
  reasonCodes!: ActionReasonDto[];
}

export class NodeConditionBindingDto {
  @IsString() conditionCode!: string;
  @IsInt() @Min(1) order!: number;
  @IsBoolean() expected!: boolean;
}

export class NodeActionBindingDto {
  @IsString() actionCode!: string;
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
    | 'END';
  @IsString() label!: string;
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
}

export class EdgeConditionBindingDto {
  @IsString() conditionCode!: string;
  @IsInt() @Min(1) order!: number;
}

export class EdgeDto {
  @IsString() @Matches(/^[A-Za-z0-9_\-]{2,120}$/) key!: string;
  @IsString() from!: string;
  @IsString() to!: string;
  @IsString() type!: string;
  @IsInt() @Min(0) priority!: number;
  @IsBoolean() default!: boolean;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EdgeConditionBindingDto)
  conditions!: EdgeConditionBindingDto[];
}

export class ReplaceGraphDto {
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
