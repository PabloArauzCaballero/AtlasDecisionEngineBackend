/** Bounded decision request contract; caller input remains separate from engine-produced outputs. */
import { IsNotEmpty, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class ExecuteDecisionDto {
  @IsString() @IsNotEmpty() @MaxLength(120) requestId!: string;
  @IsOptional() @IsString() @MaxLength(120) correlationId?: string;
  @IsString() @IsNotEmpty() @MaxLength(160) idempotencyKey!: string;
  @IsOptional() @IsString() @MaxLength(200) subjectReference?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z0-9_\-]{2,40}$/) environmentCode?: string;
  @IsObject() variables!: Record<string, unknown>;
  @IsOptional() @IsObject() context?: Record<string, unknown>;
}
