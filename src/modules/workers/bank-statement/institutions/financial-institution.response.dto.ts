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
  @ApiPropertyOptional({ nullable: true }) website!: string | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      'Descriptor de las señales esperadas en un extracto de esta entidad. `null` mientras no se haya calibrado: sin él, el parecido no se mide y no afecta a ningún desenlace.',
  })
  expectedSignals!: Record<string, unknown> | null;

  /*
   * El logotipo se anuncia, no se incrusta. Sesenta y ocho imágenes en base64
   * dentro del listado serían varios megabytes de JSON para pintar una tabla; la
   * imagen se pide por su propia ruta, que además el navegador cachea.
   */
  @ApiProperty({ description: 'Si la entidad tiene logotipo cargado.' })
  hasLogo!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'De dónde salió: DOWNLOADED del sitio oficial, GENERATED cuando el motor compuso un monograma con la sigla, UPLOADED cuando lo cargó una persona. Un monograma NO es la marca de la entidad y la pantalla debe decirlo.',
  })
  logoSource!: string | null;

  @ApiPropertyOptional({ nullable: true }) logoSourceUrl!: string | null;
  @ApiPropertyOptional({ nullable: true }) logoUpdatedAt!: string | null;

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

/**
 * Lo que dejó —o dejaría— una carga de logotipos.
 *
 * Publica por separado los DESCARGADOS y los GENERADOS porque son afirmaciones
 * distintas: quince entidades de la nómina publican un logotipo utilizable y las
 * demás llevan un monograma con su sigla. Enseñar sólo el total haría creer que
 * el padrón tiene sesenta y ocho marcas cargadas.
 */
export class InstitutionLogoSyncDto {
  @ApiProperty({ description: 'Logotipos que trae el motor.' })
  available!: number;

  @ApiProperty({ description: 'De ellos, descargados del sitio oficial de la entidad.' })
  downloaded!: number;

  @ApiProperty({ description: 'De ellos, monogramas compuestos con la sigla ASFI.' })
  generated!: number;

  @ApiProperty({ description: 'Siglas a las que se les cargó el logotipo.', type: [String] })
  applied!: string[];

  @ApiProperty({
    description:
      'De ellas, las que tenían un monograma y pasaron a llevar el logotipo oficial de la entidad.',
    type: [String],
  })
  upgraded!: string[];

  @ApiProperty({ description: 'Si fue un ensayo: nada se escribió.' })
  dryRun!: boolean;
}
