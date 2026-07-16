import { Type } from "class-transformer";
import { PaginationQueryDto } from "../../common/http/pagination";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";

export class SubmitReviewDto {
  @IsOptional() @IsString() workflowCode?: string;
  @IsBoolean() requireCompliance!: boolean;
  @IsOptional() @IsString() dueAt?: string;
}

export class ApprovalEvidenceDto {
  @IsString() evidenceType!: string;
  @IsString() @IsNotEmpty() uri!: string;
  @IsString() @IsNotEmpty() checksum!: string;
  @IsOptional() metadata?: unknown;
}

export class RecordApprovalDecisionDto {
  @IsIn(["APPROVE", "REQUEST_CHANGES", "REJECT"])
  decision!: "APPROVE" | "REQUEST_CHANGES" | "REJECT";
  @IsOptional() @IsString() comments?: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApprovalEvidenceDto)
  evidence!: ApprovalEvidenceDto[];
}

export class CreateCustomApprovalStepDto {
  @IsInt() @Min(1) stepOrder!: number;
  @IsString() requiredRole!: string;
  @IsInt() @Min(1) minApprovals!: number;
  @IsBoolean() separationOfDuties!: boolean;
}

export class ApprovalRequestListQueryDto extends PaginationQueryDto {}
