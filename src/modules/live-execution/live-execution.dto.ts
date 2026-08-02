import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Bounded query contract for a management-only live decision preview. */
export class LiveExecutionStreamQueryDto {
  @IsString() @MaxLength(100) artifactCode!: string;
  @IsIn(['SANDBOX', 'TEST', 'PROD']) environmentCode!: 'SANDBOX' | 'TEST' | 'PROD';
  @IsString()
  @MaxLength(120)
  @Matches(/^[A-Za-z0-9._:-]{8,120}$/)
  requestId!: string;
  /** JSON-encoded input variables, e.g. `?variables=%7B%22age%22%3A30%7D`. */
  @IsString() @MaxLength(16_384) variables!: string;
  @IsOptional() @IsString() @MaxLength(200) subjectReference?: string;
}
