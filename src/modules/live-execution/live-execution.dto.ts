import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class LiveExecutionStreamQueryDto {
  @IsString() @MaxLength(100) artifactCode!: string;
  @IsIn(['SANDBOX', 'TEST', 'PROD']) environmentCode!: 'SANDBOX' | 'TEST' | 'PROD';
  @IsString() requestId!: string;
  /** JSON-encoded input variables, e.g. `?variables=%7B%22age%22%3A30%7D`. */
  @IsString() @MaxLength(16_384) variables!: string;
  @IsOptional() @IsString() subjectReference?: string;
}
