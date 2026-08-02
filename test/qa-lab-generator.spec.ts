import { faker } from '@faker-js/faker';
import fc from 'fast-check';
import {
  distribute,
  generateCases,
  generateBoundaryValue,
  generateInvalidValue,
  generateValidValue,
  type GeneratorContractVariable,
} from '../src/modules/qa-lab/contract-generator';
import { SeededRandom, generateSeed } from '../src/modules/qa-lab/seeded-random';
import { shrinkCounterexample } from '../src/modules/qa-lab/qa-properties';
import {
  parseConstraints,
  validateAgainstConstraints,
} from '../src/common/contracts/constraint-engine';
import { DATA_TYPES } from '../src/common/contracts/data-types';

/**
 * El QA Lab solo sirve si sus propios generadores son correctos: un generador que
 * produce "valores válidos" que el contrato rechaza llenaría el informe de falsos
 * positivos y nadie volvería a mirarlo. Estas pruebas fijan justo eso, y usan
 * fast-check para comprobarlo sobre contratos generados, no sobre tres ejemplos.
 */
const variable = (
  overrides: Partial<GeneratorContractVariable> = {},
): GeneratorContractVariable => ({
  code: 'v',
  dataType: 'DECIMAL',
  required: true,
  nullable: false,
  ...overrides,
});

const isValid = (definition: GeneratorContractVariable, value: unknown) =>
  validateAgainstConstraints(definition.dataType, parseConstraints(definition.constraints), value)
    .length === 0;

describe('reproducibilidad de la semilla', () => {
  it('la misma semilla produce exactamente la misma secuencia', () => {
    const first = Array.from({ length: 20 }, () => new SeededRandom('semilla-fija').next());
    const second = Array.from({ length: 20 }, () => new SeededRandom('semilla-fija').next());
    expect(first).toEqual(second);
  });

  it('semillas distintas divergen', () => {
    expect(new SeededRandom('a').next()).not.toBe(new SeededRandom('b').next());
  });

  it('el mismo lote se regenera idéntico a partir de la semilla', () => {
    const contract = [variable({ code: 'ingreso', constraints: { min: 0, max: 10_000 } })];
    const build = () =>
      generateCases(contract, new SeededRandom('lote-1'), 25, {
        validPercent: 60,
        invalidPercent: 25,
        boundaryPercent: 15,
      });
    expect(build()).toEqual(build());
  });

  it('generateSeed es estable para la misma fuente', () => {
    expect(generateSeed('version-9:req-1')).toBe(generateSeed('version-9:req-1'));
  });
});

describe('generación guiada por contrato', () => {
  it('un valor válido siempre satisface las restricciones declaradas', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 501, max: 5_000 }),
        fc.string({ minLength: 1, maxLength: 10 }),
        (min, max, seed) => {
          const definition = variable({ constraints: { min, max, scale: 2 } });
          const value = generateValidValue(definition, new SeededRandom(seed));
          return isValid(definition, value);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('un valor válido de un entero acotado nunca sale del rango', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 100 }), fc.string({ minLength: 1 }), (min, seed) => {
        const definition = variable({ dataType: 'INTEGER', constraints: { min, max: min + 50 } });
        const value = generateValidValue(definition, new SeededRandom(seed)) as number;
        return Number.isInteger(value) && value >= min && value <= min + 50;
      }),
      { numRuns: 200 },
    );
  });

  it('respeta una enumeración cerrada', () => {
    const definition = variable({
      dataType: 'ENUM',
      constraints: { allowedValues: ['APROBADO', 'RECHAZADO', 'REVISION'] },
    });
    for (let index = 0; index < 30; index += 1) {
      expect(['APROBADO', 'RECHAZADO', 'REVISION']).toContain(
        generateValidValue(definition, new SeededRandom(`s${index}`)),
      );
    }
  });

  it('genera valores válidos para todos los tipos del catálogo', () => {
    for (const dataType of DATA_TYPES) {
      const definition = variable({ dataType });
      const value = generateValidValue(definition, new SeededRandom(`tipo-${dataType}`));
      expect(isValid(definition, value)).toBe(true);
    }
  });

  it('un valor inválido siempre es rechazado por el contrato', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000 }),
        fc.string({ minLength: 1, maxLength: 10 }),
        (max, seed) => {
          const definition = variable({ constraints: { min: 0, max } });
          const invalid = generateInvalidValue(definition, new SeededRandom(seed));
          return invalid !== null && !isValid(definition, invalid.value);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('un valor de frontera está en el límite pero sigue siendo válido', () => {
    const definition = variable({ constraints: { min: 10, max: 90 } });
    for (let index = 0; index < 30; index += 1) {
      const boundary = generateBoundaryValue(definition, new SeededRandom(`b${index}`));
      expect(boundary).not.toBeNull();
      expect(isValid(definition, boundary!.value)).toBe(true);
      expect([10, 90]).toContain(boundary!.value);
    }
  });

  it('produce casos de texto vacío y texto excesivamente largo', () => {
    const definition = variable({
      dataType: 'STRING',
      constraints: { minLength: 3, maxLength: 8 },
    });
    const mutations = new Set<string>();
    for (let index = 0; index < 60; index += 1) {
      mutations.add(generateInvalidValue(definition, new SeededRandom(`t${index}`))!.mutation);
    }
    expect([...mutations]).toEqual(
      expect.arrayContaining(['texto vacío', 'texto excesivamente largo']),
    );
  });
});

describe('distribución de valores por variable (§10.4)', () => {
  /** Media de 400 valores válidos generados con la distribución indicada. */
  const meanOf = (
    definition: GeneratorContractVariable,
    distribution?: { shape?: 'UNIFORM' | 'LOW_TAIL' | 'HIGH_TAIL' | 'CENTERED' | 'EXTREMES' },
  ) => {
    const random = new SeededRandom('distribucion');
    const values = Array.from(
      { length: 400 },
      () => generateValidValue(definition, random, distribution) as number,
    );
    return values.reduce((a, b) => a + b, 0) / values.length;
  };

  const income = variable({ code: 'ingreso', constraints: { min: 0, max: 10_000, scale: 2 } });

  it('LOW_TAIL concentra los valores en la cola baja y HIGH_TAIL en la alta', () => {
    const low = meanOf(income, { shape: 'LOW_TAIL' });
    const uniform = meanOf(income, { shape: 'UNIFORM' });
    const high = meanOf(income, { shape: 'HIGH_TAIL' });
    expect(low).toBeLessThan(uniform);
    expect(high).toBeGreaterThan(uniform);
    // Un reparto uniforme deja la media en el centro; sesgar tiene que moverla de verdad,
    // no solo cambiar los valores concretos.
    expect(low).toBeLessThan(5_000);
    expect(high).toBeGreaterThan(5_000);
  });

  it('EXTREMES vacía el centro y CENTERED lo llena', () => {
    const random = new SeededRandom('formas');
    const inMiddle = (shape: 'EXTREMES' | 'CENTERED') =>
      Array.from(
        { length: 400 },
        () => generateValidValue(income, random, { shape }) as number,
      ).filter((value) => value > 3_000 && value < 7_000).length;
    expect(inMiddle('CENTERED')).toBeGreaterThan(inMiddle('EXTREMES'));
  });

  it('sesgar NO relaja el contrato: todo valor sigue siendo válido', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('UNIFORM', 'LOW_TAIL', 'HIGH_TAIL', 'CENTERED', 'EXTREMES' as const),
        fc.integer({ min: 0, max: 500 }),
        fc.string({ minLength: 1, maxLength: 10 }),
        (shape, min, seed) => {
          const definition = variable({ constraints: { min, max: min + 1_000, scale: 2 } });
          const value = generateValidValue(definition, new SeededRandom(seed), {
            shape: shape as 'UNIFORM',
          });
          return isValid(definition, value);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('los pesos sesgan una enumeración sin sacar valores de ella', () => {
    const definition = variable({
      dataType: 'ENUM',
      constraints: { allowedValues: ['BAJO', 'MEDIO', 'ALTO'] },
    });
    const random = new SeededRandom('pesos');
    const counts: Record<string, number> = { BAJO: 0, MEDIO: 0, ALTO: 0 };
    for (let index = 0; index < 600; index += 1) {
      const value = generateValidValue(definition, random, {
        valueWeights: { BAJO: 8, MEDIO: 1, ALTO: 1 },
      }) as string;
      counts[value] += 1;
    }
    expect(Object.keys(counts).every((key) => ['BAJO', 'MEDIO', 'ALTO'].includes(key))).toBe(true);
    expect(counts.BAJO).toBeGreaterThan(counts.MEDIO + counts.ALTO);
  });

  it('un peso 0 excluye ese valor sin romper el generador', () => {
    const definition = variable({
      dataType: 'ENUM',
      constraints: { allowedValues: ['SI', 'NO'] },
    });
    const random = new SeededRandom('excluir');
    const values = new Set(
      Array.from(
        { length: 100 },
        () => generateValidValue(definition, random, { valueWeights: { NO: 0 } }) as string,
      ),
    );
    expect([...values]).toEqual(['SI']);
  });

  it('una corrida SIN distribuciones sigue siendo bit a bit la de antes', () => {
    // UNIFORM consume exactamente un valor del flujo, igual que la versión previa del
    // generador: una corrida archivada sin sesgos tiene que reproducirse idéntica.
    const definition = variable({ constraints: { min: 0, max: 1_000, scale: 2 } });
    const withoutDistribution = generateValidValue(definition, new SeededRandom('igual'));
    const withUniform = generateValidValue(definition, new SeededRandom('igual'), {
      shape: 'UNIFORM',
    });
    expect(withUniform).toBe(withoutDistribution);
  });

  it('el lote completo con distribuciones se regenera idéntico desde la semilla', () => {
    const contract = [income, variable({ code: 'plazo', dataType: 'INTEGER' })];
    const build = () =>
      generateCases(
        contract,
        new SeededRandom('lote-sesgado'),
        30,
        { validPercent: 100, invalidPercent: 0, boundaryPercent: 0 },
        { ingreso: { shape: 'LOW_TAIL' } },
      );
    expect(build()).toEqual(build());
  });
});

describe('reparto del lote', () => {
  it('el total repartido coincide siempre con el total pedido', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2_000 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (total, validPercent, invalidPercent, boundaryPercent) => {
          const kinds = distribute(total, { validPercent, invalidPercent, boundaryPercent });
          return kinds.length === total;
        },
      ),
      { numRuns: 300 },
    );
  });

  it('con 100 % inválidos no genera ningún caso válido', () => {
    const kinds = distribute(50, { validPercent: 0, invalidPercent: 100, boundaryPercent: 0 });
    expect(new Set(kinds)).toEqual(new Set(['INVALID']));
  });
});

describe('reducción del contraejemplo', () => {
  it('elimina los campos que no influyen en el fallo', async () => {
    const failing = { culpable: 999, ruido1: 'a', ruido2: 'b', ruido3: 5 };
    const shrunk = await shrinkCounterexample(
      failing,
      async (candidate) => candidate.culpable === 999,
    );
    expect(shrunk).toEqual({ culpable: 999 });
  });

  it('simplifica los valores numéricos manteniendo el fallo', async () => {
    const shrunk = await shrinkCounterexample(
      { n: 987_654 },
      async (candidate) => typeof candidate.n === 'number',
    );
    expect(shrunk.n).toBe(0);
  });

  it('no reduce nada si cualquier cambio hace desaparecer el fallo', async () => {
    const original = { a: 7, b: 'exacto' };
    const shrunk = await shrinkCounterexample(
      original,
      async (candidate) => candidate.a === 7 && candidate.b === 'exacto',
    );
    expect(shrunk).toEqual(original);
  });
});

describe('datos sintéticos con Faker', () => {
  it('genera solicitudes sintéticas completas y deterministas por semilla', () => {
    const build = () => {
      faker.seed(4242);
      return {
        solicitante: faker.person.fullName(),
        documento: faker.string.alphanumeric({ length: 9, casing: 'upper' }),
        correo: faker.internet.email(),
        ingresoMensual: faker.number.float({ min: 500, max: 25_000, fractionDigits: 2 }),
        deudaMensual: faker.number.float({ min: 0, max: 8_000, fractionDigits: 2 }),
        fechaNacimiento: faker.date.birthdate().toISOString().slice(0, 10),
        pais: faker.location.countryCode(),
      };
    };
    const first = build();
    expect(build()).toEqual(first);
    // Los datos son sintéticos y deben poder distinguirse de información real.
    expect(first.correo).toMatch(/@/);
    expect(first.ingresoMensual).toBeGreaterThanOrEqual(500);
  });

  it('produce lotes masivos sin colisiones de identificador', () => {
    faker.seed(7);
    const ids = new Set(Array.from({ length: 2_000 }, () => faker.string.uuid()));
    expect(ids.size).toBe(2_000);
  });
});
