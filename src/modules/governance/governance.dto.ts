/** Review contracts keep evidence bounded and decisions inside the approved vocabulary. */
import { Transform, Type } from 'class-transformer';
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
  MinLength,
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

/** Lo justo para una frase con sentido («Revisé cobertura y umbrales»), no un «ok». */
export const APPROVAL_COMMENT_MIN_LENGTH = 10;
export const APPROVAL_COMMENT_MAX_LENGTH = 8_000;

export class RecordApprovalDecisionDto {
  @IsIn(['APPROVE', 'REQUEST_CHANGES', 'REJECT'])
  decision!: 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT';
  /**
   * Justificación de la firma (ISO 27002 8.32): obligatoria en las tres decisiones. Antes sólo la
   * exigía el portal; una llamada directa a la API podía aprobar sin dejar ni una palabra. Se
   * recorta antes de validar para que un comentario de espacios no cuente.
   */
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El comentario de la firma es obligatorio.' })
  @MinLength(APPROVAL_COMMENT_MIN_LENGTH, {
    message: `El comentario de la firma debe tener al menos ${APPROVAL_COMMENT_MIN_LENGTH} caracteres.`,
  })
  @MaxLength(APPROVAL_COMMENT_MAX_LENGTH)
  comments!: string;
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
