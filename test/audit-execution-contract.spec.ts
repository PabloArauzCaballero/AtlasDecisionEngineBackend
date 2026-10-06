import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExecutionDetailRow } from '../src/modules/audit-query/adapters/postgres-decision-audit-read.adapter';

/**
 * Contrato de `GET /v1/audit/executions/:id` con el detalle de ejecución del portal.
 *
 * El portal probaba su pantalla contra una ejecución de ejemplo INVENTADA (`traceSteps`
 * con `nodeKey` en la raíz) que este backend nunca envió: sus pruebas pasaban y en
 * producción la reproducción no encendía ningún nodo, la tabla de variables salía en
 * «—» y el enmascarado no reconocía ningún dato personal. Aquí el ejemplo se TIPA contra
 * la fila real que devuelve Prisma con `EXECUTION_DETAIL_INCLUDE`, sólo con los campos
 * que el portal lee: si una relación o una columna de esas cambia, deja de compilar.
 *
 * El JSON publicado en `docs/contracts/` es el que el portal copia como fixture
 * (`src/contracts/fixtures/audit-execution.example.json`). Regenerarlo:
 * `UPDATE_CONTRACTS=1 yarn jest test/audit-execution-contract.spec.ts`.
 */

/** Lo que llega por HTTP: `BigInt` y `Date` viajan como texto (ver `main.ts`). */
type Wire<T> = T extends bigint | Date
  ? string
  : T extends Array<infer U>
    ? Array<Wire<U>>
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;

type Row = ExecutionDetailRow;
type Step = Row['steps'][number];
type Variable = Row['variables'][number];

/** Exactamente lo que consume `flattenExecution`/`normalizeTrace` en el portal. */
type ConsumedExecution = Wire<
  Pick<
    Row,
    | 'id'
    | 'requestId'
    | 'artifactVersionId'
    | 'decisionStatus'
    | 'businessOutcome'
    | 'durationMs'
    | 'executedAt'
    | 'inputSnapshotJson'
    | 'outputJson'
  > & {
    artifactVersion: Pick<Row['artifactVersion'], 'versionNumber'> & {
      artifact: Pick<Row['artifactVersion']['artifact'], 'artifactCode'>;
    };
    deployment: { environment: Pick<Row['deployment']['environment'], 'code'> };
    variables: Array<
      Pick<Variable, 'id' | 'valueJson' | 'sourceCode'> & {
        variableVersion: {
          definition: Pick<
            Variable['variableVersion']['definition'],
            'variableCode' | 'isSensitive' | 'sensitivityClass'
          >;
        };
      }
    >;
    steps: Array<
      Pick<Step, 'id' | 'stepOrder' | 'branchTaken' | 'durationUs' | 'evaluationResultJson'> & {
        node: Pick<Step['node'], 'nodeKey' | 'nodeType'>;
      }
    >;
  }
>;

/** Datos sintéticos: ningún valor corresponde a una persona real. */
const EXAMPLE = {
  id: '103',
  requestId: 'req-contrato-0001',
  artifactVersionId: '12',
  decisionStatus: 'SUCCEEDED',
  businessOutcome: 'APPROVED',
  durationMs: 41,
  executedAt: '2026-10-06T12:00:00.000Z',
  inputSnapshotJson: { country: 'BO', monthly_income: 5200, document_number: '0000000' },
  outputJson: { decision: 'APPROVED', score: 640 },
  artifactVersion: { versionNumber: 3, artifact: { artifactCode: 'SCORING_CONTRATO' } },
  deployment: { environment: { code: 'SANDBOX' } },
  variables: [
    {
      id: '501',
      valueJson: 'BO',
      sourceCode: 'REQUEST',
      variableVersion: {
        definition: { variableCode: 'country', isSensitive: false, sensitivityClass: 'INTERNAL' },
      },
    },
    {
      id: '502',
      valueJson: '0000000',
      sourceCode: 'REQUEST',
      variableVersion: {
        definition: { variableCode: 'document_number', isSensitive: true, sensitivityClass: 'PII' },
      },
    },
  ],
  steps: [
    {
      id: '901',
      stepOrder: 1,
      branchTaken: 'INICIO__TO__RIESGO',
      durationUs: '350',
      evaluationResultJson: {},
      node: { nodeKey: 'INICIO', nodeType: 'START' },
    },
    {
      id: '902',
      stepOrder: 2,
      branchTaken: null,
      durationUs: '2400',
      evaluationResultJson: {
        score: 640,
        variableState: {
          nodeKey: 'RIESGO',
          status: 'COMPLETED',
          durationUs: 2400,
          inputs: [
            {
              code: 'monthly_income',
              dataType: 'DECIMAL',
              state: 'VALID',
              value: 5200,
              sensitivityClass: 'INTERNAL',
              origin: 'REQUEST',
            },
            {
              code: 'document_number',
              dataType: 'STRING',
              state: 'VALID',
              value: null,
              sensitivityClass: 'PII',
              origin: 'REQUEST',
            },
          ],
          intermediatesBefore: [],
          intermediatesAfter: [],
          intermediatesCreated: [],
          intermediatesUpdated: [],
          outputs: [],
          errors: [],
          warnings: [],
        },
      },
      node: { nodeKey: 'RIESGO', nodeType: 'SCORE' },
    },
  ],
} satisfies ConsumedExecution;

const PUBLISHED = join(__dirname, '..', 'docs', 'contracts', 'audit-execution.example.json');

describe('Contrato del detalle de ejecución con el portal', () => {
  it('el ejemplo publicado coincide con el tipado contra la fila real', () => {
    const serialized = `${JSON.stringify(EXAMPLE, null, 2)}\n`;
    if (process.env.UPDATE_CONTRACTS === '1') writeFileSync(PUBLISHED, serialized);

    expect(readFileSync(PUBLISHED, 'utf8')).toBe(serialized);
  });
});
