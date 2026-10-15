import type {
  CompiledDecisionArtifact,
  GraphNodeSnapshot,
  WorkerCallSnapshot,
} from '../../graph/graph.types';
import { candidateValues, distinct, isInteger, isNumeric } from './candidate-values';
import { isRecord } from './expression-nodes';
import type { Dimension } from './types';

function getPath(source: unknown, path: string[]): unknown {
  return path.reduce<unknown>((cursor, segment) => {
    if (Array.isArray(cursor) && segment === 'length') return cursor.length;
    return isRecord(cursor) ? cursor[segment] : undefined;
  }, source);
}

function setPath(target: Record<string, unknown>, path: string[], value: unknown): void {
  let cursor = target;
  path.slice(0, -1).forEach((segment) => {
    if (!isRecord(cursor[segment])) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  });
  cursor[path[path.length - 1]] = value;
}

/** Las dimensiones que aporta un nodo WORKER: si la llamada falla (y con qué código) y cada salida que proyecta. */
export function workerDimensions(
  node: GraphNodeSnapshot,
  call: WorkerCallSnapshot,
  compiled: CompiledDecisionArtifact,
  literals: Map<string, unknown[]>,
): Dimension[] {
  const errorCodes: unknown[] = [];
  for (const output of call.outputs) {
    if (output.source !== 'EXPRESSION' && output.path === 'call.errorCode') {
      errorCodes.push(
        ...(literals.get(`intermediate.${output.intermediateCode}`) ?? []).filter(
          (item) => typeof item === 'string' && item,
        ),
      );
    }
  }
  const states = distinct([
    'SUCCEEDED',
    'FAILED',
    ...errorCodes.map((code) => `FAILED:${String(code)}`),
  ]);
  const dimensions: Dimension[] = [
    {
      key: `${node.key}#estado`,
      values: states,
      numeric: false,
      integer: false,
      accepts: () => true,
      read: (candidate) => {
        const double = candidate.workerDoubles[node.key];
        if (double?.status !== 'FAILED') return 'SUCCEEDED';
        return double.errorCode ? `FAILED:${double.errorCode}` : 'FAILED';
      },
      apply: (candidate, value) => {
        const [status, errorCode] = String(value).split(':');
        const double = { ...(candidate.workerDoubles[node.key] ?? {}) };
        double.status = status === 'FAILED' ? 'FAILED' : 'SUCCEEDED';
        if (errorCode) double.errorCode = errorCode;
        else delete double.errorCode;
        candidate.workerDoubles[node.key] = double;
      },
    },
  ];
  for (const output of call.outputs) {
    const path = output.source === 'EXPRESSION' ? null : (output.path ?? '');
    // Sólo se gobierna lo que el nodo lee de `result.*`: `call.*` lo decide el estado, y una
    // salida calculada por expresión no se puede invertir.
    if (!path || !path.startsWith('result.')) continue;
    const declared = compiled.intermediates.find((item) => item.code === output.intermediateCode);
    const dataType = declared?.dataType ?? 'STRING';
    const segments = path.slice('result.'.length).split('.');
    const countsItems = segments[segments.length - 1] === 'length';
    const numeric = isNumeric(dataType) || countsItems;
    const extra =
      output.defaultValue !== undefined && output.defaultValue !== null
        ? [output.defaultValue]
        : [];
    const values = candidateValues(
      numeric ? (countsItems ? 'INTEGER' : dataType) : dataType,
      literals.get(`intermediate.${output.intermediateCode}`) ?? [],
      extra,
    );
    dimensions.push({
      key: `${node.key}#${output.intermediateCode}`,
      values: distinct(values.length ? values : [null]),
      numeric,
      integer: countsItems || isInteger(dataType),
      accepts: (value) => !countsItems || (typeof value === 'number' && value >= 0 && value <= 200),
      read: (candidate) => {
        const result = candidate.workerDoubles[node.key]?.result ?? {};
        return getPath(result, segments) ?? null;
      },
      apply: (candidate, value) => {
        const double = {
          ...(candidate.workerDoubles[node.key] ?? { status: 'SUCCEEDED' as const }),
        };
        const result = isRecord(double.result) ? double.result : {};
        if (countsItems) {
          const size = Math.max(0, Math.min(200, Math.round(Number(value) || 0)));
          setPath(
            result,
            segments.slice(0, -1),
            Array.from({ length: size }, () => ({})),
          );
        } else {
          setPath(result, segments, value);
        }
        double.result = result;
        candidate.workerDoubles[node.key] = double;
      },
    });
  }
  return dimensions;
}
