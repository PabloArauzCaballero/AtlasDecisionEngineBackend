import { IsNotEmpty, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Input accepted by the management-only, non-persistent decision simulator. */
export class SimulateDecisionDto {
  @IsString() @IsNotEmpty() @MaxLength(120) requestId!: string;
  @IsString() @Matches(/^[A-Z0-9_\-]{2,40}$/) environmentCode!: string;
  @IsObject() variables!: Record<string, unknown>;
  @IsOptional() @IsObject() context?: Record<string, unknown>;
}
