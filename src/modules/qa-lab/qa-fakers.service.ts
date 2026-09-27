/**
 * Datos realistas de los fakers sobre los casos que genera el contrato.
 *
 * El reparto de trabajo es deliberado:
 *
 * - El GENERADOR DEL CONTRATO decide la clase de cada caso (válido, frontera, inválido, por
 *   desenlace) y el valor que la define —el `min - 1`, el borde exacto, la rama del grafo—.
 *   Es el único que conoce las reglas, así que ese valor no se toca.
 * - Los FAKERS del servidor mock rellenan el resto con datos que parecen de una persona o un
 *   comercio boliviano: un carnet de 7 u 8 dígitos, un celular que empieza por 6 o 7, un
 *   ingreso con su gasto coherente. Sólo donde el nombre de la variable dice qué dato es
 *   (`faker-semantics.ts`) y sólo si el contrato acepta el valor.
 *
 * Determinismo: el mock devuelve el mismo lote para la misma semilla, y la superposición no
 * consume el generador pseudoaleatorio, así que misma semilla + misma configuración + mismo
 * contrato + mismo origen de fakers ⇒ mismo lote. El origen queda archivado con la corrida
 * (`fakers.source`) porque es lo único que puede cambiar entre dos corridas iguales: si hoy
 * responde el mock y ayer no, los lotes difieren y hay que poder verlo.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { CompiledDecisionArtifact } from '../graph/graph.types';
import { resolvedConstraintsOf, type GeneratorContractVariable } from './contract-value-factory';
import {
  fitToContract,
  semanticRuleFor,
  type FakerRecord,
  type FakerType,
  type SemanticRule,
} from './faker-semantics';
import { FakerUnavailableError, QaFakersClient } from './qa-fakers.client';

/**
 * Tope de elementos distintos que se piden al mock. Por encima, los casos reutilizan
 * personas (`i % tope`): para las propiedades del QA Lab da igual que se repita una
 * identidad, y pedir cinco mil personas eran 7 MB de JSON por corrida.
 */
export const MAX_FAKER_ITEMS = 1_000;

export type FakerSource = 'mock' | 'local-fallback' | 'none';

export interface FakerReport {
  /**
   * `mock`: los valores con significado salieron de los fakers. `local-fallback`: el mock no
   * respondió y TODO salió del generador del contrato (ver `reason`). `none`: ninguna
   * variable del contrato tiene un nombre que diga qué dato es, así que no hacía falta.
   */
  source: FakerSource;
  reason?: string;
  /** Variable → dato del faker que le corresponde (`ci` → `persona.documentNumber`). */
  mappedVariables: Record<string, string>;
  /** Cuántos valores se sustituyeron de verdad (el contrato pudo rechazar alguno). */
  replacedValues: number;
  types: FakerType[];
  schemaVersion?: string;
}

export interface OverlayCase {
  kind: string;
  mutation?: string;
  input: Record<string, unknown>;
}

@Injectable()
export class QaFakersService {
  private readonly logger = new Logger(QaFakersService.name);

  constructor(private readonly client: QaFakersClient) {}

  /**
   * Sustituye, caso a caso, los valores con significado por los del faker del mismo índice.
   *
   * Devuelve casos NUEVOS: los de entrada no se modifican, porque el llamador puede
   * necesitar el lote original si esto falla a medias.
   */
  async enrich<T extends OverlayCase>(
    cases: readonly T[],
    inputs: readonly GeneratorContractVariable[],
    options: { seed: string; compiled?: CompiledDecisionArtifact },
  ): Promise<{ cases: T[]; fakers: FakerReport }> {
    const plan = planFakers(inputs);
    const mappedVariables = Object.fromEntries(
      [...plan.rules].map(([code, rule]) => [code, rule.field]),
    );
    const types = [...plan.types];
    if (!plan.rules.size || !cases.length) {
      return {
        cases: [...cases],
        fakers: {
          source: 'none',
          reason: plan.rules.size
            ? 'El lote no tiene casos.'
            : 'Ninguna variable de entrada tiene un nombre que diga qué dato es (nombre, carnet, celular, ingreso…): todos los valores salen del generador del contrato.',
          mappedVariables,
          replacedValues: 0,
          types: [],
        },
      };
    }

    const count = Math.min(cases.length, MAX_FAKER_ITEMS);
    let records: Record<FakerType, Record<string, unknown>[]>;
    let schemaVersion: string | undefined;
    try {
      const fetched = await Promise.all(
        types.map(async (type) => {
          const response = await this.client.batch(type, {
            seed: options.seed,
            count,
            params: type === 'caso' ? plan.casoParams : {},
          });
          return [type, response] as const;
        }),
      );
      records = Object.fromEntries(
        fetched.map(([type, response]) => [type, response.items]),
      ) as Record<FakerType, Record<string, unknown>[]>;
      schemaVersion = fetched[0]?.[1].schemaVersion;
    } catch (error) {
      const reason =
        error instanceof FakerUnavailableError
          ? error.message
          : `Fallo inesperado al pedir los fakers: ${String(error)}`;
      this.logger.warn({ event: 'QA_FAKERS_UNAVAILABLE', reason });
      return {
        cases: [...cases],
        fakers: {
          source: 'local-fallback',
          reason: `${reason} Los valores salieron del generador local del contrato.`,
          mappedVariables,
          replacedValues: 0,
          types,
        },
      };
    }

    const protectedInOutcomes = options.compiled
      ? conditionVariableCodes(options.compiled, inputs)
      : new Set<string>();
    let replacedValues = 0;
    const enriched = cases.map((testCase, index) => {
      const record: FakerRecord = {};
      for (const type of types) record[type] = records[type][index % count];
      const input = { ...testCase.input };
      const locked = lockedCodes(testCase, protectedInOutcomes);
      for (const [code, rule] of plan.rules) {
        if (!(code in input) || locked.has(code)) continue;
        const source = record[rule.type];
        if (!source) continue;
        const variable = plan.variables.get(code);
        if (!variable) continue;
        const value = fitToContract(variable, rule.pick(source));
        if (value === undefined) continue;
        input[code] = value;
        replacedValues += 1;
      }
      return { ...testCase, input };
    });

    return {
      cases: enriched,
      fakers: { source: 'mock', mappedVariables, replacedValues, types, schemaVersion },
    };
  }
}

interface FakerPlan {
  rules: Map<string, SemanticRule>;
  variables: Map<string, GeneratorContractVariable>;
  types: Set<FakerType>;
  casoParams: Record<string, number>;
}

/** Qué variables tienen significado, qué fakers hacen falta y con qué parámetros. */
export function planFakers(inputs: readonly GeneratorContractVariable[]): FakerPlan {
  const rules = new Map<string, SemanticRule>();
  const variables = new Map<string, GeneratorContractVariable>();
  const types = new Set<FakerType>();
  for (const variable of inputs) {
    const rule = semanticRuleFor(variable.code);
    if (!rule) continue;
    rules.set(variable.code, rule);
    variables.set(variable.code, variable);
    types.add(rule.type);
  }
  return { rules, variables, types, casoParams: casoParamsFor(rules, variables) };
}

/**
 * Los parámetros del faker `caso` se derivan del CONTRATO: si la edad admitida es de 21 a 60,
 * se piden personas de 21 a 60 en vez de corregirlas después. Así el faker es parametrizado
 * por lo que el algoritmo declara y no por un valor escrito aquí.
 */
function casoParamsFor(
  rules: Map<string, SemanticRule>,
  variables: Map<string, GeneratorContractVariable>,
): Record<string, number> {
  const params: Record<string, number> = {};
  const rangeOf = (field: string) => {
    const code = [...rules].find(([, rule]) => rule.field === field)?.[0];
    const variable = code ? variables.get(code) : undefined;
    if (!variable) return null;
    const constraints = resolvedConstraintsOf(variable);
    const min = constraints.min ?? constraints.exclusiveMin;
    const max = constraints.max ?? constraints.exclusiveMax;
    return { min, max };
  };
  const age = rangeOf('persona.age');
  if (age) {
    const low = clampInt(age.min, 0, 100);
    const high = clampInt(age.max, 0, 100);
    if (low !== undefined) params.edadMin = low;
    if (high !== undefined) params.edadMax = high;
  }
  const income = rangeOf('perfilFinanciero.monthlyIncome');
  if (income) {
    const low = clampInt(income.min, 0, 1_000_000);
    const high = clampInt(income.max, 0, 1_000_000);
    if (low !== undefined) params.ingresoMin = low;
    if (high !== undefined) params.ingresoMax = high;
  }
  // Un rango vacío o invertido lo rechazaría el mock con 422: mejor no pedirlo.
  if ((params.edadMin ?? 0) > (params.edadMax ?? 100)) {
    delete params.edadMin;
    delete params.edadMax;
  }
  if ((params.ingresoMin ?? 0) > (params.ingresoMax ?? 1_000_000)) {
    delete params.ingresoMin;
    delete params.ingresoMax;
  }
  return params;
}

function clampInt(value: number | undefined, low: number, high: number): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.min(high, Math.max(low, Math.round(value)));
}

/**
 * Lo que la superposición NO puede tocar en un caso:
 *
 * - La variable que el generador mutó para hacerlo de frontera o inválido: ese valor ES el
 *   caso, y pisarlo con uno realista lo convertiría en válido.
 * - En los casos por desenlace, toda variable que aparezca en el grafo: el planificador la
 *   eligió para llevar la ejecución a una rama concreta, y un ingreso «realista» podría
 *   mandarla a otra.
 */
function lockedCodes(testCase: OverlayCase, graphCodes: ReadonlySet<string>): Set<string> {
  const locked = new Set<string>();
  if (testCase.kind === 'BOUNDARY' || testCase.kind === 'INVALID') {
    const target = testCase.mutation?.split(':')[0]?.trim();
    if (target) locked.add(target);
  }
  const isOutcome =
    testCase.kind === 'OUTCOME' || (testCase.mutation ?? '').startsWith('desenlace:');
  if (isOutcome) for (const code of graphCodes) locked.add(code);
  return locked;
}

/**
 * Variables de entrada que el grafo lee en algún sitio (condiciones, aristas, nodos).
 *
 * Se busca el código como palabra en el grafo serializado. Es conservador a propósito: un
 * falso positivo sólo deja un valor sin maquillar; un falso negativo desviaría un caso de la
 * rama que persigue.
 */
export function conditionVariableCodes(
  compiled: CompiledDecisionArtifact,
  inputs: readonly GeneratorContractVariable[],
): Set<string> {
  const graph = JSON.stringify([
    compiled.nodes,
    compiled.edgesByNode,
    compiled.conditions,
    compiled.actions,
    compiled.intermediates ?? [],
  ]);
  const found = new Set<string>();
  for (const { code } of inputs) {
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`).test(graph)) found.add(code);
  }
  return found;
}
