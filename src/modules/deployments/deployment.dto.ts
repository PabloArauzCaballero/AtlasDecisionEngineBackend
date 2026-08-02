/** Deployment contracts constrain environment, mode, effective window and traffic allocation. */
import { Type } from 'class-transformer';
import { DeploymentStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/http/pagination';
import { DATABASE_ID_PATTERN } from '../../common/http/id';
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
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class TrafficRuleDto {
  @IsString() @MaxLength(100) segmentKey!: string;
  @IsNumber() @Min(0) @Max(100) trafficPercentage!: number;
  @IsOptional() @IsObject() routingExpression?: Record<string, unknown>;
  @IsInt() @Min(0) priority!: number;
}

export class DeployVersionDto {
  @IsString() @MaxLength(40) environmentCode!: string;
  @IsIn(['DIRECT', 'CANARY', 'CHAMPION_CHALLENGER']) deploymentMode!:
    'DIRECT' | 'CANARY' | 'CHAMPION_CHALLENGER';
  @IsOptional() @IsDateString() effectiveFrom?: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
  /** Pins the deployment to an immutable compiled snapshot when the caller needs reproducibility. */
  @IsOptional() @IsString() @Matches(DATABASE_ID_PATTERN) compiledArtifactId?: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TrafficRuleDto)
  traffic!: TrafficRuleDto[];
}

export class RollbackDeploymentDto {
  @IsString() @MaxLength(8_000) reason!: string;
}

export class SuspendDeploymentDto {
  @IsString() @MaxLength(8_000) reason!: string;
}

export class DeploymentListQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() @MaxLength(100) artifactCode?: string;
  @IsOptional() @IsString() @MaxLength(40) environmentCode?: string;
  @IsOptional() @IsEnum(DeploymentStatus) status?: DeploymentStatus;
}
