import { ApiProperty } from '@nestjs/swagger';

/** Forma real de `decision_reason_code`, tal como la devuelve Prisma. */
export class ReasonCodeCreatedDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: '1200' }) tenantId!: string;
  @ApiProperty({ example: 'INSUFFICIENT_INCOME' }) reasonCode!: string;
  @ApiProperty({ example: 'ADVERSE_ACTION' }) category!: string;
  @ApiProperty({ example: 'Income does not meet the minimum required' }) publicMessage!: string;
  @ApiProperty({ example: 'DTI ratio 0.61 exceeds policy threshold 0.45' })
  internalMessage!: string;
  @ApiProperty({ example: 'HIGH' }) severity!: string;
  @ApiProperty({ example: true }) isAdverseAction!: boolean;
  @ApiProperty({ example: true }) isActive!: boolean;
}

class VariableUsageRowDto {
  @ApiProperty({ example: 'CREDIT_LIMIT_V2' }) artifactCode!: string;
  @ApiProperty({ example: 'Credit limit assignment' }) artifactName!: string;
  @ApiProperty({ example: '4001' }) artifactVersionId!: string;
  @ApiProperty({ example: 3 }) artifactVersionNumber!: number;
  @ApiProperty({ example: '1.2.0' }) semanticVersion!: string;
  @ApiProperty({ example: 'DEPLOYED_TO_PROD' }) status!: string;
  @ApiProperty({ example: 'INPUT' }) usageType!: string;
  @ApiProperty({ example: true }) isRequired!: boolean;
  @ApiProperty({ example: 2 }) variableVersionNumber!: number;
}

/** `VariableService.dependencies`: qué artefactos usan una definición de variable. */
export class VariableDependenciesDto {
  @ApiProperty({ example: 8 }) total!: number;
  @ApiProperty({
    example: 3,
    description: 'De `total`, cuántos están desplegados a algún ambiente.',
  })
  deployed!: number;
  @ApiProperty({ type: [VariableUsageRowDto] }) items!: VariableUsageRowDto[];
}
