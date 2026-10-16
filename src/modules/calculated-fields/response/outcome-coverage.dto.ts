import { ApiProperty } from '@nestjs/swagger';

export class DeclaredOutcomeDto {
  @ApiProperty({
    example: 'ERROR:CALCULATION_FAILED',
    description:
      'VALID, NULL_BY_POLICY, DEFAULTED o ERROR:<código>. El código concreto viaja dentro porque no es lo mismo fallar por dato ausente que por rango.',
  })
  code!: string;

  @ApiProperty({ example: 'Falla con CALCULATION_FAILED' }) label!: string;

  @ApiProperty({
    example: 'la política ante división entre cero es fallar',
    description: 'Qué parte del contrato declara este desenlace.',
  })
  reason!: string;

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    example: 'no hay ningún valor por defecto declarado, así que el error se propaga',
    description:
      'Presente cuando el contrato declara el desenlace pero el motor no puede producirlo nunca.',
  })
  unreachable?: string;

  @ApiProperty({ example: true, description: '¿Lo alcanzó alguno de los casos ejecutados?' })
  covered!: boolean;
}

export class OutcomeCoverageCaseDto {
  @ApiProperty({ example: 0 }) index!: number;
  @ApiProperty({ example: 'BOUNDARY', enum: ['VALID', 'BOUNDARY', 'INVALID'] }) kind!: string;
  @ApiProperty({ required: false, nullable: true, type: String, example: 'BELOW_MIN' })
  mutation?: string;
  @ApiProperty({ example: { monthly_income: 1200, monthly_debt: 400 } })
  input!: Record<string, unknown>;
  @ApiProperty({ example: 'VALID' }) outcome!: string;
  @ApiProperty({
    required: false,
    example: 0.33,
    description: 'Valor devuelto; su tipo es el `dataType` del contrato de retorno.',
    oneOf: [
      { type: 'number', nullable: true },
      { type: 'string', nullable: true },
      { type: 'boolean', nullable: true },
      { type: 'object', nullable: true },
      { type: 'array', items: {}, nullable: true },
    ],
  })
  value?: unknown;
  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    example: 'La entrada x es menor que el mínimo',
  })
  error?: string;
  @ApiProperty({ example: 2 }) durationMs!: number;
}

/**
 * `CalculatedFieldPreviewService.coverageOf`: qué desenlaces del contrato se alcanzaron.
 *
 * Los NO alcanzados van en su propia lista porque son el dato que se viene a buscar: una
 * cobertura que sólo enseñara lo cubierto se leería como «probado todo».
 */
export class CalculatedFieldOutcomeCoverageReportDto {
  @ApiProperty({ example: 'a1b2c3', description: 'Repetirla reproduce exactamente esta tanda.' })
  seed!: string;
  @ApiProperty({ example: 3, description: 'Casos generados por clase; se corren las tres.' })
  countPerKind!: number;
  @ApiProperty({ example: 9 }) total!: number;
  @ApiProperty({ type: [DeclaredOutcomeDto] }) declared!: DeclaredOutcomeDto[];
  @ApiProperty({
    type: [String],
    example: ['ERROR:CALCULATED_FIELD_INPUT_INVALID'],
    description:
      'Desenlaces que ocurrieron sin estar declarados; casi siempre, entradas rechazadas.',
  })
  undeclared!: string[];
  @ApiProperty({ type: [String], example: ['DEFAULTED'] }) uncovered!: string[];
  @ApiProperty({ type: [OutcomeCoverageCaseDto] }) cases!: OutcomeCoverageCaseDto[];
}
