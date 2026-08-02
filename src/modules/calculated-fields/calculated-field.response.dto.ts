import { ApiProperty } from '@nestjs/swagger';

class OperationArgumentDto {
  @ApiProperty({ example: 'a' })
  name!: string;

  @ApiProperty({
    type: [String],
    example: ['INTEGER', 'DECIMAL'],
    description: 'Tipos admitidos. Vacío significa que acepta cualquier tipo.',
  })
  types!: string[];

  @ApiProperty({ example: true })
  required!: boolean;

  @ApiProperty({ example: 'Primer sumando' })
  description!: string;
}

class OperationDefinitionDto {
  @ApiProperty({ example: 'ADD' })
  id!: string;

  @ApiProperty({ example: 'Sumar' })
  label!: string;

  @ApiProperty({ example: 'MATH' })
  category!: string;

  @ApiProperty({ example: 'Suma dos o más números' })
  description!: string;

  @ApiProperty({ type: [OperationArgumentDto] })
  args!: OperationArgumentDto[];

  @ApiProperty({ example: 'DECIMAL', description: 'Tipo del valor devuelto.' })
  returns!: string;

  @ApiProperty({
    required: false,
    example: true,
    description: 'Aridad variable: admite N argumentos (SUM, MIN, MAX).',
  })
  variadic?: boolean;

  @ApiProperty({ example: 'ADD(1200, 300) = 1500' })
  example!: string;
}

/**
 * Catálogo del constructor visual.
 *
 * Es **cerrado** por diseño: el panel solo puede componer lo que aparece aquí. Se publica con
 * el máximo de líneas ejecutables porque es la misma cota que el guardián de código aplica al
 * guardar, y conocerla antes evita que un autor escriba algo que será rechazado.
 */
export class OperationCatalogDto {
  @ApiProperty({ type: [String], example: ['MATH', 'TEXT', 'DATE', 'LOGIC'] })
  categories!: string[];

  @ApiProperty({ type: [OperationDefinitionDto] })
  operations!: OperationDefinitionDto[];

  @ApiProperty({ example: 3, description: 'Máximo de líneas ejecutables de un campo calculado.' })
  maxExecutableLines!: number;
}

/** `CalculatedFieldService.list`: forma aplanada, una fila por campo con su última versión. */
export class CalculatedFieldListItemDto {
  @ApiProperty({ example: '6001' }) id!: string;
  @ApiProperty({ example: 'DEBT_TO_INCOME' }) fieldCode!: string;
  @ApiProperty({ example: 'Debt-to-income ratio' }) name!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty({ example: 'RISK_METRICS' }) category!: string;
  @ApiProperty({ example: 'risk-engineering' }) ownerTeam!: string;
  @ApiProperty({ example: true }) isActive!: boolean;
  @ApiProperty({ nullable: true, example: 2 }) latestVersion!: number | null;
  @ApiProperty({ nullable: true, example: 'PUBLISHED' }) status!: string | null;
  @ApiProperty({ nullable: true, example: 'OPERATION' }) implementationKind!: string | null;
  @ApiProperty({ nullable: true, example: 'DECIMAL' }) returnType!: string | null;
  @ApiProperty({ example: '2026-07-20T10:00:00.000Z' }) updatedAt!: string;
}

class CalculatedFieldLibraryRefDto {
  @ApiProperty({ example: '5001' }) id!: string;
  @ApiProperty({ example: 'finance-basics' }) logicalName!: string;
  @ApiProperty({ example: 'finance-basics' }) packageName!: string;
  @ApiProperty({ example: '1.0.0' }) version!: string;
  @ApiProperty({ example: 'JAVASCRIPT' }) language!: string;
  @ApiProperty({ example: 'FINANCE' }) category!: string;
}

class CalculatedFieldUsageDto {
  @ApiProperty({ example: 'CREDIT_LIMIT_V2' }) artifactCode!: string;
  @ApiProperty({ example: 'Credit limit assignment' }) artifactName!: string;
  @ApiProperty({ example: '4001' }) artifactVersionId!: string;
  @ApiProperty({ example: 3 }) versionNumber!: number;
  @ApiProperty({ example: '1.2.0' }) semanticVersion!: string;
  @ApiProperty({ example: 'DEPLOYED_TO_PROD' }) status!: string;
  @ApiProperty({ example: 'CALC_DTI' }) nodeKey!: string;
  @ApiProperty({ example: 'call_1' }) callKey!: string;
  @ApiProperty({ example: 'intermediate.debt_to_income_ratio' }) target!: string;
}

class CalculatedFieldTestCaseDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: 'Approves a mid-range DTI' }) name!: string;
  @ApiProperty() inputs!: Record<string, unknown>;
  @ApiProperty({ nullable: true }) expected!: unknown;
  @ApiProperty({ nullable: true }) expectedErrorCode!: string | null;
}

class CalculatedFieldVersionDetailDto {
  @ApiProperty({ example: '6101' }) id!: string;
  @ApiProperty({ example: 2 }) versionNumber!: number;
  @ApiProperty({ example: 'PUBLISHED' }) status!: string;
  @ApiProperty({ example: 'OPERATION', enum: ['OPERATION', 'JAVASCRIPT', 'PYTHON'] })
  implementationKind!: string;
  @ApiProperty() inputs!: unknown;
  @ApiProperty() returns!: unknown;
  @ApiProperty({ nullable: true }) comments!: unknown;
  @ApiProperty({
    nullable: true,
    description: 'Presente solo cuando `implementationKind` es `OPERATION`.',
  })
  operation!: unknown;
  @ApiProperty({
    nullable: true,
    description: 'Presente solo cuando `implementationKind` es JS o Python.',
  })
  sourceCode!: string | null;
  @ApiProperty({ example: 500 }) timeoutMs!: number;
  @ApiProperty({ example: 'REJECT' }) errorPolicy!: string;
  @ApiProperty({ nullable: true }) defaultValue!: unknown;
  @ApiProperty({ nullable: true, example: 'PROD' }) environment!: string | null;
  @ApiProperty({ example: 'a1b2c3...' }) contentHash!: string;
  @ApiProperty({ example: 'author@atlas.local' }) authorId!: string;
  @ApiProperty({ nullable: true }) reviewerId!: string | null;
  @ApiProperty({ nullable: true }) approverId!: string | null;
  @ApiProperty({ example: '2026-06-01T09:00:00.000Z' }) createdAt!: string;
  @ApiProperty({ nullable: true }) publishedAt!: string | null;
  @ApiProperty({ type: [CalculatedFieldLibraryRefDto] }) libraries!: CalculatedFieldLibraryRefDto[];
  @ApiProperty({ type: [CalculatedFieldUsageDto] }) usedBy!: CalculatedFieldUsageDto[];
  @ApiProperty({ type: [CalculatedFieldTestCaseDto] }) testCases!: CalculatedFieldTestCaseDto[];
}

/** `CalculatedFieldService.get`: campo con todas sus versiones y su evidencia de uso. */
export class CalculatedFieldDetailDto {
  @ApiProperty({ example: '6001' }) id!: string;
  @ApiProperty({ example: 'DEBT_TO_INCOME' }) fieldCode!: string;
  @ApiProperty({ example: 'Debt-to-income ratio' }) name!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty({ example: 'Standard risk metric used across credit products' }) rationale!: string;
  @ApiProperty({ example: 'RISK_METRICS' }) category!: string;
  @ApiProperty({ example: 'risk-engineering' }) ownerTeam!: string;
  @ApiProperty({ example: true }) isActive!: boolean;
  @ApiProperty({ type: [CalculatedFieldVersionDetailDto] })
  versions!: CalculatedFieldVersionDetailDto[];
}

/** `CalculatedFieldService.create`. */
export class CalculatedFieldCreatedDto {
  @ApiProperty({ example: '6001' }) id!: string;
  @ApiProperty({ example: 'DEBT_TO_INCOME' }) fieldCode!: string;
}

/** `CalculatedFieldService.createVersion`: proyección mínima; ver `get` para el detalle completo. */
export class CalculatedFieldVersionCreatedDto {
  @ApiProperty({ example: '6101' }) id!: string;
  @ApiProperty({ example: 2 }) versionNumber!: number;
  @ApiProperty({ example: 'DRAFT' }) status!: string;
}

/** `CalculatedFieldService.promote`. */
export class CalculatedFieldPromotedDto {
  @ApiProperty({ example: '6101' }) id!: string;
  @ApiProperty({ example: 'APPROVED' }) status!: string;
}

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

class CalculatedFieldTestResultDto {
  @ApiProperty({ example: 'Approves a mid-range DTI' }) name!: string;
  @ApiProperty({ example: true }) passed!: boolean;
  @ApiProperty({ nullable: true }) actual?: unknown;
  @ApiProperty({ nullable: true }) expected?: unknown;
}

/** `CalculatedFieldService.runTestCases`. */
export class CalculatedFieldTestReportDto {
  @ApiProperty({ example: 5 }) total!: number;
  @ApiProperty({ example: 5 }) passed!: number;
  @ApiProperty({ example: 0 }) failed!: number;
  @ApiProperty({ type: [CalculatedFieldTestResultDto] }) results!: CalculatedFieldTestResultDto[];
}
