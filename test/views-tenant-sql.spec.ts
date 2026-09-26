import { Prisma } from '@prisma/client';
import { ViewsService } from '../src/modules/views/views.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type {
  ArtifactInputContractQueryDto,
  ArtifactPickerQueryDto,
  ArtifactVersionPickerQueryDto,
  GlobalSearchQueryDto,
  TestRunPickerQueryDto,
  TestSuitePickerQueryDto,
  VariablePickerQueryDto,
} from '../src/modules/views/views.dto';

/**
 * Estas consultas son el punto del servicio donde el aislamiento por tenant NO tiene la RLS
 * detrás: las vistas `vw_*` no llevan la política (ver `tenant-rls.ts`), así que la única
 * barrera es el `WHERE tenant_id = ?` que escribe este servicio. Si una consulta lo pierde,
 * no falla: devuelve datos de otro cliente.
 *
 * Se inspecciona el SQL producido en vez de ejecutarlo porque lo que hay que fijar es
 * precisamente eso —que el filtro está y que el valor va parametrizado, no interpolado—, y
 * eso se ve en la consulta, no en el resultado.
 */
describe('ViewsService — aislamiento por tenant en SQL crudo', () => {
  const TENANT = 12n;

  function capture() {
    const queries: Prisma.Sql[] = [];
    const prisma = {
      $queryRaw: (sql: Prisma.Sql) => {
        queries.push(sql);
        return Promise.resolve([]);
      },
    } as unknown as PrismaService;
    return { service: new ViewsService(prisma), queries };
  }

  /** Texto de la consulta; `Prisma.sql` deja los huecos de parámetro como `?`. */
  const text = (sql: Prisma.Sql) => sql.sql.replace(/\s+/g, ' ').trim();

  const casos: Array<[string, (s: ViewsService) => Promise<unknown>, string]> = [
    [
      'artifactPicker',
      (s) => s.artifactPicker(TENANT, {} as ArtifactPickerQueryDto),
      'vw_artifact_picker',
    ],
    [
      'artifactVersionPicker',
      (s) => s.artifactVersionPicker(TENANT, {} as ArtifactVersionPickerQueryDto),
      'vw_artifact_version_picker',
    ],
    [
      'variablePicker',
      (s) => s.variablePicker(TENANT, {} as VariablePickerQueryDto),
      'vw_variable_picker',
    ],
    ['formOptions', (s) => s.formOptions(TENANT, 'RISK_DOMAIN'), 'vw_form_option'],
    [
      'artifactInputContract',
      (s) =>
        s.artifactInputContract(TENANT, {
          artifactCode: 'CREDIT',
        } as ArtifactInputContractQueryDto),
      'vw_artifact_input_contract',
    ],
    [
      'testSuitePicker',
      (s) => s.testSuitePicker(TENANT, {} as TestSuitePickerQueryDto),
      'vw_test_suite_picker',
    ],
    [
      'testRunPicker',
      (s) => s.testRunPicker(TENANT, {} as TestRunPickerQueryDto),
      'vw_test_run_picker',
    ],
    ['nodeScripts', (s) => s.nodeScripts(TENANT, 5n), 'vw_node_script'],
    [
      'globalSearch',
      (s) => s.globalSearch(TENANT, { q: 'ana' } as GlobalSearchQueryDto),
      'vw_global_search',
    ],
  ];

  it.each(casos)('%s filtra por tenant_id y lo pasa parametrizado', async (_name, call, view) => {
    const { service, queries } = capture();
    await call(service);
    const sql = queries[0];

    expect(text(sql)).toContain(view);
    expect(text(sql)).toContain('WHERE tenant_id = ?');
    // El tenant es el PRIMER parámetro y viaja como valor, nunca interpolado en el texto.
    expect(sql.values[0]).toBe(TENANT);
    expect(text(sql)).not.toContain(TENANT.toString());
  });

  it('los filtros opcionales se añaden sin sacar el tenant de su sitio', async () => {
    const { service, queries } = capture();
    await service.artifactVersionPicker(TENANT, {
      artifactCode: 'CREDIT',
      status: 'APPROVED',
    } as ArtifactVersionPickerQueryDto);

    const sql = queries[0];
    expect(sql.values[0]).toBe(TENANT);
    expect(sql.values).toContain('CREDIT');
    expect(sql.values).toContain('APPROVED');
    expect(text(sql)).toContain('WHERE tenant_id = ?');
  });

  it('la búsqueda escapa los comodines de LIKE en vez de dejarlos actuar', async () => {
    const { service, queries } = capture();
    await service.artifactPicker(TENANT, { search: '100%_de_riesgo' } as ArtifactPickerQueryDto);

    const patron = queries[0].values.find(
      (value) => typeof value === 'string' && value.includes('riesgo'),
    ) as string;
    // Sin escapar, `%` y `_` de la entrada del usuario cambiarían el significado del patrón:
    // `100%` pasaría a coincidir con todo lo que empiece por «100».
    expect(patron).toBe('%100\\%\\_de\\_riesgo%');
  });

  it('el separador de escape también se escapa a sí mismo', async () => {
    const { service, queries } = capture();
    await service.variablePicker(TENANT, { search: 'a\\b' } as VariablePickerQueryDto);
    const patron = queries[0].values.find(
      (value) => typeof value === 'string' && value.includes('a'),
    ) as string;
    expect(patron).toBe('%a\\\\b%');
  });

  it('todos los listados llevan un tope de filas', async () => {
    const { service, queries } = capture();
    await service.artifactPicker(TENANT, {} as ArtifactPickerQueryDto);
    await service.variablePicker(TENANT, {} as VariablePickerQueryDto);
    await service.testSuitePicker(TENANT, {} as TestSuitePickerQueryDto);

    // Un selector sin cota es una descarga completa del catálogo por petición.
    for (const sql of queries) {
      expect(text(sql)).toContain('LIMIT');
      expect(sql.values).toContain(200);
    }
  });

  it('la búsqueda global respeta el límite pedido', async () => {
    const { service, queries } = capture();
    await service.globalSearch(TENANT, { q: 'ana', limit: 5 } as GlobalSearchQueryDto);
    expect(queries[0].values).toContain(5);
  });

  it('el contrato de entrada devuelve solo la versión más alta', async () => {
    // La vista trae todas las versiones ordenadas; quedarse con varias mezclaría contratos
    // de versiones distintas en una sola respuesta.
    const filas = [
      { versionId: 9n, versionNumber: 3, variableCode: 'ingresos' },
      { versionId: 9n, versionNumber: 3, variableCode: 'edad' },
      { versionId: 8n, versionNumber: 2, variableCode: 'antiguo' },
    ];
    const prisma = { $queryRaw: () => Promise.resolve(filas) } as unknown as PrismaService;
    const result = await new ViewsService(prisma).artifactInputContract(TENANT, {
      artifactCode: 'CREDIT',
    } as ArtifactInputContractQueryDto);

    expect(result.versionNumber).toBe(3);
    expect(result.versionId).toBe(9n);
    expect(result.variables.map((v) => v.variableCode)).toEqual(['ingresos', 'edad']);
  });

  it('un artefacto sin versiones devuelve nulos, no revienta', async () => {
    const prisma = { $queryRaw: () => Promise.resolve([]) } as unknown as PrismaService;
    const result = await new ViewsService(prisma).artifactInputContract(TENANT, {
      artifactCode: 'NO_EXISTE',
    } as ArtifactInputContractQueryDto);

    expect(result).toMatchObject({ versionId: null, versionNumber: null, variables: [] });
  });

  it('la búsqueda global informa del total que devuelve', async () => {
    const prisma = {
      $queryRaw: () => Promise.resolve([{ code: 'A' }, { code: 'B' }]),
    } as unknown as PrismaService;
    const result = await new ViewsService(prisma).globalSearch(TENANT, {
      q: 'a',
    } as GlobalSearchQueryDto);
    expect(result).toMatchObject({ query: 'a', total: 2 });
  });
});
