import { IsEnum, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { ManualReviewStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/http/pagination';

export class AssignManualReviewDto {
  @IsString() assignedTo!: string;
}

export class ResolveManualReviewDto {
  @IsIn(['APPROVE', 'DECLINE', 'CANCEL']) decision!: 'APPROVE' | 'DECLINE' | 'CANCEL';
  @IsString() reason!: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class ManualReviewListQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(ManualReviewStatus) status?: ManualReviewStatus;
  @IsOptional() @IsString() @MaxLength(160) assignedTo?: string;
  @IsOptional() @IsString() @MaxLength(80) queueCode?: string;
}
