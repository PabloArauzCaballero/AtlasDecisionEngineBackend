/** Manual-review commands constrain assignment, outcome and evidence to auditable shapes. */
import { IsEnum, IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
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
   * Se mantiene para repartir el caso a OTRO analista; QUIÉN puede hacerlo lo decide el servicio,
   * no este DTO.
   *
   * `@MinLength(1)` porque la cadena vacía NO es lo mismo que omitir el campo: `''` sobrevive al
   * `??` del servicio y deja el caso asignado a nadie, y a partir de ahí `resolve()` responde «hay
   * que asignarlo primero» sobre un caso que la pantalla pinta como asignado. Omitido significa
   * «para mí»; vacío es un error del cliente y se le dice.
   */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) assignedTo?: string;
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
