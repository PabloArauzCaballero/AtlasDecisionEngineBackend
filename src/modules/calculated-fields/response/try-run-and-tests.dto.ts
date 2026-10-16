import { ApiProperty } from '@nestjs/swagger';

/** `CalculatedFieldExecutorService.execute`, envuelto por `tryRun`. */
export class CalculatedFieldTryRunDto {
  /**
   * Retorno del campo. Sin `type`: un campo calculado declara su propio `dataType`, así que
   * este valor puede ser número, texto, booleano o fecha. Swagger infiere `object` de
   * `unknown`, y eso haría que el contrato prometiera un objeto donde llega un número — el
   * ejemplo `0.42` contradecía su propio esquema y Redocly lo rechazaba con razón.
   */
  @ApiProperty({
    example: 0.42,
    description:
      'Valor devuelto; su tipo es el `dataType` declarado en el contrato de retorno. Es `null` cuando la política de nulos lo produce.',
    // La nulabilidad va DENTRO de cada rama y no como `nullable` hermano: en OpenAPI 3.0
    // `nullable` exige un `type` al lado, y aquí no hay uno solo — el retorno puede ser
    // número, texto, booleano, objeto o lista según el contrato del campo.
    oneOf: [
      { type: 'number', nullable: true },
      { type: 'string', nullable: true },
      { type: 'boolean', nullable: true },
      { type: 'object', nullable: true },
      { type: 'array', items: {}, nullable: true },
    ],
  })
  value!: unknown;
  @ApiProperty({ example: 'VALID', enum: ['VALID', 'NULL_BY_POLICY', 'DEFAULTED'] })
  outcome!: string;
  @ApiProperty({ example: 3 }) durationMs!: number;
  @ApiProperty({ example: 'DEBT_TO_INCOME' }) fieldCode!: string;
}

export class CalculatedFieldTestResultDto {
  @ApiProperty({ example: 'Approves a mid-range DTI' }) name!: string;
  @ApiProperty({ example: true }) passed!: boolean;
  @ApiProperty({ nullable: true }) actual?: unknown;
  @ApiProperty({ nullable: true }) expected?: unknown;
}

/** `CalculatedFieldTestingService.runTestCases`. */
export class CalculatedFieldTestReportDto {
  @ApiProperty({ example: 5 }) total!: number;
  @ApiProperty({ example: 5 }) passed!: number;
  @ApiProperty({ example: 0 }) failed!: number;
  @ApiProperty({ type: [CalculatedFieldTestResultDto] }) results!: CalculatedFieldTestResultDto[];
}

/** `CalculatedFieldPreviewService.tryRun`: el mismo ensayo, sobre algo que aún no existe. */
export class CalculatedFieldPreviewTryRunDto extends CalculatedFieldTryRunDto {
  @ApiProperty({
    example: false,
    description: 'Siempre `false`: un ensayo no crea campo, ni versión, ni caso de prueba.',
  })
  persisted!: boolean;
}
