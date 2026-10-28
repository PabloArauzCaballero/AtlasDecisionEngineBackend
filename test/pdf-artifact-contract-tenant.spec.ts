import { RequestContextService } from '../src/common/context/request-context.service';
import { PdfArtifactContractAdapter } from '../src/modules/artifacts/pdf-artifact-contract.adapter';

/**
 * El adaptador que le dice al generador documental qué publica cada artefacto no filtraba por
 * tenant: `GET /pdf/artifacts` y `GET /pdf/templates/:id/sample` mostraban los artefactos, los
 * campos de salida y los ejemplos de TODAS las organizaciones a cualquier rol del generador, y el
 * tipo de cada campo se resolvía con la versión más reciente de la variable de cualquier tenant.
 * Ahora toma el tenant del contexto de la petición y, sin él, no devuelve nada.
 */
type Where = Record<string, unknown>;

function montaje() {
  const consultas: { modelo: string; where: Where }[] = [];
  const prisma = {
    decisionArtifactVersion: {
      findMany: (args: { where: Where }) => {
        consultas.push({ modelo: 'versiones', where: args.where });
        return Promise.resolve([]);
      },
      findFirst: (args: { where: Where }) => {
        consultas.push({ modelo: 'version', where: args.where });
        return Promise.resolve({
          semanticVersion: '1.0.0',
          artifact: { artifactCode: 'A-1', name: 'Uno' },
          outputContractFields: [
            {
              fieldCode: 'f',
              name: 'F',
              description: null,
              sourceKind: 'NODE',
              sourceRef: 'monthly_income',
              absenceReasons: [],
              valueMappingJson: null,
              exampleJson: null,
            },
          ],
        });
      },
    },
    decisionVariableVersion: {
      findFirst: (args: { where: Where }) => {
        consultas.push({ modelo: 'variable', where: args.where });
        return Promise.resolve({ dataType: 'DECIMAL' });
      },
    },
  };
  const contexto = new RequestContextService();
  const adaptador = new PdfArtifactContractAdapter(prisma as never, contexto);
  const enTenant = <T>(tenantId: string | undefined, trabajo: () => Promise<T>) =>
    contexto.run({ requestId: 'r-1', startedAt: 0, ...(tenantId ? { tenantId } : {}) }, trabajo);
  return { adaptador, consultas, enTenant };
}

describe('PdfArtifactContractAdapter · aislamiento por tenant', () => {
  it('list() filtra las versiones por el tenant de la petición', async () => {
    const { adaptador, consultas, enTenant } = montaje();
    await enTenant('7', () => adaptador.list());
    expect(consultas).toHaveLength(1);
    expect(consultas[0].where).toMatchObject({ artifact: { tenantId: 7n } });
  });

  it('get() filtra el artefacto Y la variable que fija el tipo por el mismo tenant', async () => {
    const { adaptador, consultas, enTenant } = montaje();
    const contrato = await enTenant('7', () => adaptador.get('A-1'));
    expect(contrato?.fields[0].type).toBe('number');
    const version = consultas.find((c) => c.modelo === 'version');
    const variable = consultas.find((c) => c.modelo === 'variable');
    expect(version?.where).toMatchObject({ artifact: { artifactCode: 'A-1', tenantId: 7n } });
    expect(variable?.where).toMatchObject({
      definition: { variableCode: 'monthly_income', tenantId: 7n },
    });
  });

  it('dos tenants distintos consultan con filtros distintos', async () => {
    const { adaptador, consultas, enTenant } = montaje();
    await enTenant('1', () => adaptador.list());
    await enTenant('2', () => adaptador.list());
    expect(consultas.map((c) => (c.where.artifact as { tenantId: bigint }).tenantId)).toEqual([
      1n,
      2n,
    ]);
  });

  it('sin tenant en el contexto cierra: no consulta nada y no devuelve nada', async () => {
    const { adaptador, consultas, enTenant } = montaje();
    expect(await enTenant(undefined, () => adaptador.list())).toEqual([]);
    expect(await enTenant(undefined, () => adaptador.get('A-1'))).toBeUndefined();
    // Y fuera de cualquier petición, donde ni siquiera hay contexto.
    expect(await adaptador.list()).toEqual([]);
    expect(consultas).toHaveLength(0);
  });
});
