/**
 * Ensayo de un campo calculado que TODAVÍA NO EXISTE (§6.1).
 *
 * El `try` de siempre pide un `versionId`, así que sólo sabía probar lo ya guardado: para
 * ver qué calcula una fórmula había que crear el campo, crear su versión y descubrir
 * entonces que la política de error no era la que se quería. Aquí el borrador entero viaja
 * en el cuerpo y **no se persiste nada**: ni campo, ni versión, ni caso de prueba.
 *
 * Lo que sí se comparte con el camino que guarda es todo lo que importa —el mismo
 * validador de contrato, el mismo resolutor de librerías, el mismo ejecutor aislado y el
 * mismo generador del QA Lab—, porque un ensayo que se pareciera al motor en vez de SER
 * el motor daría luz verde a versiones que después el guardado rechaza.
 */
import { HttpStatus, Injectable } from '@nestjs/common';
import { CalculatedFieldImplKind } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { parseBigIntId } from '../../common/http/id';
import { LibraryService } from '../libraries/library.service';
import { allowedFunctionsFor } from '../libraries/library-preludes';
import { buildSampleBatch, seedSequence, type SampleRequest } from '../qa-lab/sample-inputs';
import { validateCalculatedFieldContract } from './calculated-field-contract.validator';
import {
  CalculatedFieldExecutorService,
  type ExecutableCalculatedField,
} from './calculated-field-executor.service';
import {
  classifyExecution,
  classifyFailure,
  declaredOutcomes,
  failureMessage,
  type OutcomeCode,
} from './calculated-field-outcomes';
import type { CalculatedFieldContract, OperationNode } from './calculated-field.types';
import type {
  CalculatedFieldTestCaseDto,
  CreateCalculatedFieldVersionDto,
} from './calculated-field.dto';

/**
 * El código con el que se etiqueta un ensayo en las métricas.
 *
 * Es una constante y no el código que el autor esté escribiendo: `recordCalculatedField`
 * usa el código como ETIQUETA, y un borrador puede llamarse cualquier cosa. Dejar entrar
 * texto libre ahí sería abrir la cardinalidad de la métrica a quien pulse el botón.
 */
const PREVIEW_FIELD_CODE = '__preview__';

/** Las tres clases de entrada que se combinan para buscar desenlaces distintos. */
const COVERAGE_KINDS = ['VALID', 'BOUNDARY', 'INVALID'] as const;

interface CoverageRequest {
  seed?: string;
  /** Casos POR CLASE. El total ejecutado es tres veces esto. */
  count?: number;
}

/**
 * Un caso generado, ya ejecutado y clasificado por su desenlace.
 *
 * Exportada porque asoma en el tipo de retorno inferido de dos métodos públicos del
 * controlador y `tsconfig` emite declaraciones: un tipo que el consumidor recibe pero no puede
 * nombrar rompe la compilación (TS4053) en vez de quedarse en un detalle interno.
 */
export interface CoverageCase {
  index: number;
  kind: (typeof COVERAGE_KINDS)[number];
  mutation?: string;
  input: Record<string, unknown>;
  outcome: OutcomeCode;
  value?: unknown;
  error?: string;
  durationMs: number;
}

@Injectable()
export class CalculatedFieldPreviewService {
  private readonly nextSampleSeed = seedSequence('calculated-field-preview');

  constructor(
    private readonly libraries: LibraryService,
    private readonly executor: CalculatedFieldExecutorService,
  ) {}

  /**
   * Convierte un borrador en algo ejecutable, sin tocar la base.
   *
   * Valida el contrato con el MISMO validador que el guardado y devuelve sus
   * incumplimientos tal cual: así el ensayo enseña la lista completa de lo que hay que
   * corregir antes de crear nada, en vez de fallar al guardar.
   */
  async toExecutable(
    tenantId: bigint,
    definition: CreateCalculatedFieldVersionDto,
  ): Promise<ExecutableCalculatedField> {
    const libraryIds = (definition.libraryIds ?? []).map((id) => parseBigIntId(id, 'libraryId'));
    const libraries = await this.libraries.resolveForExecution(
      tenantId,
      libraryIds,
      definition.implementationKind as CalculatedFieldImplKind,
      definition.environment ?? null,
    );
    const allowedFunctions =
      definition.implementationKind === 'OPERATION'
        ? []
        : allowedFunctionsFor(
            libraries.map((library) => library.packageName),
            definition.implementationKind,
          );

    const validation = validateCalculatedFieldContract(definition, allowedFunctions);
    if (!validation.valid) {
      throw new DomainException(
        'CALCULATED_FIELD_CONTRACT_INVALID',
        'El contrato del campo calculado no es válido',
        HttpStatus.BAD_REQUEST,
        { issues: validation.issues },
      );
    }

    return {
      fieldCode: PREVIEW_FIELD_CODE,
      implementationKind: definition.implementationKind,
      contract: {
        inputs: definition.inputs as unknown as CalculatedFieldContract['inputs'],
        returns: definition.returns as unknown as CalculatedFieldContract['returns'],
      },
      operation: definition.operation as OperationNode | undefined,
      sourceCode: definition.sourceCode ?? undefined,
      libraryPackages: libraries.map((library) => library.packageName),
      defaultValue: definition.defaultValue,
      timeoutMs: definition.timeoutMs,
    };
  }

  /** Ejecuta el borrador con unas entradas concretas. */
  async tryRun(
    tenantId: bigint,
    definition: CreateCalculatedFieldVersionDto,
    inputs: Record<string, unknown>,
  ) {
    const executable = await this.toExecutable(tenantId, definition);
    const result = await this.executor.execute(executable, inputs);
    return { ...result, fieldCode: PREVIEW_FIELD_CODE, persisted: false };
  }

  /**
   * Entradas de ejemplo de unas entradas declaradas, sin ejecutarlas.
   *
   * NO valida el contrato entero a propósito: generar valores para unas entradas ya
   * declaradas es justo lo que se quiere hacer mientras la fórmula todavía está a medias.
   * Lo comparten el borrador y la versión guardada.
   */
  samplesOf(inputs: CalculatedFieldContract['inputs'], request: SampleRequest) {
    if (!inputs?.length) {
      throw new DomainException(
        'CALCULATED_FIELD_HAS_NO_INPUTS',
        'Este borrador no declara entradas, así que no hay valores que generar',
        HttpStatus.CONFLICT,
      );
    }
    return buildSampleBatch(
      inputs.map((input) => ({
        code: input.id,
        dataType: input.dataType,
        required: input.required,
        nullable: !input.required,
        defaultValue: input.defaultValue,
        constraints: input.constraints,
      })),
      request,
      this.nextSampleSeed,
    );
  }

  /** Corre los casos de prueba que el borrador declara, sin haberlos guardado. */
  async runTestCases(tenantId: bigint, definition: CreateCalculatedFieldVersionDto) {
    const executable = await this.toExecutable(tenantId, definition);
    const results = [];
    for (const testCase of definition.testCases ?? []) {
      results.push(await this.runSingleTestCase(executable, testCase));
    }
    return {
      total: results.length,
      passed: results.filter((entry) => entry.passed).length,
      failed: results.filter((entry) => !entry.passed).length,
      results,
    };
  }

  /** Cobertura de desenlaces de un borrador. */
  async outcomeCoverage(
    tenantId: bigint,
    definition: CreateCalculatedFieldVersionDto,
    request: CoverageRequest,
  ) {
    const executable = await this.toExecutable(tenantId, definition);
    return this.coverageOf(executable, request);
  }

  /**
   * Genera entradas de las tres clases, las EJECUTA y agrupa por desenlace.
   *
   * Es el análogo del `OUTCOMES` del simulador, pero un campo calculado no tiene grafo
   * que recorrer hacia atrás: sus finales los fija el contrato de retorno, así que la
   * única forma honesta de saber cuáles se alcanzan es ejecutar y mirar. Por eso se
   * informa también de los DECLARADOS que ningún caso alcanzó: una tanda que sólo
   * enseñara lo cubierto se leería como «probado todo».
   */
  async coverageOf(executable: ExecutableCalculatedField, request: CoverageRequest) {
    const seed = request.seed?.trim() || this.nextSampleSeed();
    const perKind = Math.min(10, Math.max(1, request.count ?? 3));
    const generated: Array<Pick<CoverageCase, 'kind' | 'mutation' | 'input'>> = [];

    for (const kind of COVERAGE_KINDS) {
      const batch = this.samplesOf(executable.contract.inputs, {
        kind,
        count: perKind,
        seed: `${seed}:${kind}`,
      });
      for (const entry of batch.cases) {
        generated.push({ kind, mutation: entry.mutation, input: entry.input });
      }
    }

    const executed: CoverageCase[] = [];
    const reached = new Set<OutcomeCode>();
    for (const [index, entry] of generated.entries()) {
      const outcome = await this.executeForCoverage(executable, entry.input);
      reached.add(outcome.outcome);
      executed.push({ index, ...entry, ...outcome });
    }

    const declared = declaredOutcomes(executable).map((outcome) => ({
      ...outcome,
      covered: reached.has(outcome.code),
    }));
    return {
      seed,
      countPerKind: perKind,
      total: executed.length,
      declared,
      /** Desenlaces que ocurrieron sin estar declarados: casi siempre, entradas rechazadas. */
      undeclared: [...reached].filter((code) => !declared.some((entry) => entry.code === code)),
      uncovered: declared.filter((entry) => !entry.covered).map((entry) => entry.code),
      cases: executed,
    };
  }

  private async executeForCoverage(
    executable: ExecutableCalculatedField,
    input: Record<string, unknown>,
  ) {
    try {
      const result = await this.executor.execute(executable, input);
      return {
        outcome: classifyExecution(result),
        value: result.value,
        durationMs: result.durationMs,
      };
    } catch (error) {
      return { outcome: classifyFailure(error), error: failureMessage(error), durationMs: 0 };
    }
  }

  private async runSingleTestCase(
    executable: ExecutableCalculatedField,
    testCase: CalculatedFieldTestCaseDto,
  ) {
    try {
      const result = await this.executor.execute(executable, testCase.inputs);
      const passed = testCase.expectedErrorCode
        ? false
        : JSON.stringify(result.value) === JSON.stringify(testCase.expected);
      return { name: testCase.name, passed, actual: result.value, expected: testCase.expected };
    } catch (error) {
      const code = error instanceof DomainException ? error.code : 'UNEXPECTED_ERROR';
      return {
        name: testCase.name,
        passed: testCase.expectedErrorCode === code,
        actual: null,
        error: code,
        expected: testCase.expected,
      };
    }
  }
}
