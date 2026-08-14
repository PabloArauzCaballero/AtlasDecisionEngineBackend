import { ApiProperty } from '@nestjs/swagger';

export class MonitoringWriteResultDto {
  @ApiProperty({ example: 250 }) recorded!: number;
}

class SubjectCoverageDto {
  @ApiProperty({ example: 18420 }) executions!: number;
  @ApiProperty({
    example: 310,
    description: 'Decisiones que DECLARAN no tener sujeto. Salen del denominador, no restan.',
  })
  notApplicable!: number;
  @ApiProperty({ example: 18110 }) eligible!: number;
  @ApiProperty({ example: 17994 }) withSubject!: number;
  @ApiProperty({
    example: 116,
    description:
      'Decisiones irreparables: el HMAC es de una vía y el sujeto ya no se puede añadir.',
  })
  missing!: number;
  @ApiProperty({
    nullable: true,
    example: 0.993596,
    description: 'Nulo, no cero, cuando no hubo decisiones: un 0 % sobre nada es alarma falsa.',
  })
  coverageRatio!: number | null;
}

class OutcomeCoverageDto {
  @ApiProperty({ example: 4210, description: 'Ventanas ya vencidas. Las abiertas no son deuda.' })
  dueWindows!: number;
  @ApiProperty({ example: 3980 }) observedWindows!: number;
  @ApiProperty({ example: 230 }) overdueWindows!: number;
  @ApiProperty({
    example: 412,
    description: 'De las observadas, cuántas se infirieron en vez de observarse.',
  })
  inferredWindows!: number;
  @ApiProperty({ nullable: true, example: 0.945368 }) coverageRatio!: number | null;
}

class CoverageDayDto {
  @ApiProperty({ example: '2026-08-01' }) day!: string;
  @ApiProperty({ example: 612 }) executions!: number;
  @ApiProperty({ example: 610 }) withSubject!: number;
}

/**
 * Estado del circuito de la decisión.
 *
 * Los dos ratios llegan con su numerador Y su denominador, no solos: un 100 % sobre tres
 * decisiones no es una noticia, y la pantalla no puede distinguirlo de un 100 % sobre veinte
 * mil si sólo recibe el porcentaje.
 */
export class DecisionCoverageDto {
  @ApiProperty({ example: '2026-07-12T00:00:00.000Z' }) from!: string;
  @ApiProperty({ example: '2026-08-11T00:00:00.000Z' }) to!: string;
  @ApiProperty({ type: SubjectCoverageDto }) subject!: SubjectCoverageDto;
  @ApiProperty({ type: OutcomeCoverageDto }) outcome!: OutcomeCoverageDto;
  @ApiProperty({ type: [CoverageDayDto] }) daily!: CoverageDayDto[];
}

export class PerformanceReportDto {
  @ApiProperty({ example: '4001' }) artifactVersionId!: string;
  @ApiProperty({ example: 1200 }) observed!: number;
  @ApiProperty({
    example: 940,
    description: 'Con desenlace conocido. Es el denominador de todo lo demás.',
  })
  conclusive!: number;
  @ApiProperty({ example: 700 }) approved!: number;
  @ApiProperty({ example: 240 }) declined!: number;
  @ApiProperty({ nullable: true, example: 0.042, description: 'Aprobados que salieron mal.' })
  badRate!: number | null;
  @ApiProperty({ nullable: true, example: 0.958 }) goodRate!: number | null;
  @ApiProperty({
    nullable: true,
    example: 0.11,
    description:
      'Rechazados que se habrían comportado bien. Detecta el modelo que se volvió demasiado ' +
      'restrictivo, cuyos malos no aparecen porque nunca entraron.',
  })
  falseDeclineRate!: number | null;
  @ApiProperty({
    nullable: true,
    example: 0.62,
    description:
      'Separación normalizada entre la puntuación media de buenos y malos (0 a 1). Sirve para ' +
      'ver una tendencia, no como poder discriminante publicable.',
  })
  discrimination!: number | null;
}

class StabilityBucketDto {
  @ApiProperty({ example: 'n:9' }) bucket!: string;
  @ApiProperty({ example: 0.32 }) referenceShare!: number;
  @ApiProperty({ example: 0.11 }) currentShare!: number;
  @ApiProperty({ example: 0.23 }) contribution!: number;
}

export class StabilityReportDto {
  @ApiProperty({ example: '4001' }) artifactVersionId!: string;
  @ApiProperty({ example: 'ingresos_mensuales' }) variableCode!: string;
  @ApiProperty({ example: 0.31 }) psi!: number;
  @ApiProperty({
    enum: ['STABLE', 'SHIFTED', 'UNSTABLE'],
    description: 'Cortes de uso corriente: < 0.10 estable, < 0.25 desplazada, resto inestable.',
  })
  verdict!: string;
  @ApiProperty({ example: 5_000 }) referenceCount!: number;
  @ApiProperty({ example: 4_800 }) currentCount!: number;
  @ApiProperty({
    type: [StabilityBucketDto],
    description: 'Ordenadas por aportación: la primera explica el desplazamiento.',
  })
  buckets!: StabilityBucketDto[];
}

class AdverseImpactGroupDto {
  @ApiProperty({ example: '60+' }) group!: string;
  @ApiProperty({ example: 420 }) total!: number;
  @ApiProperty({ example: 210 }) approved!: number;
  @ApiProperty({ example: 0.5 }) approvalRate!: number;
  @ApiProperty({ example: 0.625 }) impactRatio!: number;
  @ApiProperty({ example: true, description: 'Por debajo de 0.8: exige explicación.' })
  belowThreshold!: boolean;
}

export class AdverseImpactReportDto {
  @ApiProperty({ example: '4001' }) artifactVersionId!: string;
  @ApiProperty({ example: 'AGE_BAND' }) attribute!: string;
  @ApiProperty({ example: 1_500 }) analyzed!: number;
  @ApiProperty({
    nullable: true,
    example: '26-40',
    description: 'Grupo de mayor tasa de aprobación; es el denominador de la razón.',
  })
  referenceGroup!: string | null;
  @ApiProperty({
    type: [String],
    example: ['18-25'],
    description: 'Grupos por debajo de 30 casos: excluidos porque su razón sería ruido.',
  })
  ignoredForSmallSample!: string[];
  @ApiProperty({ type: [AdverseImpactGroupDto] }) groups!: AdverseImpactGroupDto[];
  @ApiProperty({
    example: true,
    description:
      'Algún grupo con muestra suficiente cae por debajo de 0.8. NO es una conclusión de ' +
      'discriminación: obliga a buscar y documentar la explicación de negocio.',
  })
  flagged!: boolean;
}
