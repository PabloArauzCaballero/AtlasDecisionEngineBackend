import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../common/http/pagination';
import {
  IsArray,
  IsBoolean,
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
  @IsString() @IsNotEmpty() sourceSystemCode!: string;
  @IsString() @IsNotEmpty() sourcePath!: string;
  @IsString() @IsNotEmpty() sourceField!: string;
  @IsInt() @Min(1) freshnessSlaSeconds!: number;
  @IsInt() @Min(1) precedence!: number;
  @IsBoolean() isAuthoritative!: boolean;
}

export class VariableValidationRuleDto {
  @IsString() ruleType!: string;
  @IsObject() config!: Record<string, unknown>;
  @IsString() severity!: string;
  @IsString() errorCode!: string;
}

export class VariableVersionDto {
  @IsString() dataType!: string;
  @IsOptional() @IsString() unitCode?: string;
  @IsBoolean() nullable!: boolean;
  @IsOptional() defaultValue?: unknown;
  @IsOptional() @IsObject() validationSchema?: Record<string, unknown>;
  @IsOptional() @IsObject() derivationExpression?: Record<string, unknown>;
  @IsOptional() @IsString() effectiveFrom?: string;
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
  @IsString() @IsNotEmpty() businessDescription!: string;
  @IsString() @IsNotEmpty() dataClassification!: string;
  @IsString() @IsNotEmpty() ownerTeam!: string;
  @IsBoolean() isSensitive!: boolean;
  @ValidateNested() @Type(() => VariableVersionDto) initialVersion!: VariableVersionDto;
}

export class CreateVariableVersionDto extends VariableVersionDto {}

export class CreateReasonCodeDto {
  @IsString() @Matches(/^[A-Z0-9_\-]{2,120}$/) reasonCode!: string;
  @IsString() category!: string;
  @IsString() publicMessage!: string;
  @IsString() internalMessage!: string;
  @IsString() severity!: string;
  @IsBoolean() isAdverseAction!: boolean;
}

export class VariableListQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
}

export class ReasonCodeListQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() @MaxLength(80) category?: string;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
}
