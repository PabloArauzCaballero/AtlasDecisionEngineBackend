import { Injectable } from '@nestjs/common';
import { TestCaseRunStatus } from '@prisma/client';
import { ExecutionEngineService } from '../graph/execution-engine.service';
import type { CompiledDecisionArtifact } from '../graph/graph.types';
import { NestedTreeExecutionService } from '../nested-trees/nested-tree-execution.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { VariableResolutionService } from '../variables/variable-resolution.service';

/**
 * The async test-run worker has no per-request principal (it is not driven by an HTTP
 * call), but NestedTreeExecutionService.bind() only reads tenantId at execution time —
 * principal identity there is plumbing for future use, not an authorization check
 * (authoring RBAC for a reference is enforced once, at NestedTreeService create/update
 * time). This synthetic principal makes that explicit rather than fabricating a real user.
 */
function systemPrincipal(tenantId: bigint): AuthenticatedPrincipal {
  return {
    id: 'system:test-run-worker',
    tenantId,
    roles: [],
    audience: 'management',
    requestId: 'test-run-worker',
    authMethod: 'jwt',
  };
}

export interface TestAssertionResult {
  path: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
}

export interface TestCaseRecord {
  id: bigint;
  caseCode: string;
  inputJson: unknown;
  expectedResultJson: unknown;
}

export interface EvaluatedTestCase {
  testCaseId: bigint;
  actual?: Record<string, unknown>;
  error?: Record<string, unknown>;
  assertions: TestAssertionResult[];
  resultStatus: TestCaseRunStatus;
  durationMs: number;
  visitedNodeKeys: string[];
  traversedEdgeKeys: string[];
  terminalNodeKey?: string;
}

@Injectable()
export class TestCaseExecutorService {
  constructor(
    private readonly engine: ExecutionEngineService,
    private readonly variables: VariableResolutionService,
    private readonly nestedTrees: NestedTreeExecutionService,
  ) {}

  async execute(input: {
    tenantId: bigint;
    artifactCode: string;
    runId: bigint;
    payload: CompiledDecisionArtifact;
    testCase: TestCaseRecord;
  }): Promise<EvaluatedTestCase> {
    const { tenantId, artifactCode, runId, payload, testCase } = input;
    const started = performance.now();
    let actual: Record<string, unknown> | undefined;
    let error: Record<string, unknown> | undefined;
    let assertions: TestAssertionResult[] = [];
    let resultStatus: TestCaseRunStatus = TestCaseRunStatus.PASS;
    let visitedNodeKeys: string[] = [];
    let traversedEdgeKeys: string[] = [];
    let terminalNodeKey: string | undefined;

    try {
      const rawInput = this.asRecord(testCase.inputJson);
      const inputVariables = this.asRecord(rawInput.variables ?? rawInput);
      // Configurable outputs (RESULT nodes) are produced by the engine, never supplied
      // by the caller — resolving them as required input would always report them
      // "missing". RuntimeService/SimulationService already filter these the same way.
      const inputContracts = payload.variables.filter(
        (variable) => !String(variable.usageType ?? 'INPUT').startsWith('OUTPUT'),
      );
      const resolution = await this.variables.resolve(inputContracts, inputVariables, {
        tenantId,
        artifactCode,
        requestId: `test-${runId.toString()}-${testCase.caseCode}`,
        allowExternal: false,
      });

      if (!resolution.valid) {
        actual = { outcome: 'NO_DECISION', variableErrors: resolution.errors };
      } else {
        const result = await this.engine.execute(
          payload,
          resolution.values,
          this.nestedTrees.bind(tenantId, systemPrincipal(tenantId)),
        );
        visitedNodeKeys = result.visitedNodeKeys;
        traversedEdgeKeys = result.traversedEdgeKeys;
        terminalNodeKey = result.terminalNodeKey;
        actual = {
          ...result.output,
          outcome: result.outcome,
          primaryResult: result.primaryResult,
          reasons: result.reasons.map((reason) => reason.code),
          trace: {
            nodes: visitedNodeKeys,
            edges: traversedEdgeKeys,
            terminal: terminalNodeKey,
          },
        };
      }

      assertions = this.assertSubset(this.asRecord(testCase.expectedResultJson), actual);
      if (assertions.some((assertion) => !assertion.passed)) {
        resultStatus = TestCaseRunStatus.FAIL;
      }
    } catch (caught) {
      resultStatus = TestCaseRunStatus.ERROR;
      error = {
        message: caught instanceof Error ? caught.message : String(caught),
        name: caught instanceof Error ? caught.name : 'UnknownError',
      };
    }

    return {
      testCaseId: testCase.id,
      actual,
      error,
      assertions,
      resultStatus,
      durationMs: Math.max(0, Math.round(performance.now() - started)),
      visitedNodeKeys,
      traversedEdgeKeys,
      terminalNodeKey,
    };
  }

  private assertSubset(
    expected: Record<string, unknown>,
    actual: Record<string, unknown> | undefined,
    prefix = '$',
  ): TestAssertionResult[] {
    return Object.entries(expected).flatMap(([key, expectedValue]) => {
      const path = `${prefix}.${key}`;
      const actualValue = actual?.[key];
      if (this.isRecord(expectedValue) && this.isRecord(actualValue)) {
        return this.assertSubset(expectedValue, actualValue, path);
      }
      return [
        {
          path,
          expected: expectedValue,
          actual: actualValue,
          passed: JSON.stringify(expectedValue) === JSON.stringify(actualValue),
        },
      ];
    });
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return this.isRecord(value) ? value : {};
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
}
