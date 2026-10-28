import { AuditQueryController } from '../src/modules/audit-query/audit-query.controller';
import { PostgresDecisionAuditReadAdapter } from '../src/modules/audit-query/adapters/postgres-decision-audit-read.adapter';

/**
 * `GET /v1/audit/access-runs` agrupaba `decision_access_audit` SIN filtrar por tenant: el
 * auditor de una organización veía recursos, decisiones, códigos HTTP y pantallas de TODAS. La
 * consulta se apoyaba solo en la política de filas de la base, que no actúa si el motor conecta
 * con un rol que la salta (la política se desactiva con un superusuario) o si el contexto del
 * tenant no llega a la transacción. El filtro tiene que estar también en la consulta.
 */
type GroupByArgs = {
  where: { occurredAt: { gte: Date }; OR?: Array<{ tenantId: bigint | null }> };
};

function adapterConClienteEspia() {
  const llamadas: GroupByArgs[] = [];
  const client = {
    decisionAccessAudit: {
      groupBy: (args: GroupByArgs) => {
        llamadas.push(args);
        return Promise.resolve([]);
      },
    },
  };
  const factory = {
    createReadAdapter: () => ({
      run: (_nombre: string, trabajo: (c: unknown) => Promise<unknown>) => trabajo(client),
      describe: () => ({}),
    }),
  };
  return {
    adapter: new PostgresDecisionAuditReadAdapter(factory as never),
    llamadas,
  };
}

describe('PostgresDecisionAuditReadAdapter · resumen de accesos acotado por tenant', () => {
  it('summarizeAccessRuns filtra por el tenant que pregunta y por las filas sin tenant', async () => {
    const { adapter, llamadas } = adapterConClienteEspia();
    await adapter.summarizeAccessRuns(7n, 30);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].where.OR).toEqual([{ tenantId: 7n }, { tenantId: null }]);
  });

  it('summarizeScreenRuns filtra igual', async () => {
    const { adapter, llamadas } = adapterConClienteEspia();
    await adapter.summarizeScreenRuns(7n, 30, 100);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].where.OR).toEqual([{ tenantId: 7n }, { tenantId: null }]);
  });

  it('dos tenants distintos producen filtros distintos: el filtro no es una constante', async () => {
    const { adapter, llamadas } = adapterConClienteEspia();
    await adapter.summarizeAccessRuns(1n, 30);
    await adapter.summarizeAccessRuns(2n, 30);
    expect(llamadas[0].where.OR?.[0]).toEqual({ tenantId: 1n });
    expect(llamadas[1].where.OR?.[0]).toEqual({ tenantId: 2n });
  });
});

describe('AuditQueryController.summarizeAccessRuns · el tenant sale del principal', () => {
  it('pasa el tenant del principal al servicio y normaliza la ventana', async () => {
    const llamadas: unknown[][] = [];
    const servicio = {
      summarizeAccessRuns: (...args: unknown[]) => {
        llamadas.push(args);
        return Promise.resolve({});
      },
    };
    const controlador = new AuditQueryController(servicio as never);
    await controlador.summarizeAccessRuns(9n, '7');
    await controlador.summarizeAccessRuns(9n, '9999');
    await controlador.summarizeAccessRuns(9n);
    expect(llamadas).toEqual([
      [9n, 7],
      [9n, 30],
      [9n, 30],
    ]);
  });
});
