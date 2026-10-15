import { ApiProperty } from '@nestjs/swagger';

// --- Snapshot del grafo (ver src/modules/graph/graph.types.ts) ---

export class VariableContractDto {
  @ApiProperty({ example: '3001' }) variableVersionId!: string;
  @ApiProperty({ nullable: true, example: 'INPUT' }) usageType?: string;
  @ApiProperty({ nullable: true }) dependencyPath?: string;
  @ApiProperty({ example: 'applicant_income' }) code!: string;
  @ApiProperty({ example: 3 }) version!: number;
  @ApiProperty({ example: 'DECIMAL' }) dataType!: string;
  @ApiProperty({ nullable: true, example: 'USD' }) unitCode?: string | null;
  @ApiProperty({ example: false }) nullable!: boolean;
  @ApiProperty({ nullable: true }) defaultValue?: unknown;
  @ApiProperty({ nullable: true }) validationSchema?: unknown;
  @ApiProperty({ nullable: true, description: 'Restricciones normalizadas (§1.1); autoritativas.' })
  constraints?: unknown;
  @ApiProperty({ nullable: true }) displayName?: string | null;
  @ApiProperty({ nullable: true }) description?: string | null;
  @ApiProperty({ nullable: true }) validationMessage?: string | null;
  @ApiProperty({ nullable: true }) exampleValid?: unknown;
  @ApiProperty({ nullable: true }) exampleInvalid?: unknown;
  @ApiProperty({ nullable: true, example: 'PROVIDER' }) expectedOrigin?: string;
  @ApiProperty({ nullable: true, example: '1.0' }) contractVersion?: string;
  @ApiProperty({ nullable: true, example: 'PII' }) sensitivityClass?: string;
  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        ruleType: { type: 'string' },
        config: {},
        severity: { type: 'string' },
        errorCode: { type: 'string' },
      },
    },
  })
  validationRules!: Array<{
    ruleType: string;
    config: unknown;
    severity: string;
    errorCode: string;
  }>;
  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        system: { type: 'string' },
        path: { type: 'string' },
        field: { type: 'string' },
        precedence: { type: 'integer' },
        freshnessSlaSeconds: { type: 'integer' },
        authoritative: { type: 'boolean' },
      },
    },
  })
  sources!: Array<{
    system: string;
    path: string;
    field: string;
    precedence: number;
    freshnessSlaSeconds: number;
    authoritative: boolean;
  }>;
  @ApiProperty({ example: true }) required!: boolean;
  @ApiProperty({ example: 'REJECT' }) fallbackPolicy!: string;
  @ApiProperty({ example: false }) sensitive!: boolean;
}

export class IntermediateVariableSnapshotDto {
  @ApiProperty({ nullable: true }) id?: string;
  @ApiProperty({ example: 'debt_to_income_ratio' }) code!: string;
  @ApiProperty({ example: 'Debt-to-income ratio' }) name!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ example: 'DECIMAL' }) dataType!: string;
  @ApiProperty({ example: 'CALC_DTI' }) producerNodeKey!: string;
  @ApiProperty({ type: [String] }) consumerNodeKeys!: string[];
  @ApiProperty({ nullable: true }) initialValue?: unknown;
  @ApiProperty({ nullable: true }) constraints?: unknown;
  @ApiProperty({ example: false }) nullable!: boolean;
  @ApiProperty({ enum: ['SINGLE_WRITE', 'OVERWRITE', 'ACCUMULATE'] }) updatePolicy!: string;
  @ApiProperty({ nullable: true }) availabilityCondition?: unknown;
  @ApiProperty({ example: 'INTERNAL' }) sensitivityClass!: string;
  @ApiProperty({ enum: ['FULL', 'MASKED', 'REDACTED', 'EXCLUDED'] }) tracePolicy!: string;
}

export class OutputContractFieldSnapshotDto {
  @ApiProperty({ nullable: true }) id?: string;
  @ApiProperty({ example: 'approved_limit' }) code!: string;
  @ApiProperty({ example: 'Approved credit limit' }) name!: string;
  @ApiProperty({ nullable: true }) description?: string | null;
  @ApiProperty({ enum: ['NODE', 'EXPRESSION', 'INTERMEDIATE', 'CONSTANT', 'REFERENCE'] })
  sourceKind!: string;
  @ApiProperty({ example: 'RESULT_NODE:limit' }) sourceRef!: string;
  @ApiProperty({ nullable: true }) valueMapping?: Record<string, unknown> | null;
  @ApiProperty({ type: [String] }) absenceReasons!: string[];
  @ApiProperty({
    type: [String],
    example: ['DTI_TOO_HIGH'],
    description: 'Motivos estructurados del catálogo que pueden devolverse con el campo (§4).',
  })
  reasonCodes!: string[];
  @ApiProperty({ nullable: true }) example?: unknown;
  @ApiProperty({ example: '1.0' }) contractVersion!: string;
  @ApiProperty({ example: 'INTERNAL' }) sensitivityClass!: string;
  @ApiProperty({ enum: ['FULL', 'MASKED', 'REDACTED', 'EXCLUDED'] }) tracePolicy!: string;
  @ApiProperty({
    enum: [
      'NONE',
      'PROBABILITY_OF_DEFAULT',
      'LOSS_GIVEN_DEFAULT',
      'EXPOSURE_AT_DEFAULT',
      'EXPECTED_LOSS',
      'RISK_GRADE',
      'PRICED_RATE',
      'APPROVED_LIMIT',
      'APPROVED_TERM',
    ],
    example: 'PROBABILITY_OF_DEFAULT',
    description:
      'Qué representa el campo en términos de riesgo. Un artefacto de originación necesita declarar ' +
      'su PROBABILITY_OF_DEFAULT para poder desplegarse en producción.',
  })
  semanticRole!: string;
  @ApiProperty({
    nullable: true,
    example: 0.18,
    description: 'Suelo que la política admite para el campo; fuera de él la decisión no autoriza.',
  })
  policyMinValue!: number | null;
  @ApiProperty({
    nullable: true,
    example: 0.45,
    description: 'Techo que la política admite para el campo; fuera de él la decisión no autoriza.',
  })
  policyMaxValue!: number | null;
}

export class GraphConditionDto {
  @ApiProperty({ nullable: true }) id?: string;
  @ApiProperty({ example: 'HAS_SUFFICIENT_INCOME' }) code!: string;
  @ApiProperty({ example: 'Applicant has sufficient income' }) name!: string;
  @ApiProperty({ example: 'JSON_LOGIC' }) expressionType!: string;
  @ApiProperty() expression!: unknown;
  @ApiProperty({ example: 'BLOCKING' }) severity!: string;
  @ApiProperty({ example: true }) reusable!: boolean;
}

export class ReasonCodeDto {
  @ApiProperty({ nullable: true }) id?: string;
  @ApiProperty({ example: 'INSUFFICIENT_INCOME' }) code!: string;
  @ApiProperty({ example: 'ADVERSE_ACTION' }) category!: string;
  @ApiProperty({ example: 'Income does not meet the minimum required' }) publicMessage!: string;
  @ApiProperty({ example: 'DTI ratio 0.61 exceeds policy threshold 0.45' })
  internalMessage!: string;
  @ApiProperty({ example: 'HIGH' }) severity!: string;
  @ApiProperty({ example: true }) adverseAction!: boolean;
  @ApiProperty({ example: 1 }) priority!: number;
}

export class GraphActionDto {
  @ApiProperty({ nullable: true }) id?: string;
  @ApiProperty({ example: 'DENY_APPLICATION' }) code!: string;
  @ApiProperty({ example: 'DECLINE' }) type!: string;
  @ApiProperty() payload!: Record<string, unknown>;
  @ApiProperty({ example: true }) terminal!: boolean;
  @ApiProperty({ type: [ReasonCodeDto] }) reasonCodes!: ReasonCodeDto[];
}

export class CalculatedFieldCallSnapshotDto {
  @ApiProperty({ example: 'call_1' }) callKey!: string;
  @ApiProperty({ example: 'DEBT_TO_INCOME' }) fieldCode!: string;
  @ApiProperty({ example: '6001' }) calculatedFieldVersionId!: string;
  @ApiProperty({ example: 2 }) versionNumber!: number;
  @ApiProperty({ description: '`{ [inputId]: origen }`.' }) inputMapping!: Record<string, unknown>;
  @ApiProperty({
    example: { kind: 'INTERMEDIATE', code: 'debt_to_income_ratio' },
    description: '`{ kind: "INTERMEDIATE"|"OUTPUT", code }`.',
  })
  target!: { kind: string; code: string };
  @ApiProperty({
    description: 'Definición congelada, lista para ejecutarse sin tocar la base de datos.',
  })
  definition!: Record<string, unknown>;
}
