/**
 * El contrato HTTP contra un servidor de verdad.
 *
 * Las demás pruebas del gateway sustituyen `fetch`, y eso deja fuera justo la
 * capa que más falla al integrar: cabeceras reales, cuerpo serializado de
 * verdad, códigos de estado emitidos por un servidor y plazos que vencen contra
 * un socket abierto. Aquí se levanta un LiteLLM **falso pero real** —un
 * `http.Server` que habla la interfaz de OpenAI— y el adaptador le habla por la
 * pila de red del proceso.
 *
 * No consume tokens de ningún proveedor y no necesita Docker: puede correr en
 * CI en cada commit, que es la única forma de que un fallo de contrato se note
 * antes del despliegue.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import { LiteLlmSemanticProvider } from '../src/modules/workers/semantic-analysis/core/infrastructure/litellm/litellm-semantic.provider';
import type {
  ModelClassificationInput,
  SemanticCategory,
} from '../src/modules/workers/semantic-analysis/core/domain/semantic-analysis.types';

function categoria(code: string): SemanticCategory {
  return {
    id: code,
    code,
    name: code,
    description: code,
    parentCode: null,
    positiveExamples: [],
    counterExamples: [],
    restrictions: [],
    relatedCategoryCodes: [],
    acceptanceThreshold: 0.8,
    version: 1,
  };
}

const ENTRADA: ModelClassificationInput = {
  originalText: 'PAGO POS 000834 HIPERMAXI EQUIPETROL SCZ 23992',
  normalizedText: 'HIPERMAXI EQUIPETROL',
  entities: [],
  candidates: [{ category: categoria('GASTOS.SUPERMERCADO'), retrievalScore: 0.9 }],
};

interface PeticionRecibida {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly contentType: string | undefined;
  readonly body: Record<string, unknown>;
}

type Manejador = (peticion: PeticionRecibida, response: ServerResponse) => void | Promise<void>;

let server: Server;
let baseUrl: string;
let recibidas: PeticionRecibida[];
let manejador: Manejador;

beforeAll(async () => {
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const trozos: Buffer[] = [];
    request.on('data', (trozo: Buffer) => trozos.push(trozo));
    request.on('end', () => {
      const crudo = Buffer.concat(trozos).toString('utf8');
      const peticion: PeticionRecibida = {
        method: request.method ?? '',
        url: request.url ?? '',
        authorization: request.headers.authorization,
        contentType: request.headers['content-type'],
        body: crudo === '' ? {} : (JSON.parse(crudo) as Record<string, unknown>),
      };
      recibidas.push(peticion);
      void manejador(peticion, response);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/v1`;
});

afterAll(async () => {
  server.close();
  await once(server, 'close');
});

beforeEach(() => {
  recibidas = [];
});

function proveedor(
  overrides: Partial<{ maxAttempts: number; timeoutMs: number }> = {},
): LiteLlmSemanticProvider {
  return new LiteLlmSemanticProvider({
    apiKey: 'sk-master-de-prueba',
    baseUrl,
    fastModel: 'semantic-classifier-fast',
    deepModel: 'semantic-classifier-deep',
    maxAttempts: overrides.maxAttempts ?? 1,
    ...(overrides.timeoutMs === undefined ? {} : { timeoutMs: overrides.timeoutMs }),
    initialBackoffMs: 1,
    maxBackoffMs: 5,
    randomSource: () => 0,
  });
}

function responder(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

const RESPUESTA_VALIDA = {
  id: 'chatcmpl-abc',
  object: 'chat.completion',
  model: 'gemini-2.0-flash',
  choices: [
    {
      index: 0,
      finish_reason: 'stop',
      message: {
        role: 'assistant',
        content: JSON.stringify({
          assessments: [
            {
              categoryCode: 'GASTOS.SUPERMERCADO',
              confidence: 0.96,
              supported: true,
              contradicted: false,
              evidence: ['HIPERMAXI'],
              rationale: 'Cadena de supermercados boliviana.',
            },
          ],
        }),
      },
    },
  ],
  usage: { prompt_tokens: 388, completion_tokens: 41, total_tokens: 429 },
};

describe('contrato HTTP contra un LiteLLM Proxy simulado', () => {
  it('completa el viaje de ida y vuelta por la pila de red real', async () => {
    manejador = (_peticion, response) => {
      responder(response, 200, RESPUESTA_VALIDA);
    };

    const resultado = await proveedor().classify(ENTRADA, 'FAST');

    expect(resultado.assessments[0].categoryCode).toBe('GASTOS.SUPERMERCADO');
    expect(resultado.model).toBe('semantic-classifier-fast');
    expect(resultado.modelVersion).toBe('gemini-2.0-flash');
    expect(resultado.usage?.totalTokens).toBe(429);
  });

  it('emite POST /v1/chat/completions con Bearer y JSON, como espera el proxy', async () => {
    manejador = (_peticion, response) => {
      responder(response, 200, RESPUESTA_VALIDA);
    };

    await proveedor().classify(ENTRADA, 'FAST');

    const peticion = recibidas[0];
    expect(peticion.method).toBe('POST');
    expect(peticion.url).toBe('/v1/chat/completions');
    expect(peticion.authorization).toBe('Bearer sk-master-de-prueba');
    expect(peticion.contentType).toBe('application/json');
    expect(peticion.body.model).toBe('semantic-classifier-fast');
    expect(peticion.body.temperature).toBe(0);
  });

  it('el cuerpo NO lleva nada que el gateway no necesite para clasificar', async () => {
    manejador = (_peticion, response) => {
      responder(response, 200, RESPUESTA_VALIDA);
    };

    await proveedor().classify(ENTRADA, 'FAST');

    const serializado = JSON.stringify(recibidas[0].body);
    expect(serializado).not.toContain('acceptanceThreshold');
    expect(serializado).not.toContain('retrievalScore');
    expect(serializado).not.toContain('tenantId');
  });

  it('un 503 del gateway se reintenta y se recupera si el suplente responde', async () => {
    let intento = 0;
    manejador = (_peticion, response) => {
      intento += 1;
      if (intento === 1) {
        responder(response, 503, { error: { code: 'service_unavailable' } });
        return;
      }
      responder(response, 200, RESPUESTA_VALIDA);
    };

    const resultado = await proveedor({ maxAttempts: 2 }).classify(ENTRADA, 'FAST');

    expect(recibidas).toHaveLength(2);
    expect(resultado.assessments).toHaveLength(1);
  });

  it('un alias que el gateway no conoce falla SIN reintento', async () => {
    manejador = (_peticion, response) => {
      // Es lo que responde LiteLLM cuando el `model_name` no está en su model_list.
      responder(response, 400, {
        error: { message: 'Invalid model name passed in', code: 'model_not_found' },
      });
    };

    await expect(proveedor({ maxAttempts: 3 }).classify(ENTRADA, 'FAST')).rejects.toMatchObject({
      retryable: false,
    });
    expect(recibidas).toHaveLength(1);
  });

  it('un gateway que no contesta vence por plazo y no cuelga la petición de negocio', async () => {
    manejador = () => {
      // Nunca responde: el socket queda abierto hasta que el adaptador aborta.
    };

    const error = await proveedor({ maxAttempts: 1, timeoutMs: 1_000 })
      .classify(ENTRADA, 'FAST')
      .then(
        () => undefined,
        (e: unknown) => e as Error,
      );

    expect(error).toMatchObject({ code: 'SEMANTIC_PROVIDER_ERROR', retryable: true });
    expect(error?.message).toContain('1000 ms');
  });

  it('el presupuesto del análisis corta una llamada en vuelo', async () => {
    manejador = () => {
      /* sin respuesta */
    };
    const budget = AbortSignal.timeout(150);

    const error = await proveedor({ maxAttempts: 1, timeoutMs: 60_000 })
      .classify(ENTRADA, 'FAST', budget)
      .then(
        () => undefined,
        (e: unknown) => e as Error,
      );

    expect(error).toMatchObject({ code: 'SEMANTIC_PROVIDER_ERROR', retryable: false });
  });

  it('una conexión rechazada llega como fallo reintentable del proveedor', async () => {
    const caido = new LiteLlmSemanticProvider({
      apiKey: 'sk-master-de-prueba',
      // Puerto cerrado: es el `ECONNREFUSED` de un gateway que no está levantado.
      baseUrl: 'http://127.0.0.1:1/v1',
      fastModel: 'semantic-classifier-fast',
      deepModel: 'semantic-classifier-deep',
      maxAttempts: 1,
    });

    await expect(caido.classify(ENTRADA, 'FAST')).rejects.toMatchObject({
      code: 'SEMANTIC_PROVIDER_ERROR',
      retryable: true,
    });
  });
});
