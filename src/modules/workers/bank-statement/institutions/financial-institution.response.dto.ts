import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { INSTITUTION_KINDS, LICENSE_STATUSES } from './financial-institution.dto';

/**
 * La entidad tal como sale del motor. No es la fila de Prisma: `id` y `tenantId`
 * no cruzan el borde —el código ASFI es la identidad pública— y las fechas
 * viajan en ISO.
 */
export class FinancialInstitutionDto {
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: INSTITUTION_KINDS }) kind!: string;
  @ApiProperty({ enum: LICENSE_STATUSES }) licenseStatus!: string;
  @ApiProperty() retailDeposits!: boolean;
  @ApiProperty({ type: [String] }) markers!: string[];
  @ApiProperty({ type: [String] }) exclusions!: string[];
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() updatedAt!: string;
  @ApiPropertyOptional({ nullable: true }) updatedBy!: string | null;
}

/**
 * Lo que el padrón dice de sí mismo.
 *
 * Existe porque la pantalla que administra 66 entidades necesita responder de un
 * vistazo la única pregunta que importa antes de tocar nada: **¿está el padrón
 * completo?** Un padrón al que le faltan entidades no da un error: hace que sus
 * extractos se rechacen uno a uno como «emisor no reconocido», que se lee como
 * un problema del documento.
 */
export class FinancialInstitutionSummaryDto {
  @ApiProperty({ description: 'Entidades activas en el padrón del tenant.' })
  active!: number;

  @ApiProperty({ description: 'Cuántas hay por tipo, con la clave del enum.' })
  byKind!: Record<string, number>;

  @ApiProperty({ description: 'Cuántas tienen la licencia no vigente.' })
  withoutLicense!: number;

  @ApiProperty({
    description:
      'Entidades de la nómina ASFI compilada que faltan en el padrón del tenant. Vacío es lo esperado.',
    type: [String],
  })
  missingFromSeed!: string[];
}

/**
 * Lo que dejó —o dejaría— una siembra de la nómina ASFI.
 *
 * `created` son siglas y no un número porque la pregunta que se hace antes de
 * sembrar no es «¿cuántas?» sino «¿cuáles?»: quien administra el padrón necesita
 * reconocer si lo que falta son las cooperativas nuevas o un banco.
 */
export class FinancialInstitutionSeedSummaryDto {
  @ApiProperty({ description: 'Entidades que trae la nómina ASFI compilada.' })
  total!: number;

  @ApiProperty({ description: 'Siglas creadas, o que se crearían con dryRun.', type: [String] })
  created!: string[];

  @ApiProperty({ description: 'Si fue un ensayo: nada se escribió.' })
  dryRun!: boolean;
}
