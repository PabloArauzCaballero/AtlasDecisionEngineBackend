import { CodeImportService } from '../src/modules/code-import/code-import.service';
import { ContractExtractorService } from '../src/modules/code-import/contract-extractor.service';
import { ContractValidatorService } from '../src/modules/code-import/contract-validator.service';
import type { GeneratedGraphPreview } from '../src/modules/code-import/code-import.types';

/**
 * Una importación de código NO puede estrenar variables.
 *
 * Antes, al guardar, cualquier variable que el contrato mencionara y el catálogo
 * no tuviera se creaba sola: nombre igual al código, equipo «CODE_IMPORT», sin
 * clasificación real y sin restricciones. El resto del portal exige declarar la
 * variable antes de usarla; esta vía —la que menos revisión tiene— se la saltaba,
 * y el catálogo acababa lleno de variables que nadie gobierna.
 */

interface CatalogRow {
  variableCode: string;
  versions: Array<{ id: bigint; dataType: string }>;
}

/** Prisma reducido a lo único que consulta la comprobación del catálogo. */
function prismaWith(rows: CatalogRow[]) {
  return {
    decisionVariableDefinition: {
      findMany: ({ where }: { where: { variableCode: { in: string[] } } }) =>
        Promise.resolve(rows.filter((row) => where.variableCode.in.includes(row.variableCode))),
    },
  };
}

interface CatalogChecks {
  catalogIssues: (
    tenantId: bigint,
    dependencies: GeneratedGraphPreview['dependencies'],
  ) => Promise<Array<{ code: string; severity: string; message: string }>>;
  resolveVariableVersions: (
    tenantId: bigint,
    dependencies: GeneratedGraphPreview['dependencies'],
  ) => Promise<Map<string, bigint>>;
}

/**
 * Sólo se ejercitan las comprobaciones del catálogo, que no colaboran con nada
 * más del servicio: se monta la instancia con su única dependencia real (Prisma)
 * en vez de fabricar las once que pide el constructor y no intervienen aquí.
 */
function serviceWith(rows: CatalogRow[]): CatalogChecks {
  const service = Object.create(CodeImportService.prototype) as CatalogChecks & {
    prisma: unknown;
  };
  service.prisma = prismaWith(rows);
  return service;
}

const DEPENDENCIES: GeneratedGraphPreview['dependencies'] = [
  {
    variableCode: 'edad',
    usageType: 'INPUT',
    dependencyPath: 'input.edad',
    dataType: 'INTEGER',
    required: true,
  },
  {
    variableCode: 'decision',
    usageType: 'OUTPUT_PRIMARY',
    dependencyPath: 'output.decision',
    dataType: 'STRING',
    required: true,
  },
];

const EDAD: CatalogRow = { variableCode: 'edad', versions: [{ id: 10n, dataType: 'INTEGER' }] };
const DECISION: CatalogRow = {
  variableCode: 'decision',
  versions: [{ id: 11n, dataType: 'STRING' }],
};

describe('CodeImportService — contrato contra el catálogo', () => {
  it('marca como error la variable que el catálogo no declara', async () => {
    const service = serviceWith([EDAD]);

    const issues = await service.catalogIssues(1n, DEPENDENCIES);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'CODE_IMPORT_VARIABLE_NOT_IN_CATALOG',
      severity: 'ERROR',
    });
    expect(issues[0].message).toContain('decision');
  });

  it('acepta los alias históricos de tipo en vez de inventar un desajuste', async () => {
    // NUMBER (contrato) y DECIMAL (catálogo) son el mismo tipo canónico.
    const service = serviceWith([
      { variableCode: 'ingreso', versions: [{ id: 12n, dataType: 'DECIMAL' }] },
    ]);

    const issues = await service.catalogIssues(1n, [
      {
        variableCode: 'ingreso',
        usageType: 'INPUT',
        dependencyPath: 'input.ingreso',
        dataType: 'NUMBER',
        required: true,
      },
    ]);

    expect(issues).toEqual([]);
  });

  it('señala el tipo cuando contrato y catálogo no dicen lo mismo', async () => {
    const service = serviceWith([
      { variableCode: 'edad', versions: [{ id: 10n, dataType: 'STRING' }] },
      DECISION,
    ]);

    const issues = await service.catalogIssues(1n, DEPENDENCIES);

    expect(issues.map((issue) => issue.code)).toEqual(['CODE_IMPORT_VARIABLE_TYPE_MISMATCH']);
  });

  it('rechaza la escritura en vez de crear la variable que falta', async () => {
    const service = serviceWith([EDAD]);
    const resolve = service.resolveVariableVersions.bind(service);

    await expect(resolve(1n, DEPENDENCIES)).rejects.toMatchObject({
      code: 'CODE_IMPORT_VARIABLE_NOT_IN_CATALOG',
    });
    await expect(resolve(1n, [DEPENDENCIES[0]])).resolves.toEqual(new Map([['edad', 10n]]));
  });
});

describe('Contrato: reasonOutputId', () => {
  const SOURCE = [
    '// @atlas-contract',
    '// { "contractVersion": "1",',
    '//   "inputs": [{ "id": "edad", "name": "Edad", "type": "INTEGER", "required": true }],',
    '//   "outputs": [',
    '//     { "id": "decision", "name": "Decision", "type": "STRING", "required": true },',
    '//     { "id": "motivo", "name": "Motivo", "type": "STRING", "required": true }],',
    '//   "primaryOutputId": "decision",',
    '//   "reasonOutputId": "motivo" }',
    "return { decision: 'RECHAZADO', motivo: 'AGE_NOT_ELIGIBLE' };",
  ].join('\n');

  it('lo conserva al extraer el contrato', () => {
    // Sin esto se declaraba y se perdía: el generador caía a buscar el motivo en
    // cualquier salida de texto, justo cuando el autor había sido explícito.
    const extracted = new ContractExtractorService().extract('JAVASCRIPT', SOURCE);

    expect(extracted.contract?.reasonOutputId).toBe('motivo');
  });

  it('avisa cuando apunta a una salida que no existe', () => {
    const issues = new ContractValidatorService().validate(
      {
        contractVersion: '1',
        inputs: [],
        outputs: [{ id: 'decision', name: 'Decision', type: 'STRING', required: true }],
        reasonOutputId: 'motivo',
      },
      'JAVASCRIPT',
      "result = { decision: 'X' }",
    );

    expect(issues.map((issue) => issue.code)).toContain('CONTRACT_REASON_OUTPUT_UNKNOWN');
  });
});
