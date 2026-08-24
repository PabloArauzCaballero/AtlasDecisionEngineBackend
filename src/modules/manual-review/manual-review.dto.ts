/** Manual-review commands constrain assignment, outcome and evidence to auditable shapes. */
import { IsEnum, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { ManualReviewStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/http/pagination';

export class AssignManualReviewDto {
  /*
   * Opcional: sin el, el caso queda a nombre de quien lo toma.
   *
   * Era obligatorio, asi que «Asignarmelo» —el gesto normal de un analista, que no nombra a nadie
   * porque se nombra a si mismo— moria en un 400 «assignedTo must be a string». El caso no se podia
   * tomar desde la pantalla, y sin tomarlo no se puede resolver: la cola entera era inoperable.
   *
   * Se mantiene para que un supervisor pueda asignar el caso a OTRO analista.
   */
  @IsOptional() @IsString() @MaxLength(160) assignedTo?: string;
}

export class ResolveManualReviewDto {
  @IsIn(['APPROVE', 'DECLINE', 'CANCEL']) decision!: 'APPROVE' | 'DECLINE' | 'CANCEL';
  @IsString() @MaxLength(8_000) reason!: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class ManualReviewListQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(ManualReviewStatus) status?: ManualReviewStatus;
  @IsOptional() @IsString() @MaxLength(160) assignedTo?: string;
  @IsOptional() @IsString() @MaxLength(80) queueCode?: string;
}
