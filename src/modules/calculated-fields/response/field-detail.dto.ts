import { ApiProperty } from '@nestjs/swagger';

/** `CalculatedFieldCatalogService.list`: forma aplanada, una fila por campo con su última versión. */
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

export class CalculatedFieldLibraryRefDto {
  @ApiProperty({ example: '5001' }) id!: string;
  @ApiProperty({ example: 'finance-basics' }) logicalName!: string;
  @ApiProperty({ example: 'finance-basics' }) packageName!: string;
  @ApiProperty({ example: '1.0.0' }) version!: string;
  @ApiProperty({ example: 'JAVASCRIPT' }) language!: string;
  @ApiProperty({ example: 'FINANCE' }) category!: string;
}

export class CalculatedFieldUsageDto {
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

export class CalculatedFieldTestCaseDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: 'Approves a mid-range DTI' }) name!: string;
  @ApiProperty() inputs!: Record<string, unknown>;
  @ApiProperty({ nullable: true }) expected!: unknown;
  @ApiProperty({ nullable: true }) expectedErrorCode!: string | null;
}

export class CalculatedFieldVersionDetailDto {
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

/** `CalculatedFieldCatalogService.get`: campo con todas sus versiones y su evidencia de uso. */
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

/** `CalculatedFieldCatalogService.create`. */
export class CalculatedFieldCreatedDto {
  @ApiProperty({ example: '6001' }) id!: string;
  @ApiProperty({ example: 'DEBT_TO_INCOME' }) fieldCode!: string;
}

/** `CalculatedFieldVersionService.createVersion`: proyección mínima; ver `get` para el detalle completo. */
export class CalculatedFieldVersionCreatedDto {
  @ApiProperty({ example: '6101' }) id!: string;
  @ApiProperty({ example: 2 }) versionNumber!: number;
  @ApiProperty({ example: 'DRAFT' }) status!: string;
}

/** `CalculatedFieldVersionService.promote`. */
export class CalculatedFieldPromotedDto {
  @ApiProperty({ example: '6101' }) id!: string;
  @ApiProperty({ example: 'APPROVED' }) status!: string;
}
