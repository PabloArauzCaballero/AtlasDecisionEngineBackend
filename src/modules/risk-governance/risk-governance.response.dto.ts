import { ApiProperty } from '@nestjs/swagger';

/** Respuesta común de las escrituras de gobierno: identidad y poco más. */
export class GovernanceWriteResultDto {
  @ApiProperty({ example: '31' }) id!: string;
}

class ExposureLimitDto {
  @ApiProperty({ example: '4' }) id!: string;
  @ApiProperty({ example: 'SUBJECT_TOTAL' }) limitCode!: string;
  @ApiProperty({ nullable: true, example: 'MICROCREDITO_URBANO' }) segment!: string | null;
  @ApiProperty({ example: 12000 }) maxValue!: number;
  @ApiProperty({ example: 'BOB' }) currencyCode!: string;
  @ApiProperty({
    example: false,
    description:
      'Falso mide y avisa sin rechazar: así se estrena un límite sin parar la originación.',
  })
  enforced!: boolean;
  @ApiProperty({ example: 9600, description: 'Lo consumido según el último estado reportado.' })
  currentValue!: number;
  @ApiProperty({
    example: 0.8,
    description: 'Proporción consumida. Sirve para avisar antes de topar.',
  })
  utilization!: number;
  @ApiProperty({ example: false }) exceeded!: boolean;
  @ApiProperty({ example: false }) blocking!: boolean;
}

export class ExposureLimitListDto {
  @ApiProperty({ type: [ExposureLimitDto] }) items!: ExposureLimitDto[];
}

class ConsentDto {
  @ApiProperty({ example: '12' }) id!: string;
  @ApiProperty({ example: 'BANK_STATEMENT_ANALYSIS' }) purpose!: string;
  @ApiProperty({ example: 'CONSENT' }) basis!: string;
  @ApiProperty({ example: '2026-01-15T00:00:00.000Z' }) grantedAt!: string;
  @ApiProperty({ nullable: true, example: '2027-01-15T00:00:00.000Z' }) expiresAt!: string | null;
  @ApiProperty({ nullable: true }) revokedAt!: string | null;
  @ApiProperty({ example: true }) valid!: boolean;
  @ApiProperty({
    example: 'EXPIRED',
    description:
      'VALID, MISSING, REVOKED, EXPIRED o NOT_YET_GRANTED. Se distinguen porque quien atiende ' +
      'necesita saber si lo renueva o si ya no puede volver a pedirlo igual.',
  })
  reason!: string;
  @ApiProperty({ nullable: true, example: 156 }) daysRemaining!: number | null;
}

export class ConsentListDto {
  @ApiProperty({ type: [ConsentDto] }) items!: ConsentDto[];
}

class ReidentificationDto {
  @ApiProperty({ example: '7' }) id!: string;
  @ApiProperty({ example: '91' }) subjectId!: string;
  @ApiProperty({ example: 'Reclamo 4471: hay que contactar al titular.' }) purpose!: string;
  @ApiProperty({ example: 'APPROVED' }) status!: string;
  @ApiProperty({ example: 'ana@atlas' }) requestedBy!: string;
  @ApiProperty({ example: '2026-08-12T09:00:00.000Z' }) requestedAt!: string;
  @ApiProperty({ nullable: true, example: 'luis@atlas' }) decidedBy!: string | null;
  @ApiProperty({ nullable: true }) decidedAt!: string | null;
}

export class ReidentificationListDto {
  @ApiProperty({ type: [ReidentificationDto] }) items!: ReidentificationDto[];
}

class CalibrationBucketDto {
  @ApiProperty({ example: 7 }) decile!: number;
  @ApiProperty({ example: 0.061 }) predictedRate!: number;
  @ApiProperty({ example: 0.092 }) observedRate!: number;
  @ApiProperty({ example: 412 }) sampleSize!: number;
}

/**
 * La curva y sus dos estadísticos.
 *
 * Se devuelven juntas la calibración y la discriminación porque responden a preguntas distintas y
 * se confunden: un modelo puede ordenar perfectamente (AUC alto) y estar descalibrado por un
 * factor de tres. Verlas separadas es lo que impide concluir «va bien» de la mitad del cuadro.
 */
export class CalibrationReportDto {
  @ApiProperty({ example: '4001' }) artifactVersionId!: string;
  @ApiProperty({ example: 90 }) windowDays!: number;
  @ApiProperty({
    example: 4120,
    description: 'Casos con predicción y desenlace OBSERVADO (no inferido).',
  })
  analyzed!: number;
  @ApiProperty({ type: [CalibrationBucketDto] }) buckets!: CalibrationBucketDto[];
  @ApiProperty({
    nullable: true,
    example: 12.4,
    description: 'Hosmer-Lemeshow. Mayor es peor; > 15,5 rechaza el buen ajuste al 95 %.',
  })
  hosmerLemeshow!: number | null;
  @ApiProperty({
    nullable: true,
    example: -0.018,
    description: 'Predicho medio menos observado medio. Positivo = el modelo es pesimista.',
  })
  meanBias!: number | null;
}
