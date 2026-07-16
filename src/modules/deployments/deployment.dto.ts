import { Type } from 'class-transformer';
import { DeploymentStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/http/pagination';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class TrafficRuleDto {
  @IsString() segmentKey!: string;
  @IsNumber() @Min(0) @Max(100) trafficPercentage!: number;
  @IsOptional() @IsObject() routingExpression?: Record<string, unknown>;
  @IsInt() @Min(0) priority!: number;
}

export class DeployVersionDto {
  @IsString() environmentCode!: string;
  @IsIn(['DIRECT', 'CANARY', 'CHAMPION_CHALLENGER']) deploymentMode!:
    | 'DIRECT'
    | 'CANARY'
    | 'CHAMPION_CHALLENGER';
  @IsOptional() @IsDateString() effectiveFrom?: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
  @IsOptional() @IsString() compiledArtifactId?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => TrafficRuleDto)
  traffic!: TrafficRuleDto[];
}

export class RollbackDeploymentDto {
  @IsString() reason!: string;
}

export class SuspendDeploymentDto {
  @IsString() reason!: string;
}

export class DeploymentListQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() @MaxLength(100) artifactCode?: string;
  @IsOptional() @IsString() @MaxLength(40) environmentCode?: string;
  @IsOptional() @IsEnum(DeploymentStatus) status?: DeploymentStatus;
}
