/** Review contracts keep evidence bounded and decisions inside the approved vocabulary. */
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../common/http/pagination';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class SubmitReviewDto {
  @IsOptional() @IsString() @MaxLength(100) workflowCode?: string;
  @IsBoolean() requireCompliance!: boolean;
  @IsOptional() @IsDateString() dueAt?: string;
}

export class ApprovalEvidenceDto {
  @IsString() @MaxLength(50) evidenceType!: string;
  @IsString() @IsNotEmpty() @MaxLength(2_048) uri!: string;
  @IsString() @IsNotEmpty() @MaxLength(128) checksum!: string;
  @IsOptional() metadata?: unknown;
}

export class RecordApprovalDecisionDto {
  @IsIn(['APPROVE', 'REQUEST_CHANGES', 'REJECT'])
  decision!: 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT';
  @IsOptional() @IsString() @MaxLength(8_000) comments?: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApprovalEvidenceDto)
  evidence!: ApprovalEvidenceDto[];
}

export class CreateCustomApprovalStepDto {
  @IsInt() @Min(1) stepOrder!: number;
  @IsString() @MaxLength(80) requiredRole!: string;
  @IsInt() @Min(1) minApprovals!: number;
  @IsBoolean() separationOfDuties!: boolean;
}

export class ApprovalRequestListQueryDto extends PaginationQueryDto {}
