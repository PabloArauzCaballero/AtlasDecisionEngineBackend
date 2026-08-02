import { ApiProperty } from '@nestjs/swagger';

class PreludeFunctionsDto {
  @ApiProperty({
    type: [String],
    example: ['npv', 'irr'],
    description: 'Funciones que el prelude expone dentro del sandbox.',
  })
  functions!: string[];
}

/**
 * Implementación revisada que una librería del registro puede habilitar.
 *
 * Se declara con su forma real porque el panel la usa para decidir qué se puede aprobar: una
 * fila del registro **solo habilita** un prelude ya presente aquí; nunca aporta código. Un
 * lenguaje sin implementación viaja como `null`, que es distinto de una lista vacía.
 */
export class PreludeDto {
  @ApiProperty({ example: 'finance-basics' })
  packageName!: string;

  @ApiProperty({
    type: PreludeFunctionsDto,
    nullable: true,
    description: '`null` cuando no hay implementación para JavaScript.',
  })
  javascript!: PreludeFunctionsDto | null;

  @ApiProperty({
    type: PreludeFunctionsDto,
    nullable: true,
    description: '`null` cuando no hay implementación para Python.',
  })
  python!: PreludeFunctionsDto | null;
}

/** Fila real de `decision_approved_library`, sin `tenantId`; ver `LibraryService.present`. */
export class ApprovedLibraryDto {
  @ApiProperty({ example: '5001' }) id!: string;
  @ApiProperty({ example: 'finance' }) logicalName!: string;
  @ApiProperty({ example: 'finance-basics' }) packageName!: string;
  @ApiProperty({ example: '1.0.0' }) version!: string;
  @ApiProperty({ example: 'JAVASCRIPT', enum: ['OPERATION', 'JAVASCRIPT', 'PYTHON'] })
  language!: string;
  @ApiProperty({ example: 'FINANCE' }) category!: string;
  @ApiProperty({ example: 'Financial calculations: NPV, IRR, amortization' }) description!: string;
  @ApiProperty({ nullable: true }) documentationUrl!: string | null;
  @ApiProperty({ type: [String], example: ['npv', 'irr'] }) allowedFunctions!: string[];
  @ApiProperty({ type: [String], example: [] }) blockedFunctions!: string[];
  @ApiProperty({ type: [String], example: ['PROD', 'UAT'] }) allowedEnvironments!: string[];
  @ApiProperty({ example: 'APPROVED', enum: ['APPROVED', 'DEPRECATED', 'BLOCKED'] })
  status!: string;
  @ApiProperty({ nullable: true }) knownRisks!: string | null;
  @ApiProperty({ nullable: true }) integrityHash!: string | null;
  @ApiProperty({ example: 'PINNED' }) updatePolicy!: string;
  @ApiProperty({ nullable: true }) reviewedAt!: string | null;
  @ApiProperty({ nullable: true }) reviewedBy!: string | null;
  @ApiProperty({ example: '2026-01-10T09:00:00.000Z' }) createdAt!: string;
  @ApiProperty({ example: '2026-01-10T09:00:00.000Z' }) updatedAt!: string;
}
