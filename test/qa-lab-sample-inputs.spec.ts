import type { PrismaService } from '../src/common/prisma/prisma.service';
import { QaLabService } from '../src/modules/qa-lab/qa-lab.service';

/**
 * El lote por VERSIÓN existe para un caso concreto: rellenar la entrada de un caso de
 * suite. La suite prueba una versión, no un despliegue, así que el contrato tiene que
 * salir de ahí — generarlo del ambiente dejaría casos que fallan por contrato el día que
 * alguien los ejecute contra la versión que sí prueban.
 */
describe('QaLabService.sampleInputs', () => {
  const compiledPayload = {
    variables: [
      {
        code: 'ingreso_mensual',
        dataType: 'DECIMAL',
        required: true,
        nullable: false,
        constraints: { min: 1000, max: 20000 },
      },
      { code: 'edad', dataType: 'INTEGER', required: true, nullable: false },
      {
        code: 'veredicto',
        dataType: 'STRING',
        required: false,
        nullable: true,
        usageType: 'OUTPUT',
      },
    ],
  };

  function serviceFor(payload: unknown = compiledPayload) {
    const prisma = {
      decisionCompiledArtifact: {
        findFirst: jest.fn().mockResolvedValue(payload ? { compiledPayloadJson: payload } : null),
      },
    } as unknown as PrismaService;
    return new QaLabService(prisma, {} as never, {} as never, {} as never, {} as never);
  }

  it('genera solo las entradas de la versión, dentro de su contrato', async () => {
    const batch = await serviceFor().sampleInputs(1n, 55n, { count: 4 });

    expect(batch.versionId).toBe('55');
    expect(batch.cases).toHaveLength(4);
    for (const generated of batch.cases) {
      expect(Object.keys(generated.input).sort()).toEqual(['edad', 'ingreso_mensual']);
      expect(generated.input.ingreso_mensual as number).toBeGreaterThanOrEqual(1000);
      expect(generated.input.ingreso_mensual as number).toBeLessThanOrEqual(20000);
    }
  });

  it('la misma semilla reproduce el mismo lote, y sin semilla cambia', async () => {
    const service = serviceFor();
    const first = await service.sampleInputs(1n, 55n, { count: 3 });
    const replay = await service.sampleInputs(1n, 55n, { count: 3, seed: first.seed });
    const fresh = await service.sampleInputs(1n, 55n, { count: 3 });

    expect(replay.cases).toEqual(first.cases);
    expect(fresh.seed).not.toBe(first.seed);
  });

  it('una versión sin compilar no devuelve valores inventados', async () => {
    await expect(serviceFor(null).sampleInputs(1n, 55n, {})).rejects.toMatchObject({
      code: 'QA_VERSION_NOT_COMPILED',
    });
  });

  it('una versión sin entradas lo dice en vez de devolver casos vacíos', async () => {
    const soloSalidas = { variables: [compiledPayload.variables[2]] };
    await expect(serviceFor(soloSalidas).sampleInputs(1n, 55n, {})).rejects.toMatchObject({
      code: 'ARTIFACT_HAS_NO_INPUTS',
    });
  });
});
