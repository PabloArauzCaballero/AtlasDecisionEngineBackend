import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/http/pagination';

const LANGUAGES = ['OPERATION', 'JAVASCRIPT', 'PYTHON'] as const;
const STATUSES = ['APPROVED', 'RESTRICTED', 'BLOCKED'] as const;

export class LibraryQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsIn([...LANGUAGES]) language?: (typeof LANGUAGES)[number];
  @IsOptional() @IsIn([...STATUSES]) status?: (typeof STATUSES)[number];
  @IsOptional() @IsString() @MaxLength(60) category?: string;
  @IsOptional() @IsString() @MaxLength(40) environment?: string;
}

export class UpsertLibraryDto {
  @IsString() @Matches(/^[a-z][a-z0-9_-]{1,79}$/) logicalName!: string;
  /** Debe corresponder a un prelude implementado en `library-preludes.ts`. */
  @IsString() @MaxLength(160) packageName!: string;
  @IsString() @Matches(/^\d+\.\d+\.\d+$/) version!: string;
  @IsIn([...LANGUAGES]) language!: (typeof LANGUAGES)[number];
  @IsString() @MaxLength(60) category!: string;
  @IsString() @MaxLength(4_000) description!: string;
  @IsOptional() @IsString() @MaxLength(500) documentationUrl?: string;

  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  allowedFunctions!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  blockedFunctions?: string[];

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  allowedEnvironments!: string[];

  @IsOptional() @IsIn([...STATUSES]) status?: (typeof STATUSES)[number];
  @IsOptional() @IsString() @MaxLength(4_000) knownRisks?: string;
  @IsOptional() @IsString() @MaxLength(40) updatePolicy?: string;
}
