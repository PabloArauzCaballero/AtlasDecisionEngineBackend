import type { DeploymentResolverService } from '../src/modules/deployments/deployment-resolver.service';
import { SampleInputService } from '../src/modules/runtime/sample-input.service';

/**
 * El valor de este endpoint depende de dos propiedades: que lo generado sea del CONTRATO
 * DESPLEGADO (si no, el simulador rechazaría acto seguido lo que el botón acaba de
 * escribir) y que sea reproducible por semilla (si no, un caso interesante se pierde en
 * cuanto se vuelve a pulsar).
 */
describe('SampleInputService', () => {
  const variables = [
    {
      code: 'score',
      dataType: 'INTEGER',
      required: true,
      nullable: false,
      constraints: { min: 300, max: 850 },
    },
    {
      code: 'country',
      dataType: 'ENUM',
      required: true,
      nullable: false,
      constraints: { allowedValues: ['PE', 'CL'] },
    },
    { code: 'outcome', dataType: 'STRING', required: false, nullable: true, usageType: 'OUTPUT' },
  ];

  function serviceFor(rows: unknown[] = variables) {
    const deployments = {
      resolve: jest.fn().mockResolvedValue({
        compiled: { variables: rows },
        environmentCode: 'DEV',
        artifactVersionId: 42n,
      }),
    } as unknown as DeploymentResolverService;
    return { service: new SampleInputService(deployments), deployments };
  }

  it('genera solo variables de entrada del artefacto desplegado, dentro de su contrato', async () => {
    const { service } = serviceFor();
    const result = await service.generate(1n, 'RIESGO', { environmentCode: 'sandbox', count: 5 });

    expect(result.cases).toHaveLength(5);
    for (const generated of result.cases) {
      expect(Object.keys(generated.input)).toEqual(['score', 'country']);
      expect(generated.input.score as number).toBeGreaterThanOrEqual(300);
      expect(generated.input.score as number).toBeLessThanOrEqual(850);
      expect(['PE', 'CL']).toContain(generated.input.country);
    }
  });

  it('la misma semilla devuelve exactamente los mismos valores', async () => {
    const { service } = serviceFor();
    const first = await service.generate(1n, 'RIESGO', { environmentCode: 'DEV', count: 3 });
    const repeat = await service.generate(1n, 'RIESGO', {
      environmentCode: 'DEV',
      count: 3,
      seed: first.seed,
    });
    expect(repeat.cases).toEqual(first.cases);
  });

  it('sin semilla, dos pulsaciones exploran entradas distintas', async () => {
    const { service } = serviceFor();
    const first = await service.generate(1n, 'RIESGO', { environmentCode: 'DEV', count: 4 });
    const second = await service.generate(1n, 'RIESGO', { environmentCode: 'DEV', count: 4 });
    expect(second.seed).not.toBe(first.seed);
  });

  it('INVALID produce valores que el contrato debe rechazar', async () => {
    const { service } = serviceFor();
    const result = await service.generate(1n, 'RIESGO', {
      environmentCode: 'DEV',
      kind: 'INVALID',
      count: 6,
    });
    expect(result.cases.every((generated) => generated.kind === 'INVALID')).toBe(true);
    expect(result.cases.every((generated) => Boolean(generated.mutation))).toBe(true);
  });

  it('no genera contra PROD', async () => {
    const { service, deployments } = serviceFor();
    await expect(service.generate(1n, 'RIESGO', { environmentCode: 'PROD' })).rejects.toMatchObject(
      { code: 'SIMULATION_PROD_FORBIDDEN' },
    );
    expect(deployments.resolve).not.toHaveBeenCalled();
  });

  it('un artefacto sin entradas lo dice, en vez de devolver casos vacíos', async () => {
    const { service } = serviceFor([variables[2]]);
    await expect(service.generate(1n, 'RIESGO', { environmentCode: 'DEV' })).rejects.toMatchObject({
      code: 'ARTIFACT_HAS_NO_INPUTS',
    });
  });
});
