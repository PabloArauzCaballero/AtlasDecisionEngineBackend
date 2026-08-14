import { ApiProperty } from '@nestjs/swagger';

/**
 * El veredicto de UNA fila.
 *
 * Toda la ingesta devuelve esto y no un conteo. Un 200 con «1.998 aceptadas» deja al operador
 * sin saber cuáles fueron las dos que no, y la respuesta natural a eso es reenviar el archivo
 * entero y confiar en que cuele — que es como se acaban duplicando desenlaces.
 */
export class RowResultDto {
  @ApiProperty({ example: 'LOAN-2026-000841' }) externalReference!: string;
  @ApiProperty({ required: false, example: 90 }) windowDays?: number;
  @ApiProperty({ example: false }) accepted!: boolean;
  @ApiProperty({ required: false, example: 'FACILITY_NOT_FOUND' }) code?: string;
  @ApiProperty({ required: false }) message?: string;
}

export class FacilityRegistrationResultDto {
  @ApiProperty({ example: 812 }) registered!: number;
  @ApiProperty({ example: 3 }) rejected!: number;
  @ApiProperty({ type: [RowResultDto] }) rows!: RowResultDto[];
}

export class OutcomeBatchResultDto {
  @ApiProperty({ example: 1998 }) accepted!: number;
  @ApiProperty({ example: 2 }) rejected!: number;
  @ApiProperty({
    example: true,
    description: 'Si es cierto no se escribió nada: era una validación previa.',
  })
  dryRun!: boolean;
  @ApiProperty({ type: [RowResultDto] }) rows!: RowResultDto[];
}

class PendingWindowDto {
  @ApiProperty({ example: '5512' }) windowId!: string;
  @ApiProperty({ example: '88001' }) executionId!: string;
  @ApiProperty({ example: 90 }) windowDays!: number;
  @ApiProperty({ example: '2026-05-12T00:00:00.000Z' }) dueAt!: string;
  @ApiProperty({ example: '2026-02-11T00:00:00.000Z' }) decidedAt!: string;
  @ApiProperty({ example: 91, description: 'Días que lleva vencida. Ordena la cola.' })
  overdueDays!: number;
  @ApiProperty({ nullable: true, example: 'LOAN-2026-000841' })
  externalReference!: string | null;
  @ApiProperty({ example: 'MICROCREDIT_ORIGINATION' }) artifactCode!: string;
}

export class PendingWindowsDto {
  @ApiProperty({ example: 50 }) limit!: number;
  @ApiProperty({ type: [PendingWindowDto] }) items!: PendingWindowDto[];
}

class VintageCellDto {
  @ApiProperty({ example: '2026-03' }) cohort!: string;
  @ApiProperty({ example: 90 }) windowDays!: number;
  @ApiProperty({ example: 412, description: 'Créditos de esa cosecha con esa ventana programada.' })
  facilities!: number;
  @ApiProperty({ example: 398, description: 'De ellos, cuántos tienen desenlace. El denominador.' })
  observed!: number;
  @ApiProperty({ example: 21 }) bad!: number;
  @ApiProperty({ example: 4, description: 'Observaciones inferidas, no observadas. Se cuentan aparte.' })
  inferred!: number;
  @ApiProperty({
    nullable: true,
    example: 0.052764,
    description: 'Nulo sin observaciones: un 0 % sobre nada no es una cosecha buena, es vacía.',
  })
  badRate!: number | null;
  @ApiProperty({ example: 18400.5 }) badAmount!: number;
}

export class VintageMatrixDto {
  @ApiProperty({ example: '2025-08-11T00:00:00.000Z' }) from!: string;
  @ApiProperty({ example: '2026-08-11T00:00:00.000Z' }) to!: string;
  @ApiProperty({ type: [VintageCellDto] }) cells!: VintageCellDto[];
}
