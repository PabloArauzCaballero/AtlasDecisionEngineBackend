import fc from 'fast-check';
import {
  generateBoundaryValue,
  generateCases,
  generateInvalidValue,
  generateValidValue,
  type GeneratorContractVariable,
} from '../src/modules/qa-lab/contract-generator';
import { buildValidValue } from '../src/modules/qa-lab/contract-value-factory';
import { sampleForPattern } from '../src/modules/qa-lab/pattern-samples';
import { SeededRandom } from '../src/modules/qa-lab/seeded-random';
import {
  parseConstraints,
  validateAgainstConstraints,
} from '../src/common/contracts/constraint-engine';

/**
 * El generador prometía «valores que cumplen el contrato» y no cumplía: ignoraba
 * `pattern`, sólo conocía tres de los siete formatos, dejaba que el mínimo de longitud
 * por defecto pisara un `maxLength` más pequeño, no miraba `precision` ni `itemType`, y
 * proponía como «frontera» el 0 de un porcentaje acotado a 20–80.
 *
 * Estas pruebas fijan la única promesa que importa: un VÁLIDO y un FRONTERA pasan el
 * mismo juez que ejecutará después, y un INVÁLIDO no. Cada caso concreto de abajo es una
 * regresión de un defecto real, no un ejemplo inventado.
 */
const variable = (
  overrides: Partial<GeneratorContractVariable> = {},
): GeneratorContractVariable => ({
  code: 'v',
  dataType: 'STRING',
  required: true,
  nullable: false,
  ...overrides,
});

const violationsOf = (definition: GeneratorContractVariable, value: unknown) =>
  validateAgainstConstraints(definition.dataType, parseConstraints(definition.constraints), value);

const isValid = (definition: GeneratorContractVariable, value: unknown) =>
  violationsOf(definition, value).length === 0;

/** Falla con el valor y el motivo, que es lo que hace falta para arreglar el generador. */
const expectValid = (definition: GeneratorContractVariable, value: unknown) => {
  const violations = violationsOf(definition, value);
  expect({ value, violations: violations.map((violation) => violation.constraint) }).toEqual({
    value,
    violations: [],
  });
};

const seeded = (label: string) => new SeededRandom(label);

describe('restricciones de texto que antes se ignoraban', () => {
  it('un valor válido casa con el `pattern` declarado', () => {
    const definition = variable({
      dataType: 'CODE',
      constraints: { pattern: '^[A-Z]{3}-\\d{4}$' },
    });
    for (let index = 0; index < 30; index += 1) {
      const value = generateValidValue(definition, seeded(`patron-${index}`));
      expect(String(value)).toMatch(/^[A-Z]{3}-\d{4}$/);
      expectValid(definition, value);
    }
  });

  it.each(['EMAIL', 'UUID', 'URL', 'PHONE', 'IBAN', 'ISO_COUNTRY', 'ISO_CURRENCY'])(
    'un valor válido cumple el formato %s',
    (format) => {
      const definition = variable({ constraints: { format } });
      for (let index = 0; index < 15; index += 1) {
        expectValid(definition, generateValidValue(definition, seeded(`${format}-${index}`)));
      }
    },
  );

  it('un `maxLength` menor que el mínimo por defecto se respeta', () => {
    // Antes: el mínimo por defecto (3) ganaba y se generaban 3 caracteres para maxLength 2.
    for (const maxLength of [0, 1, 2, 3]) {
      const definition = variable({ constraints: { maxLength } });
      for (let index = 0; index < 10; index += 1) {
        const value = generateValidValue(definition, seeded(`corto-${maxLength}-${index}`));
        expect(String(value).length).toBeLessThanOrEqual(maxLength);
        expectValid(definition, value);
      }
    }
  });

  it('un IDENTIFIER corto no fuerza sus 8 caracteres por encima del máximo', () => {
    const definition = variable({ dataType: 'IDENTIFIER', constraints: { maxLength: 5 } });
    for (let index = 0; index < 10; index += 1) {
      expectValid(definition, generateValidValue(definition, seeded(`ident-${index}`)));
    }
  });

  it('respeta una longitud exacta larga', () => {
    const definition = variable({ constraints: { minLength: 40, maxLength: 40 } });
    const value = generateValidValue(definition, seeded('exacta'));
    expect(String(value)).toHaveLength(40);
  });
});

describe('restricciones numéricas que antes se ignoraban', () => {
  it('respeta `precision` junto a `scale`', () => {
    // DECIMAL(4,2) admite como mucho 99,99; antes se generaba hasta 10 000.
    const definition = variable({ dataType: 'DECIMAL', constraints: { precision: 4, scale: 2 } });
    for (let index = 0; index < 40; index += 1) {
      const value = generateValidValue(definition, seeded(`precision-${index}`)) as number;
      expect(Math.abs(value)).toBeLessThanOrEqual(99.99);
      expectValid(definition, value);
    }
  });

  it('no cae por debajo del mínimo al redondear con escala 0', () => {
    // `random.float` redondea DESPUÉS de acotar: con escala 0 un 1,45 sorteado dentro del
    // rango se convertía en 1 y quedaba por debajo de min = 1,4.
    const definition = variable({
      dataType: 'DECIMAL',
      constraints: { min: 1.4, max: 2.6, scale: 0 },
    });
    for (let index = 0; index < 40; index += 1) {
      expectValid(definition, generateValidValue(definition, seeded(`escala0-${index}`)));
    }
  });

  it('respeta los límites abiertos aunque la escala sea entera', () => {
    const definition = variable({
      dataType: 'DECIMAL',
      constraints: { exclusiveMin: 5, exclusiveMax: 10, scale: 0 },
    });
    for (let index = 0; index < 40; index += 1) {
      const value = generateValidValue(definition, seeded(`abierto-${index}`)) as number;
      expect(value).toBeGreaterThan(5);
      expect(value).toBeLessThan(10);
    }
  });

  it('un porcentaje acotado no se sale de su propio rango', () => {
    const definition = variable({ dataType: 'PERCENTAGE', constraints: { min: 20, max: 80 } });
    for (let index = 0; index < 40; index += 1) {
      expectValid(definition, generateValidValue(definition, seeded(`pct-${index}`)));
    }
  });
});

describe('listas', () => {
  it('genera elementos del `itemType` declarado', () => {
    const definition = variable({
      dataType: 'LIST',
      constraints: { itemType: 'STRING', minItems: 2, maxItems: 4 },
    });
    for (let index = 0; index < 20; index += 1) {
      const value = generateValidValue(definition, seeded(`lista-${index}`)) as unknown[];
      expect(value.every((item) => typeof item === 'string')).toBe(true);
      expectValid(definition, value);
    }
  });

  it('respeta `unique` y el número de elementos', () => {
    const definition = variable({
      dataType: 'LIST',
      constraints: { itemType: 'INTEGER', minItems: 3, maxItems: 3, unique: true },
    });
    for (let index = 0; index < 20; index += 1) {
      const value = generateValidValue(definition, seeded(`unica-${index}`)) as unknown[];
      expect(value).toHaveLength(3);
      expect(new Set(value).size).toBe(3);
    }
  });
});

describe('valores de frontera', () => {
  it('un porcentaje acotado nunca propone 0 ni 100 como límite', () => {
    // Este era el defecto más visible: «en el límite» devolvía 0 para un contrato 20–80.
    const definition = variable({ dataType: 'PERCENTAGE', constraints: { min: 20, max: 80 } });
    for (let index = 0; index < 40; index += 1) {
      const boundary = generateBoundaryValue(definition, seeded(`borde-pct-${index}`));
      expect(boundary).not.toBeNull();
      expect([20, 80]).toContain(boundary!.value);
    }
  });

  it('un rango con enumeración cerrada solo propone valores enumerados', () => {
    const definition = variable({
      dataType: 'INTEGER',
      constraints: { min: 0, max: 100, allowedValues: [10, 20, 30] },
    });
    for (let index = 0; index < 40; index += 1) {
      const boundary = generateBoundaryValue(definition, seeded(`borde-enum-${index}`));
      expect(boundary).not.toBeNull();
      expect([10, 20, 30]).toContain(boundary!.value);
    }
  });

  it('el borde de longitud sigue casando con el patrón', () => {
    const definition = variable({
      dataType: 'CODE',
      constraints: { pattern: '^[A-Z]{2,8}$', minLength: 2, maxLength: 8 },
    });
    for (let index = 0; index < 30; index += 1) {
      const boundary = generateBoundaryValue(definition, seeded(`borde-patron-${index}`));
      if (boundary) expectValid(definition, boundary.value);
    }
  });

  it('propone el primer valor dentro de un límite abierto', () => {
    const definition = variable({
      dataType: 'INTEGER',
      constraints: { exclusiveMin: 17, exclusiveMax: 65 },
    });
    const values = new Set(
      Array.from(
        { length: 60 },
        (_, index) => generateBoundaryValue(definition, seeded(`abierto-${index}`))?.value,
      ),
    );
    expect([...values]).toEqual(expect.arrayContaining([18, 64]));
  });
});

describe('valores inválidos', () => {
  it('un valor inválido es siempre rechazado, sea cual sea el contrato', () => {
    fc.assert(
      fc.property(
        contractArbitrary(),
        fc.string({ minLength: 1, maxLength: 8 }),
        (definition, seed) => {
          const invalid = generateInvalidValue(definition, new SeededRandom(seed));
          return invalid === null || !isValid(definition, invalid.value);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('propiedad general sobre contratos arbitrarios', () => {
  it('todo valor VÁLIDO satisface el contrato, o se declara insatisfacible', () => {
    fc.assert(
      fc.property(
        contractArbitrary(),
        fc.string({ minLength: 1, maxLength: 8 }),
        (definition, seed) => {
          const generated = buildValidValue(definition, new SeededRandom(seed));
          // `satisfied: false` es la salida honesta de un contrato contradictorio; lo que no
          // se admite es devolver un valor inválido diciendo que es válido.
          return generated.satisfied === isValid(definition, generated.value);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('todo valor de FRONTERA satisface el contrato', () => {
    fc.assert(
      fc.property(
        contractArbitrary(),
        fc.string({ minLength: 1, maxLength: 8 }),
        (definition, seed) => {
          const boundary = generateBoundaryValue(definition, new SeededRandom(seed));
          return boundary === null || isValid(definition, boundary.value);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('en un lote completo, ningún caso VÁLIDO lleva una entrada que el contrato rechace', () => {
    const contract = [
      variable({ code: 'correo', constraints: { format: 'EMAIL' } }),
      variable({ code: 'codigo', dataType: 'CODE', constraints: { pattern: '^[A-Z]{3}-\\d{2}$' } }),
      variable({
        code: 'tasa',
        dataType: 'PERCENTAGE',
        constraints: { min: 5, max: 40, scale: 1 },
      }),
      variable({ code: 'importe', dataType: 'DECIMAL', constraints: { precision: 6, scale: 2 } }),
      variable({
        code: 'etiquetas',
        dataType: 'LIST',
        constraints: { itemType: 'STRING', minItems: 1, maxItems: 3, unique: true },
      }),
    ];
    const byCode = new Map(contract.map((entry) => [entry.code, entry]));
    const cases = generateCases(contract, seeded('lote-completo'), 60, {
      validPercent: 60,
      boundaryPercent: 40,
      invalidPercent: 0,
    });

    for (const generated of cases) {
      expect(generated.unsatisfiable).toBeUndefined();
      for (const [code, value] of Object.entries(generated.input)) {
        expectValid(byCode.get(code)!, value);
      }
    }
  });

  it('un contrato contradictorio se denuncia en vez de disimularse', () => {
    // Un correo no cabe en cuatro caracteres: no hay valor válido posible.
    const contract = [variable({ code: 'correo', constraints: { format: 'EMAIL', maxLength: 4 } })];
    const [generated] = generateCases(contract, seeded('imposible'), 1, {
      validPercent: 100,
      boundaryPercent: 0,
      invalidPercent: 0,
    });
    expect(generated.unsatisfiable).toEqual(['correo']);
  });
});

describe('muestreo de patrones', () => {
  it.each([
    '^[A-Z]{3}-\\d{4}$',
    '^\\d{2}/\\d{2}/\\d{4}$',
    '^(BO|PE|CL)-[a-z0-9]{5,8}$',
    '^[A-Za-z]+@[a-z]+\\.(com|test)$',
    '^\\+?591[0-9]{7,8}$',
    '^[^0-9]{4}$',
    'ABC',
  ])('produce una cadena que casa con %s', (pattern) => {
    const value = sampleForPattern(pattern, seeded(`p-${pattern}`));
    expect(value).not.toBeNull();
    expect(value!).toMatch(new RegExp(pattern));
  });

  it('devuelve null en vez de inventar cuando el patrón no se soporta', () => {
    // Retrorreferencia y lookahead: no se pueden satisfacer construyendo de izquierda a
    // derecha, y devolver una cadena cualquiera es exactamente el defecto que se corrige.
    expect(sampleForPattern('^(a)\\1$', seeded('back'))).toBeNull();
    expect(sampleForPattern('^(?=.*\\d)[a-z]+$', seeded('look'))).toBeNull();
  });

  it('es determinista para la misma semilla', () => {
    const build = () => sampleForPattern('^[A-Z]{4}-\\d{3}$', seeded('fija'));
    expect(build()).toBe(build());
  });

  it('honra el filtro de aceptación', () => {
    const value = sampleForPattern(
      '^[a-z]{2,10}$',
      seeded('filtro'),
      (candidate) => candidate.length === 7,
    );
    expect(value).toHaveLength(7);
  });
});

/** Contratos arbitrarios: tipos del catálogo cruzados con restricciones compatibles. */
function contractArbitrary(): fc.Arbitrary<GeneratorContractVariable> {
  const numeric = fc
    .record(
      {
        min: fc.integer({ min: -50, max: 50 }),
        span: fc.integer({ min: 0, max: 200 }),
        scale: fc.integer({ min: 0, max: 3 }),
        precision: fc.option(fc.integer({ min: 2, max: 8 }), { nil: undefined }),
      },
      { requiredKeys: ['min', 'span', 'scale'] },
    )
    .map(({ min, span, scale, precision }) => ({
      dataType: 'DECIMAL',
      constraints: { min, max: min + span, scale, precision },
    }));

  const percentage = fc
    .tuple(fc.integer({ min: 0, max: 60 }), fc.integer({ min: 0, max: 40 }))
    .map(([min, span]) => ({
      dataType: 'PERCENTAGE',
      constraints: { min, max: min + span },
    }));

  const text = fc
    .record(
      {
        minLength: fc.integer({ min: 0, max: 12 }),
        span: fc.integer({ min: 0, max: 20 }),
        format: fc.option(
          fc.constantFrom('EMAIL', 'UUID', 'URL', 'PHONE', 'IBAN', 'ISO_COUNTRY', 'ISO_CURRENCY'),
          { nil: undefined },
        ),
      },
      { requiredKeys: ['minLength', 'span'] },
    )
    .map(({ minLength, span, format }) => ({
      dataType: 'STRING',
      // Un formato trae su propia longitud; combinarlo con una longitud estrecha genera
      // justo los contratos contradictorios que la propiedad debe saber declarar.
      constraints: format ? { format } : { minLength, maxLength: minLength + span },
    }));

  const patterned = fc
    .constantFrom('^[A-Z]{3}\\d{2}$', '^[a-z]{4,9}$', '^(SI|NO)$', '^\\d{6}$')
    .map((pattern) => ({ dataType: 'CODE', constraints: { pattern } }));

  const list = fc
    .tuple(
      fc.integer({ min: 0, max: 4 }),
      fc.integer({ min: 0, max: 4 }),
      fc.constantFrom('INTEGER', 'STRING', 'BOOLEAN', 'DECIMAL', 'DATE'),
      fc.boolean(),
    )
    .map(([minItems, span, itemType, unique]) => ({
      dataType: 'LIST',
      constraints: { minItems, maxItems: minItems + span, itemType, unique },
    }));

  const enumerated = fc
    .constantFrom(
      { dataType: 'ENUM', constraints: { allowedValues: ['APROBADO', 'RECHAZADO'] } },
      { dataType: 'INTEGER', constraints: { min: 0, max: 100, allowedValues: [10, 20, 30] } },
    )
    .map((entry) => entry);

  const plain = fc
    .constantFrom('BOOLEAN', 'DATE', 'DATETIME', 'TIME', 'OBJECT', 'IDENTIFIER', 'INTEGER')
    .map((dataType) => ({ dataType, constraints: {} as Record<string, unknown> }));

  return fc
    .oneof(numeric, percentage, text, patterned, list, enumerated, plain)
    .map((entry) => variable(entry as Partial<GeneratorContractVariable>));
}
