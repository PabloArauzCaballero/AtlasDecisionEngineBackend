import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { buildSampleBatch, seedSequence, type SampleRequest } from '../qa-lab/sample-inputs';
import {
  CalculatedFieldExecutorService,
  type ExecutableCalculatedField,
} from './calculated-field-executor.service';
import { CalculatedFieldLoader } from './calculated-field-loader.service';

/** Ejecutar una versión con entradas de ejemplo y correr sus casos de prueba declarados. */
@Injectable()
export class CalculatedFieldTestingService {
  /** Semillas distintas en pulsaciones sucesivas del botón de generar. */
  private readonly nextSampleSeed = seedSequence('calculated-field-sample');

  constructor(
    private readonly prisma: PrismaService,
    private readonly executor: CalculatedFieldExecutorService,
    private readonly loader: CalculatedFieldLoader,
  ) {}

  /** Ejecuta el campo con entradas de ejemplo, sin persistir nada (§6.1). */
  async tryRun(tenantId: bigint, versionId: bigint, inputs: Record<string, unknown>) {
    const executable = await this.loader.toExecutable(tenantId, versionId);
    const result = await this.executor.execute(executable, inputs);
    return { ...result, fieldCode: executable.fieldCode };
  }

  /**
   * Entradas de ejemplo derivadas del contrato de la versión, sin ejecutarlas.
   *
   * Reutiliza el generador del QA Lab en vez de tener uno propio: las entradas de
   * un campo calculado declaran tipo y restricciones igual que las variables de un
   * artefacto, así que la misma lógica sirve y no quedan dos criterios distintos
   * sobre qué es un valor «válido» o «de frontera».
   *
   * Determinista por semilla: repetirla devuelve el mismo lote, que es lo que
   * permite reproducir un caso que falló.
   */
  async sampleInputs(tenantId: bigint, versionId: bigint, request: SampleRequest) {
    const executable = await this.loader.toExecutable(tenantId, versionId);
    const inputs = executable.contract.inputs ?? [];
    if (!inputs.length) {
      throw new DomainException(
        'CALCULATED_FIELD_HAS_NO_INPUTS',
        'Esta versión no declara entradas, así que no hay valores que generar',
        HttpStatus.CONFLICT,
      );
    }
    const batch = buildSampleBatch(
      inputs.map((input) => ({
        code: input.id,
        dataType: input.dataType,
        required: input.required,
        // Una entrada de campo calculado no declara nulabilidad propia: si no es
        // obligatoria, puede faltar.
        nullable: !input.required,
        defaultValue: input.defaultValue,
        constraints: input.constraints,
      })),
      request,
      this.nextSampleSeed,
    );
    return { ...batch, versionId: versionId.toString(), fieldCode: executable.fieldCode };
  }

  async runTestCases(tenantId: bigint, versionId: bigint) {
    const executable = await this.loader.toExecutable(tenantId, versionId);
    const testCases = await this.prisma.calculatedFieldTestCase.findMany({
      where: { calculatedFieldVersionId: versionId },
      orderBy: { id: 'asc' },
    });
    const results = [];
    for (const testCase of testCases) {
      results.push(await this.runSingleTestCase(executable, testCase));
    }
    return {
      total: results.length,
      passed: results.filter((entry) => entry.passed).length,
      failed: results.filter((entry) => !entry.passed).length,
      results,
    };
  }

  private async runSingleTestCase(
    executable: ExecutableCalculatedField,
    testCase: {
      name: string;
      inputsJson: Prisma.JsonValue;
      expectedJson: Prisma.JsonValue;
      expectedErrorCode: string | null;
    },
  ) {
    try {
      const result = await this.executor.execute(
        executable,
        testCase.inputsJson as Record<string, unknown>,
      );
      const passed = testCase.expectedErrorCode
        ? false
        : JSON.stringify(result.value) === JSON.stringify(testCase.expectedJson);
      return { name: testCase.name, passed, actual: result.value, expected: testCase.expectedJson };
    } catch (error) {
      const code = error instanceof DomainException ? error.code : 'UNEXPECTED_ERROR';
      return {
        name: testCase.name,
        passed: testCase.expectedErrorCode === code,
        actual: null,
        error: code,
        expected: testCase.expectedJson,
      };
    }
  }
}
