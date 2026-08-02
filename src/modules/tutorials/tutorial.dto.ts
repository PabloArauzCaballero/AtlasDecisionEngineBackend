/** Progress updates constrain step and completion state while content stays client-owned. */
import { IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';

export class UpsertTutorialProgressDto {
  @IsIn(['STARTED', 'COMPLETED', 'SKIPPED'])
  status!: 'STARTED' | 'COMPLETED' | 'SKIPPED';

  @IsOptional() @IsInt() @Min(0) lastStep?: number;
  @IsOptional() @IsInt() @Min(1) version?: number;
  @IsOptional() @IsBoolean() autoShow?: boolean;
}
