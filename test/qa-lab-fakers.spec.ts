import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ConfigService } from '@nestjs/config';
import type { GeneratorContractVariable } from '../src/modules/qa-lab/contract-generator';
import { fitToContract, semanticRuleFor, tokensOf } from '../src/modules/qa-lab/faker-semantics';
import { QaFakersClient } from '../src/modules/qa-lab/qa-fakers.client';
import { QaFakersService, conditionVariableCodes } from '../src/modules/qa-lab/qa-fakers.service';
import type { CompiledDecisionArtifact } from '../src/modules/graph/graph.types';

/**
 * Los datos de prueba del QA Lab salen de los fakers PARAMETRIZADOS del servidor mock.
 *
 * Lo que se fija aquí:
 * - qué variable del contrato recibe qué dato, por su nombre;
 * - que el contrato sigue mandando (un valor que no cabe se ajusta o se descarta);
 * - que el valor que DEFINE un caso de frontera o inválido no se pisa;
 * - que la misma semilla da el mismo lote;
 * - que si el mock no responde el lote sale igual, del generador local, y lo dice.
 *
 * El mock se simula con un servidor HTTP de verdad en un puerto libre: así se prueba también
 * el cliente (páginas, forma de la respuesta, errores de red), no sólo la lógica.
 */

function persona(index: number, seed: string) {
  return {
    persona: {
      firstName: 'María',
      lastName: 'Choque',
      secondLastName: 'Camacho',
      fullName: `María Choque Camacho ${seed}-${index}`,
      gender: 'F',
      birthDate: '1979-03-04',
      age: 46,
      documentType: 'CI',
      documentNumber: String(5_000_000 + index),
      documentComplement: '',
      documentExtension: 'CB',
      phone: `+5916999${String(index).padStart(4, '0')}`,
      phoneOperator: 'Entel',
      email: `maria.choque.${index}@qa.atlas.test`,
      city: 'La Paz',
      department: 'La Paz',
      address: 'Av. América 2847, Sopocachi',
    },
    direccion: { city: 'La Paz', department: 'La Paz', departmentCode: 'LP', latitude: -16.49 },
    perfilFinanciero: {
      employmentType: 'dependiente',
      employerName: 'Constructora Chiquitana',
      yearsEmployed: 13,
      monthlyIncome: 12_053,
      monthlyExpenses: 8_317,
      currency: 'BOB',
    },
    cuentaBancaria: { bankCode: 'BEC', bankName: 'Banco Económico', accountNumber: '2444866024' },
    dispositivo: { snapshot: { isRooted: false } },
  };
}

interface FakeMock {
  url: string;
  requests: Array<{ path: string; body: Record<string, unknown> }>;
  close: () => Promise<void>;
}

async function startFakeMock(
  respond?: (req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>) => boolean,
): Promise<FakeMock> {
  const requests: FakeMock['requests'] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      requests.push({ path: req.url ?? '', body });
      if (respond?.(req, res, body)) return;
      const count = Number(body.count);
      const seed = String(body.seed);
      const items = Array.from({ length: count }, (_, index) =>
        req.url?.endsWith('/comercio')
          ? { legalName: `Comercial ${seed} ${index} S.A.`, nit: String(800_000_000 + index) }
          : persona(index, seed),
      );
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ schemaVersion: '2.0.0', items }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mock`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function serviceAt(baseUrl: string, timeoutMs = 2_000): QaFakersService {
  const config = {
    get: (key: string) =>
      key === 'QA_FAKERS_BASE_URL'
        ? baseUrl
        : key === 'QA_FAKERS_TIMEOUT_MS'
          ? timeoutMs
          : undefined,
  } as unknown as ConfigService;
  return new QaFakersService(new QaFakersClient(config));
}

const variable = (
  code: string,
  dataType: string,
  constraints: Record<string, unknown> = {},
): GeneratorContractVariable => ({ code, dataType, required: true, nullable: false, constraints });

const CONTRATO = [
  variable('nombre_completo', 'STRING', { maxLength: 80 }),
  variable('ci', 'STRING', { pattern: '^\\d{5,10}$' }),
  variable('celular', 'STRING', { format: 'PHONE' }),
  variable('correo', 'STRING', { format: 'EMAIL' }),
  variable('edad', 'INTEGER', { min: 21, max: 60 }),
  variable('ingreso_mensual', 'DECIMAL', { min: 1_000, max: 10_000 }),
  variable('codigo_interno', 'STRING', { maxLength: 10 }),
];

const base = (index: number) => ({
  kind: 'VALID',
  input: {
    nombre_completo: 'frocuzfzj',
    ci: '12345',
    celular: '+59103040506',
    correo: 'abc@qa.atlas.test',
    edad: 30,
    ingreso_mensual: 5000,
    codigo_interno: `zz${index}`,
  } as Record<string, unknown>,
});

describe('semántica: qué dato corresponde a cada variable', () => {
  it.each([
    ['nombre_completo', 'persona.fullName'],
    ['nombreCliente', 'persona.fullName'],
    ['primer_nombre', 'persona.firstName'],
    ['apellido_paterno', 'persona.lastName'],
    ['segundo_apellido', 'persona.secondLastName'],
    ['ci', 'persona.documentNumber'],
    ['numero_carnet', 'persona.documentNumber'],
    ['tipo_documento', 'persona.documentType'],
    ['ci_expedido', 'persona.documentExtension'],
    ['complemento_ci', 'persona.documentComplement'],
    ['telefono_celular', 'persona.phone'],
    ['email', 'persona.email'],
    ['fecha_nacimiento', 'persona.birthDate'],
    ['edad', 'persona.age'],
    ['ingreso_mensual', 'perfilFinanciero.monthlyIncome'],
    ['gastos_mensuales', 'perfilFinanciero.monthlyExpenses'],
    ['antiguedad_laboral', 'perfilFinanciero.yearsEmployed'],
    ['tipo_empleo', 'perfilFinanciero.employmentType'],
    ['departamento', 'direccion.department'],
    ['ciudad', 'direccion.city'],
    ['direccion', 'persona.address'],
    ['latitud', 'direccion.latitude'],
    ['lon', 'direccion.longitude'],
    ['nombre_banco', 'cuentaBancaria.bankName'],
    ['numero_cuenta', 'cuentaBancaria.accountNumber'],
    ['nit', 'comercio.nit'],
    ['razon_social', 'comercio.legalName'],
  ])('%s → %s', (code, field) => {
    expect(semanticRuleFor(code)?.field).toBe(field);
  });

  it('un ingreso ANUAL es doce veces el mensual', () => {
    const rule = semanticRuleFor('ingreso_anual');
    expect(rule?.field).toBe('perfilFinanciero.monthlyIncome×12');
    expect(rule?.pick({ perfilFinanciero: { monthlyIncome: 1_000 } })).toEqual([12_000]);
  });

  it('lo que no dice qué dato es no se toca', () => {
    for (const code of ['score', 'codigo_interno', 'monto_solicitado', 'plazo_meses', 'flag_a']) {
      expect(semanticRuleFor(code)).toBeNull();
    }
    expect([...tokensOf('ingresoMensualUSD')]).toEqual(['ingreso', 'mensual', 'usd']);
  });
});

describe('el contrato sigue mandando', () => {
  it('prueba las formas del teléfono hasta dar con la que admite el contrato', () => {
    const nacional = variable('celular', 'STRING', { pattern: '^[67]\\d{7}$' });
    expect(fitToContract(nacional, ['+59169994764', '69994764'])).toBe('69994764');
    const entero = variable('celular', 'INTEGER', { min: 60_000_000, max: 79_999_999 });
    expect(fitToContract(entero, ['+59169994764'])).toBe(69_994_764);
  });

  it('lleva un número fuera de rango al borde y respeta los enteros', () => {
    expect(
      fitToContract(variable('ingreso', 'DECIMAL', { min: 1_000, max: 10_000 }), [12_053]),
    ).toBe(10_000);
    expect(fitToContract(variable('edad', 'INTEGER', { min: 21, max: 60 }), [18])).toBe(21);
  });

  it('casa enumeraciones escritas de otra forma y descarta lo que no cabe', () => {
    const genero = variable('genero', 'ENUM', { allowedValues: ['FEMENINO', 'MASCULINO'] });
    expect(
      fitToContract(genero, semanticRuleFor('genero')!.pick({ persona: { gender: 'F' } })),
    ).toBe('FEMENINO');
    const depto = variable('departamento', 'ENUM', { allowedValues: ['LA_PAZ', 'ORURO'] });
    expect(fitToContract(depto, ['La Paz', 'LP'])).toBe('LA_PAZ');
    const corto = variable('nombre', 'STRING', { maxLength: 4 });
    expect(fitToContract(corto, ['María Choque Camacho'])).toBeUndefined();
  });
});

describe('QaFakersService contra un mock simulado', () => {
  let mock: FakeMock;
  beforeEach(async () => {
    mock = await startFakeMock();
  });
  afterEach(async () => {
    await mock.close();
  });

  it('sustituye los valores con significado y deja intacto lo demás', async () => {
    const service = serviceAt(mock.url);
    const cases = [base(0), base(1)];
    const result = await service.enrich(cases, CONTRATO, { seed: 'qa-base' });

    expect(result.fakers.source).toBe('mock');
    expect(result.fakers.types).toEqual(['caso']);
    expect(result.fakers.mappedVariables).toMatchObject({
      ci: 'persona.documentNumber',
      celular: 'persona.phone',
    });
    const [first] = result.cases;
    expect(first.input.nombre_completo).toBe('María Choque Camacho qa-base-0');
    expect(first.input.ci).toBe('5000000');
    expect(first.input.celular).toBe('+59169990000');
    expect(first.input.correo).toBe('maria.choque.0@qa.atlas.test');
    // Ajustado al rango del contrato, no descartado.
    expect(first.input.ingreso_mensual).toBe(10_000);
    // Sin significado reconocible: sigue siendo del generador del contrato.
    expect(first.input.codigo_interno).toBe('zz0');
    // Los casos de entrada no se modifican.
    expect(cases[0].input.nombre_completo).toBe('frocuzfzj');
  });

  it('pide el faker parametrizado por el contrato y con la misma semilla', async () => {
    await serviceAt(mock.url).enrich([base(0)], CONTRATO, { seed: 'qa-regresion' });
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].path).toBe('/mock/fakers/caso');
    expect(mock.requests[0].body).toMatchObject({
      seed: 'qa-regresion',
      count: 1,
      variant: 'valido',
      params: { edadMin: 21, edadMax: 60, ingresoMin: 1_000, ingresoMax: 10_000 },
    });
  });

  it('misma semilla y mismo lote ⇒ mismos valores', async () => {
    const service = serviceAt(mock.url);
    const cases = Array.from({ length: 5 }, (_, index) => base(index));
    const first = await service.enrich(cases, CONTRATO, { seed: 's1' });
    const again = await service.enrich(cases, CONTRATO, { seed: 's1' });
    expect(again.cases).toEqual(first.cases);
  });

  it('no pisa el valor que define un caso de frontera o inválido', async () => {
    const invalid = { kind: 'INVALID', mutation: 'ci: no cumple el patrón', input: base(0).input };
    const result = await serviceAt(mock.url).enrich([invalid], CONTRATO, { seed: 's' });
    expect(result.cases[0].input.ci).toBe('12345');
    expect(result.cases[0].input.nombre_completo).toBe('María Choque Camacho s-0');
  });

  it('en un caso por desenlace no toca lo que el grafo lee', async () => {
    const compiled = {
      nodes: {},
      edgesByNode: {},
      conditions: { c1: { expression: 'input.edad >= 25' } },
      actions: {},
      intermediates: [],
    } as unknown as CompiledDecisionArtifact;
    expect([...conditionVariableCodes(compiled, CONTRATO)]).toEqual(['edad']);
    const outcome = { kind: 'VALID', mutation: 'desenlace: Aprobado', input: base(0).input };
    const result = await serviceAt(mock.url).enrich([outcome], CONTRATO, { seed: 's', compiled });
    expect(result.cases[0].input.edad).toBe(30);
    expect(result.cases[0].input.ci).toBe('5000000');
  });

  it('pide por páginas de 200 con semillas derivadas, sin repetir personas', async () => {
    const cases = Array.from({ length: 450 }, (_, index) => base(index));
    const result = await serviceAt(mock.url).enrich(cases, CONTRATO, { seed: 'grande' });
    expect(mock.requests.map((request) => [request.body.seed, request.body.count])).toEqual([
      ['grande', 200],
      ['grande~1', 200],
      ['grande~2', 50],
    ]);
    expect(result.cases[200].input.nombre_completo).toBe('María Choque Camacho grande~1-0');
  });

  it('pide también el faker de comercio si el contrato lo necesita', async () => {
    const result = await serviceAt(mock.url).enrich(
      [{ kind: 'VALID', input: { razon_social: 'xx', nit: '1' } }],
      [variable('razon_social', 'STRING'), variable('nit', 'STRING', { pattern: '^\\d+$' })],
      { seed: 'c' },
    );
    expect(result.fakers.types).toEqual(['comercio']);
    expect(result.cases[0].input).toEqual({ razon_social: 'Comercial c 0 S.A.', nit: '800000000' });
  });

  it('sin variables con significado no llama al mock y lo dice', async () => {
    const result = await serviceAt(mock.url).enrich(
      [{ kind: 'VALID', input: { score: 500 } }],
      [variable('score', 'INTEGER', { min: 300, max: 900 })],
      { seed: 's' },
    );
    expect(mock.requests).toHaveLength(0);
    expect(result.fakers.source).toBe('none');
    expect(result.fakers.reason).toMatch(/generador del contrato/);
  });
});

describe('si el mock no responde, la corrida sigue con el generador local y lo registra', () => {
  it('servidor apagado: local-fallback con el motivo', async () => {
    const mock = await startFakeMock();
    const url = mock.url;
    await mock.close();
    const cases = [base(0)];
    const result = await serviceAt(url).enrich(cases, CONTRATO, { seed: 's' });
    expect(result.fakers.source).toBe('local-fallback');
    expect(result.fakers.reason).toMatch(/No se pudo conectar con el servidor de fakers/);
    expect(result.fakers.reason).toMatch(/generador local/);
    expect(result.cases).toEqual(cases);
  });

  it('error 422 del mock: se cita su detalle', async () => {
    const mock = await startFakeMock((_req, res) => {
      res.writeHead(422, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ detail: 'La edad mínima no puede ser mayor que la máxima.' }));
      return true;
    });
    const result = await serviceAt(mock.url).enrich([base(0)], CONTRATO, { seed: 's' });
    await mock.close();
    expect(result.fakers.source).toBe('local-fallback');
    expect(result.fakers.reason).toMatch(/respondió 422.*edad mínima/);
  });

  it('respuesta mal formada: no se usa a medias', async () => {
    const mock = await startFakeMock((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ items: [] }));
      return true;
    });
    const result = await serviceAt(mock.url).enrich([base(0)], CONTRATO, { seed: 's' });
    await mock.close();
    expect(result.fakers.source).toBe('local-fallback');
    expect(result.fakers.reason).toMatch(/respuesta inesperada/);
  });

  it('tiempo agotado', async () => {
    const pending: ServerResponse[] = [];
    const mock = await startFakeMock((_req, res) => {
      pending.push(res); // no responde hasta el final de la prueba
      return true;
    });
    const result = await serviceAt(mock.url, 200).enrich([base(0)], CONTRATO, { seed: 's' });
    for (const res of pending) res.end('{}');
    await mock.close();
    expect(result.fakers.source).toBe('local-fallback');
    expect(result.fakers.reason).toMatch(/no respondió en 200 ms/);
  });

  it('URL vacía: fakers desactivados, dicho con palabras', async () => {
    const result = await serviceAt('').enrich([base(0)], CONTRATO, { seed: 's' });
    expect(result.fakers.source).toBe('local-fallback');
    expect(result.fakers.reason).toMatch(/QA_FAKERS_BASE_URL está vacía/);
  });
});

/**
 * Contra el mock REAL (`AtlasExternalProvidersMock`), si se indica dónde está:
 * `QA_FAKERS_MOCK_SERVER=/ruta/a/AtlasExternalProvidersMock/src/server.mjs`. No tiene
 * dependencias, así que basta con `node`. En CI no está y la suite se salta.
 */
const REAL_MOCK = process.env.QA_FAKERS_MOCK_SERVER;
(REAL_MOCK ? describe : describe.skip)('contra el servidor mock real', () => {
  let child: import('node:child_process').ChildProcess | undefined;
  let url = '';

  beforeAll(async () => {
    const { spawn } = await import('node:child_process');
    const port = 4300 + Math.floor(Math.random() * 500);
    child = spawn(process.execPath, [REAL_MOCK as string], {
      env: { ...process.env, MOCK_PROVIDERS_PORT: String(port) },
      stdio: 'ignore',
    });
    url = `http://127.0.0.1:${port}/mock`;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const response = await fetch(`${url}/fakers`);
        if (response.ok) return;
      } catch {
        // todavía arrancando
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('el mock real no arrancó');
  });

  afterAll(() => {
    child?.kill();
  });

  it('da personas bolivianas que cumplen el contrato, y las mismas con la misma semilla', async () => {
    const service = serviceAt(url);
    const cases = Array.from({ length: 20 }, (_, index) => base(index));
    const first = await service.enrich(cases, CONTRATO, { seed: 'qa-base' });
    const again = await service.enrich(cases, CONTRATO, { seed: 'qa-base' });

    expect(first.fakers.source).toBe('mock');
    expect(first.fakers.schemaVersion).toBeTruthy();
    expect(again.cases).toEqual(first.cases);
    for (const { input } of first.cases) {
      expect(input.nombre_completo).toMatch(/^\p{L}+( \p{L}+){2,3}$/u);
      expect(input.ci).toMatch(/^\d{7,8}$/);
      expect(input.celular).toMatch(/^\+591[67]\d{7}$/);
      expect(input.correo).toMatch(/@qa\.atlas\.test$/);
      expect(input.edad as number).toBeGreaterThanOrEqual(21);
      expect(input.edad as number).toBeLessThanOrEqual(60);
      expect(input.ingreso_mensual as number).toBeGreaterThanOrEqual(1_000);
      expect(input.ingreso_mensual as number).toBeLessThanOrEqual(10_000);
    }
    const other = await service.enrich(cases, CONTRATO, { seed: 'qa-regresion' });
    expect(other.cases).not.toEqual(first.cases);
  });
});
