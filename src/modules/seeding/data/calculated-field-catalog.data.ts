/**
 * Campos calculados iniciales (§5, §11).
 *
 * Cada uno cubre una de las tres modalidades de §6 y trae sus casos de prueba con el
 * resultado real esperado: si el motor cambiara y dejara de producirlo, la publicación
 * fallaría. Un seeder cuyos valores esperados no coinciden con la ejecución real es
 * peor que no tener seeder, porque da confianza falsa.
 */
import { createHash } from 'node:crypto';
import type { CalculatedFieldImplKind, Prisma, PrismaClient } from '@prisma/client';
import { TENANT_ID } from './helpers';

interface CalculatedFieldSeed {
  fieldCode: string;
  name: string;
  description: string;
  rationale: string;
  category: string;
  implementationKind: CalculatedFieldImplKind;
  inputs: Array<Record<string, unknown>>;
  returns: Record<string, unknown>;
  comments?: Record<string, unknown>;
  operation?: Record<string, unknown>;
  sourceCode?: string;
  /** Librerías por (nombre lógico, lenguaje) que la versión necesita. */
  libraries?: Array<{ logicalName: string; language: CalculatedFieldImplKind }>;
  testCases: Array<{
    name: string;
    inputs: Record<string, unknown>;
    expected?: unknown;
    expectedErrorCode?: string;
  }>;
}

const decimalReturn = (errorCode: string, extra: Record<string, unknown> = {}) => ({
  dataType: 'DECIMAL',
  nullable: false,
  precision: 4,
  nullConditions: [],
  divisionByZero: 'FAIL',
  missingData: 'FAIL',
  outOfRange: 'FAIL',
  errorCode,
  ...extra,
});

export const calculatedFieldCatalog: CalculatedFieldSeed[] = [
  {
    fieldCode: 'debt_to_income',
    name: 'Relación deuda/ingreso',
    description: 'Deuda mensual dividida entre el ingreso mensual del solicitante.',
    rationale:
      'Es el indicador de capacidad de pago que consumen originación, refinanciación y cobranza; tenerlo una sola vez evita tres fórmulas distintas.',
    category: 'AFORDABILIDAD',
    implementationKind: 'OPERATION',
    inputs: [
      {
        id: 'deuda_mensual',
        name: 'Deuda mensual',
        description: 'Suma de cuotas mensuales vigentes',
        dataType: 'DECIMAL',
        required: true,
        constraints: { min: 0 },
      },
      {
        id: 'ingreso_mensual',
        name: 'Ingreso mensual',
        description: 'Ingreso neto mensual verificado',
        dataType: 'DECIMAL',
        required: true,
        constraints: { exclusiveMin: 0 },
      },
    ],
    returns: decimalReturn('DTI_NOT_COMPUTABLE', { constraints: { min: 0, max: 100 } }),
    comments: {
      overview: 'Cociente simple entre deuda e ingreso, sin anualizar.',
      assumptions: ['Ambos importes están en la misma moneda y periodicidad mensual.'],
      limitations: ['No contempla ingresos variables ni estacionalidad.'],
      example: 'deuda 450, ingreso 1200 → 0.375',
      outputExplained:
        'Fracción entre 0 y 100; 0.375 significa que el 37,5 % del ingreso está comprometido.',
    },
    operation: {
      operation: 'ROUND',
      args: [
        { operation: 'DIVIDE', args: [{ input: 'deuda_mensual' }, { input: 'ingreso_mensual' }] },
        { literal: 4 },
      ],
    },
    testCases: [
      { name: 'caso base', inputs: { deuda_mensual: 450, ingreso_mensual: 1200 }, expected: 0.375 },
      { name: 'sin deuda', inputs: { deuda_mensual: 0, ingreso_mensual: 1200 }, expected: 0 },
      {
        name: 'ingreso cero es rechazado por el contrato de entrada',
        inputs: { deuda_mensual: 450, ingreso_mensual: 0 },
        expectedErrorCode: 'CALCULATED_FIELD_INPUT_INVALID',
      },
      {
        name: 'falta el ingreso',
        inputs: { deuda_mensual: 450 },
        expectedErrorCode: 'CALCULATED_FIELD_INPUT_MISSING',
      },
    ],
  },
  {
    fieldCode: 'age_in_years',
    name: 'Edad en años',
    description: 'Años completos entre la fecha de nacimiento y la fecha de evaluación.',
    rationale:
      'La edad legal condiciona la elegibilidad en todos los productos; calcularla en cada grafo producía discrepancias de un año en los cumpleaños.',
    category: 'ELEGIBILIDAD',
    implementationKind: 'OPERATION',
    inputs: [
      {
        id: 'fecha_nacimiento',
        name: 'Fecha de nacimiento',
        description: 'Fecha ISO de nacimiento',
        dataType: 'DATE',
        required: true,
      },
      {
        id: 'fecha_evaluacion',
        name: 'Fecha de evaluación',
        description: 'Fecha ISO en la que se evalúa la solicitud',
        dataType: 'DATE',
        required: true,
      },
    ],
    returns: {
      dataType: 'INTEGER',
      nullable: false,
      nullConditions: [],
      divisionByZero: 'FAIL',
      missingData: 'FAIL',
      outOfRange: 'FAIL',
      errorCode: 'AGE_NOT_COMPUTABLE',
      constraints: { min: 0, max: 130 },
    },
    comments: {
      overview: 'Años cumplidos, no redondeados: el día del cumpleaños ya cuenta.',
      assumptions: ['Ambas fechas vienen en ISO y en la misma zona horaria.'],
      example: 'nacido 1990-05-01, evaluado 2026-04-30 → 35',
    },
    operation: {
      operation: 'AGE_YEARS',
      args: [{ input: 'fecha_nacimiento' }, { input: 'fecha_evaluacion' }],
    },
    testCases: [
      {
        name: 'un día antes del cumpleaños',
        inputs: { fecha_nacimiento: '1990-05-01', fecha_evaluacion: '2026-04-30' },
        expected: 35,
      },
      {
        name: 'el día del cumpleaños',
        inputs: { fecha_nacimiento: '1990-05-01', fecha_evaluacion: '2026-05-01' },
        expected: 36,
      },
      {
        name: 'menor de edad',
        inputs: { fecha_nacimiento: '2010-01-01', fecha_evaluacion: '2026-07-30' },
        expected: 16,
      },
    ],
  },
  {
    fieldCode: 'installment_burden',
    name: 'Carga de la cuota',
    description: 'Porcentaje del ingreso disponible que consumiría la nueva cuota.',
    rationale:
      'Complementa al DTI incorporando la cuota solicitada; se implementa por código porque la fórmula combina tres entradas en una sola expresión.',
    category: 'AFORDABILIDAD',
    implementationKind: 'JAVASCRIPT',
    inputs: [
      {
        id: 'cuota_solicitada',
        name: 'Cuota solicitada',
        description: 'Cuota mensual del crédito pedido',
        dataType: 'DECIMAL',
        required: true,
        constraints: { min: 0 },
      },
      {
        id: 'ingreso_disponible',
        name: 'Ingreso disponible',
        description: 'Ingreso neto menos gastos fijos',
        dataType: 'DECIMAL',
        required: true,
        constraints: { exclusiveMin: 0 },
      },
    ],
    returns: {
      dataType: 'PERCENTAGE',
      nullable: false,
      precision: 2,
      nullConditions: [],
      divisionByZero: 'FAIL',
      missingData: 'FAIL',
      outOfRange: 'RETURN_DEFAULT',
      errorCode: 'BURDEN_NOT_COMPUTABLE',
      constraints: { min: 0, max: 100 },
    },
    comments: {
      overview: 'Cuota sobre ingreso disponible, expresado en porcentaje.',
      limitations: ['Una cuota superior al ingreso disponible se acota al 100 %.'],
      example: 'cuota 300, disponible 1000 → 30',
    },
    // Dos líneas ejecutables: dentro del límite de tres de §6.2.
    sourceCode: [
      '// Porcentaje del ingreso disponible comprometido por la nueva cuota.',
      'const carga = (variables.cuota_solicitada / variables.ingreso_disponible) * 100;',
      'return math.min(carga, 100);',
    ].join('\n'),
    libraries: [{ logicalName: 'math', language: 'JAVASCRIPT' }],
    testCases: [
      {
        name: 'carga moderada',
        inputs: { cuota_solicitada: 300, ingreso_disponible: 1000 },
        expected: 30,
      },
      {
        name: 'cuota mayor que el disponible se acota',
        inputs: { cuota_solicitada: 2000, ingreso_disponible: 1000 },
        expected: 100,
      },
      { name: 'sin cuota', inputs: { cuota_solicitada: 0, ingreso_disponible: 1000 }, expected: 0 },
    ],
  },
  {
    fieldCode: 'ingreso_disponible_neto',
    name: 'Ingreso disponible neto',
    description: 'Lo que le queda al solicitante cada mes tras cubrir sus gastos fijos.',
    rationale:
      'Es la base de toda medida de capacidad de pago. Se implementa en Python porque el equipo de riesgo mantiene sus modelos en ese lenguaje y así la fórmula no se traduce dos veces.',
    category: 'AFORDABILIDAD',
    implementationKind: 'PYTHON',
    inputs: [
      {
        id: 'ingreso_mensual',
        name: 'Ingreso mensual',
        description: 'Ingreso neto declarado y verificado',
        dataType: 'DECIMAL',
        required: true,
        constraints: { min: 0 },
      },
      {
        id: 'gastos_mensuales',
        name: 'Gastos mensuales',
        description: 'Gastos fijos comprometidos',
        dataType: 'DECIMAL',
        required: true,
        constraints: { min: 0 },
      },
    ],
    returns: {
      dataType: 'DECIMAL',
      nullable: false,
      precision: 2,
      nullConditions: [],
      divisionByZero: 'FAIL',
      missingData: 'FAIL',
      // Un disponible negativo no es un error de cálculo: es un solicitante
      // sobreendeudado, y el algoritmo debe poder verlo y decidir.
      outOfRange: 'RETURN_DEFAULT',
      errorCode: 'DISPOSABLE_NOT_COMPUTABLE',
      constraints: { min: -100000, max: 100000 },
    },
    comments: {
      overview: 'Ingreso menos gastos fijos, redondeado a dos decimales.',
      example: 'ingreso 4200, gastos 1500 -> 2700',
    },
    sourceCode: [
      '# Lo que queda libre cada mes; puede ser negativo si hay sobreendeudamiento.',
      'result = math_round(variables["ingreso_mensual"] - variables["gastos_mensuales"], 2)',
    ].join('\n'),
    libraries: [{ logicalName: 'math', language: 'PYTHON' }],
    testCases: [
      {
        name: 'holgura normal',
        inputs: { ingreso_mensual: 4200, gastos_mensuales: 1500 },
        expected: 2700,
      },
      {
        name: 'sobreendeudado: queda en negativo',
        inputs: { ingreso_mensual: 1000, gastos_mensuales: 1400 },
        expected: -400,
      },
    ],
  },
  {
    fieldCode: 'holgura_sobre_cuota',
    name: 'Holgura sobre la cuota',
    description:
      'Cuantas veces cabe la cuota solicitada dentro del ingreso disponible. Cuanto mas alto, mas colchon tiene el solicitante.',
    rationale:
      'El porcentaje de carga responde "cuanto consume"; esta responde "cuanto margen queda", que es lo que mira un analista al aprobar con excepcion. Usa la libreria matematica autorizada para acotar el resultado.',
    category: 'AFORDABILIDAD',
    implementationKind: 'JAVASCRIPT',
    inputs: [
      {
        id: 'ingreso_disponible',
        name: 'Ingreso disponible',
        description: 'Ingreso neto menos gastos fijos',
        dataType: 'DECIMAL',
        required: true,
        constraints: { exclusiveMin: 0 },
      },
      {
        id: 'cuota_solicitada',
        name: 'Cuota solicitada',
        description: 'Cuota mensual del credito pedido',
        dataType: 'DECIMAL',
        required: true,
        constraints: { exclusiveMin: 0 },
      },
    ],
    returns: {
      dataType: 'DECIMAL',
      nullable: false,
      precision: 2,
      nullConditions: [],
      divisionByZero: 'FAIL',
      missingData: 'FAIL',
      outOfRange: 'RETURN_DEFAULT',
      errorCode: 'HEADROOM_NOT_COMPUTABLE',
      constraints: { min: 0, max: 50 },
    },
    comments: {
      overview: 'Ingreso disponible dividido entre la cuota, acotado a 50.',
      example: 'disponible 2700, cuota 300 -> 9 (la cuota cabe nueve veces)',
    },
    sourceCode: [
      '// Cuantas veces cabe la cuota en el disponible; a mas alto, mas colchon.',
      'const veces = variables.ingreso_disponible / variables.cuota_solicitada;',
      'return math.min(math.round(veces * 100) / 100, 50);',
    ].join('\n'),
    libraries: [{ logicalName: 'math', language: 'JAVASCRIPT' }],
    testCases: [
      {
        name: 'colchon holgado',
        inputs: { ingreso_disponible: 2700, cuota_solicitada: 300 },
        expected: 9,
      },
      {
        name: 'cuota igual al disponible: sin colchon',
        inputs: { ingreso_disponible: 1000, cuota_solicitada: 1000 },
        expected: 1,
      },
    ],
  },
  {
    fieldCode: 'estabilidad_ingreso',
    name: 'Estabilidad del ingreso',
    description:
      'Cuanto varia el ingreso de los ultimos meses: a mayor dispersion, menos predecible es la capacidad de pago.',
    rationale:
      'Dos solicitantes con el mismo promedio no tienen el mismo riesgo si uno cobra igual todos los meses y el otro alterna picos y ceros. Es ademas el unico campo con entrada de tipo LISTA: mantiene cubierto el caso que el sandbox no soportaba.',
    category: 'AFORDABILIDAD',
    implementationKind: 'JAVASCRIPT',
    inputs: [
      {
        id: 'ingresos_ultimos_meses',
        name: 'Ingresos de los ultimos meses',
        description: 'Serie de ingresos mensuales verificados',
        dataType: 'LIST',
        required: true,
        constraints: { minItems: 2, maxItems: 24 },
      },
    ],
    returns: {
      dataType: 'DECIMAL',
      nullable: false,
      precision: 2,
      nullConditions: [],
      divisionByZero: 'RETURN_DEFAULT',
      missingData: 'FAIL',
      outOfRange: 'RETURN_DEFAULT',
      errorCode: 'STABILITY_NOT_COMPUTABLE',
      constraints: { min: 0, max: 5 },
    },
    comments: {
      overview:
        'Coeficiente de variacion: desviacion estandar sobre el promedio. 0 es un ingreso identico cada mes.',
      example: '[1000, 1000, 1000] -> 0',
    },
    sourceCode: [
      '// Coeficiente de variacion: 0 = ingreso perfectamente estable.',
      'const media = statistics.mean(variables.ingresos_ultimos_meses);',
      'return media === 0 ? 1 : statistics.stdev(variables.ingresos_ultimos_meses) / media;',
    ].join('\n'),
    libraries: [{ logicalName: 'statistics', language: 'JAVASCRIPT' }],
    testCases: [
      {
        name: 'ingreso identico cada mes',
        inputs: { ingresos_ultimos_meses: [1000, 1000, 1000] },
        expected: 0,
      },
      {
        name: 'ingreso muy variable',
        inputs: { ingresos_ultimos_meses: [500, 1500, 1000] },
        expected: 0.41,
      },
    ],
  },
];

export async function seedCalculatedFields(prisma: PrismaClient) {
  const seeded = [];
  for (const seed of calculatedFieldCatalog) {
    const field = await prisma.calculatedField.upsert({
      where: { tenantId_fieldCode: { tenantId: TENANT_ID, fieldCode: seed.fieldCode } },
      update: {
        name: seed.name,
        description: seed.description,
        rationale: seed.rationale,
        category: seed.category,
        ownerTeam: 'RISK_DECISIONING',
        isActive: true,
      },
      create: {
        tenantId: TENANT_ID,
        fieldCode: seed.fieldCode,
        name: seed.name,
        description: seed.description,
        rationale: seed.rationale,
        category: seed.category,
        ownerTeam: 'RISK_DECISIONING',
      },
    });

    const existing = await prisma.calculatedFieldVersion.findFirst({
      where: { calculatedFieldId: field.id, versionNumber: 1 },
    });
    if (existing) {
      seeded.push({ field, version: existing });
      continue;
    }

    const contentHash = createHash('sha256')
      .update(
        JSON.stringify({
          inputs: seed.inputs,
          returns: seed.returns,
          operation: seed.operation ?? null,
          sourceCode: seed.sourceCode ?? null,
        }),
      )
      .digest('hex');

    const version = await prisma.calculatedFieldVersion.create({
      data: {
        calculatedFieldId: field.id,
        versionNumber: 1,
        // Se siembran como APPROVED, no PUBLISHED: publicar exige ejecutar los casos de
        // prueba de verdad, y eso lo hace el servicio, no el seeder.
        status: 'APPROVED',
        implementationKind: seed.implementationKind,
        inputsJson: seed.inputs as unknown as Prisma.InputJsonValue,
        returnJson: seed.returns as Prisma.InputJsonValue,
        commentsJson: seed.comments as Prisma.InputJsonValue | undefined,
        operationJson: seed.operation as Prisma.InputJsonValue | undefined,
        sourceCode: seed.sourceCode,
        sourceChecksum: seed.sourceCode
          ? createHash('sha256').update(seed.sourceCode).digest('hex')
          : null,
        contentHash,
        authorId: 'seed@atlas',
        reviewerId: 'seed@atlas',
        approverId: 'seed@atlas',
        testCases: {
          create: seed.testCases.map((testCase) => ({
            name: testCase.name,
            inputsJson: testCase.inputs as Prisma.InputJsonValue,
            expectedJson: testCase.expected as Prisma.InputJsonValue | undefined,
            expectedErrorCode: testCase.expectedErrorCode,
          })),
        },
      },
    });

    for (const wanted of seed.libraries ?? []) {
      const library = await prisma.approvedLibrary.findFirst({
        where: { tenantId: TENANT_ID, logicalName: wanted.logicalName, language: wanted.language },
      });
      if (!library) {
        throw new Error(
          `El campo calculado ${seed.fieldCode} necesita la librería ${wanted.logicalName}/${wanted.language}, que no está sembrada`,
        );
      }
      await prisma.calculatedFieldLibrary.create({
        data: { calculatedFieldVersionId: version.id, approvedLibraryId: library.id },
      });
    }
    seeded.push({ field, version });
  }
  return seeded;
}
