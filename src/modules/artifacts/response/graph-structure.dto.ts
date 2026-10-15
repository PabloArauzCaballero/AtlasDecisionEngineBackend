import { ApiProperty } from '@nestjs/swagger';
import {
  CalculatedFieldCallSnapshotDto,
  GraphActionDto,
  GraphConditionDto,
  IntermediateVariableSnapshotDto,
  OutputContractFieldSnapshotDto,
  VariableContractDto,
} from './graph-contract.dto';

export class GraphNodeDto {
  @ApiProperty({ nullable: true }) id?: string;
  @ApiProperty({ example: 'CHECK_INCOME' }) key!: string;
  @ApiProperty({
    example: 'CONDITION',
    enum: [
      'START',
      'CONDITION',
      'SWITCH',
      'EXPRESSION',
      'DECISION_TABLE',
      'SCORE',
      'ACTION',
      'RESULT',
      'MANUAL_REVIEW',
      'WORKER',
      'END',
    ],
  })
  type!: string;
  @ApiProperty({ example: 'Check minimum income' }) label!: string;
  @ApiProperty() config!: Record<string, unknown>;
  @ApiProperty({ example: 320 }) x!: number;
  @ApiProperty({ example: 180 }) y!: number;
  @ApiProperty({ example: 2 }) order!: number;
  @ApiProperty({ example: false }) terminal!: boolean;
  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        order: { type: 'integer' },
        expected: { type: 'boolean' },
      },
    },
  })
  conditions!: Array<{ code: string; order: number; expected: boolean }>;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', properties: { code: { type: 'string' }, order: { type: 'integer' } } },
  })
  actions!: Array<{ code: string; order: number }>;
  @ApiProperty({ type: [CalculatedFieldCallSnapshotDto], required: false })
  calculatedFieldCalls?: CalculatedFieldCallSnapshotDto[];
}

export class GraphEdgeDto {
  @ApiProperty({ nullable: true }) id?: string;
  @ApiProperty({ example: 'CHECK_INCOME__TO__CHECK_BUREAU' }) key!: string;
  @ApiProperty({ example: 'CHECK_INCOME' }) from!: string;
  @ApiProperty({ example: 'CHECK_BUREAU' }) to!: string;
  @ApiProperty({ example: 'CONDITIONAL' }) type!: string;
  @ApiProperty({ example: 1 }) priority!: number;
  @ApiProperty({ example: false }) default!: boolean;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', properties: { code: { type: 'string' }, order: { type: 'integer' } } },
  })
  conditions!: Array<{ code: string; order: number }>;
}

/** `ArtifactGraphSnapshot` completo — ver `src/modules/graph/graph.types.ts`. */
export class ArtifactGraphSnapshotDto {
  @ApiProperty({
    example: {
      id: '4000',
      tenantId: '1200',
      code: 'CREDIT_LIMIT_V2',
      type: 'DECISION_TREE',
      name: 'Credit limit assignment',
      riskDomain: 'CREDIT_RISK',
    },
  })
  artifact!: {
    id: string;
    tenantId: string;
    code: string;
    type: string;
    name: string;
    riskDomain: string;
  };
  @ApiProperty({
    example: {
      id: '4001',
      number: 1,
      semanticVersion: '0.1.0',
      status: 'DRAFT',
      checksum: null,
      authoringNotes: null,
    },
  })
  version!: {
    id: string;
    number: number;
    semanticVersion: string;
    status: string;
    checksum?: string | null;
    authoringNotes?: string | null;
  };
  @ApiProperty({ type: [VariableContractDto] }) variables!: VariableContractDto[];
  @ApiProperty({ type: [IntermediateVariableSnapshotDto] })
  intermediates!: IntermediateVariableSnapshotDto[];
  @ApiProperty({ type: [OutputContractFieldSnapshotDto] })
  outputContract!: OutputContractFieldSnapshotDto[];
  @ApiProperty({ type: [GraphConditionDto] }) conditions!: GraphConditionDto[];
  @ApiProperty({ type: [GraphActionDto] }) actions!: GraphActionDto[];
  @ApiProperty({ type: [GraphNodeDto] }) nodes!: GraphNodeDto[];
  @ApiProperty({ type: [GraphEdgeDto] }) edges!: GraphEdgeDto[];
}
