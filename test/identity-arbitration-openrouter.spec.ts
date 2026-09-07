import { OpenRouterChatClient } from '../src/common/llm/openrouter-chat.client';
import { OpenRouterIdentityArbitrationAdapter } from '../src/modules/workers/identity-verification/core/adapters/identity-arbitration.adapter';
import type { IdentityArbitrationRequest } from '../src/modules/workers/identity-verification/core/ports/identity.ports';
import { IdentityDocumentType } from '../src/modules/workers/identity-verification/core/domain/identity-enums';

/**
 * El árbitro de identidad cableado contra OpenRouter, probado en el límite HTTP.
 *
 * Lo que se protege aquí es lo que separa este adaptador del hueco que
 * sustituye: que LLAMA de verdad, que no puede aprobar ni aunque el modelo lo
 * intente, y que cada avería sale firmada con su causa en vez de confundirse
 * con una decisión. Ninguna prueba de este archivo llama a un proveedor de pago.
 */

const PETICION: IdentityArbitrationRequest = {
  correlationId: 'corr-1',
  reason: 'LOW_EVIDENCE',
  detail: 'Se leyó texto compatible con un documento, pero no basta para nombrarlo.',
  documentType: IdentityDocumentType.UNKNOWN,
  evidenceConfidence: 0.31,
  signals: ['MRZ_ABSENT', 'PARTIAL_CATALOG_COVERAGE'],
};

function respuesta(output: Record<string, unknown>, extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      model: 'openai/gpt-4.1-mini',
      provider: 'OpenAI',
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }],
      usage: { prompt_tokens: 120, completion_tokens: 30, cost: 0.00012 },
      ...extra,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function arbitro(respuestas: readonly (() => Response)[]): {
  adapter: OpenRouterIdentityArbitrationAdapter;
  cuerpos: Record<string, unknown>[];
} {
  const cuerpos: Record<string, unknown>[] = [];
  let indice = 0;
  const fetchDoble = ((_url: string, init?: RequestInit): Promise<Response> => {
    if (typeof init?.body === 'string') cuerpos.push(JSON.parse(init.body) as Record<string, unknown>);
    const siguiente = respuestas[Math.min(indice, respuestas.length - 1)];
    indice += 1;
    return Promise.resolve(siguiente());
  }) as unknown as typeof fetch;

  const client = new OpenRouterChatClient({
    apiKey: 'or-de-prueba',
    model: 'openai/gpt-4.1-mini',
    maxAttempts: 1,
    fetchImplementation: fetchDoble,
  });
  return { adapter: new OpenRouterIdentityArbitrationAdapter(client), cuerpos };
}

describe('OpenRouterIdentityArbitrationAdapter', () => {
  it('llama de verdad y transporta el rechazo del modelo', async () => {
    const { adapter, cuerpos } = arbitro([
      () => respuesta({ outcome: 'REJECT_DOCUMENT', rationale: 'Es un recibo de compra.' }),
    ]);

    const veredicto = await adapter.arbitrate(PETICION);

    expect(cuerpos).toHaveLength(1);
    expect(veredicto).toMatchObject({
      outcome: 'REJECT_DOCUMENT',
      decidedBy: 'AI',
      provider: 'openrouter:openai/gpt-4.1-mini@OpenAI',
      rationale: 'Es un recibo de compra.',
    });
  });

  it('NO le ofrece al modelo la opción de aprobar', async () => {
    // La regla del pipeline (degradar un ACCEPT automático) sigue siendo la
    // defensa; ésta comprueba que además no se paga por una opción muerta.
    const { adapter, cuerpos } = arbitro([() => respuesta({ outcome: 'DEFERRED', rationale: 'Dudo.' })]);
    await adapter.arbitrate(PETICION);

    const formato = cuerpos[0]?.response_format as {
      json_schema?: { schema?: { properties?: { outcome?: { enum?: string[] } } } };
    };
    const opciones = formato.json_schema?.schema?.properties?.outcome?.enum ?? [];
    expect(opciones).toEqual(['REJECT_DOCUMENT', 'DEFERRED']);
    expect(opciones).not.toContain('ACCEPT_DOCUMENT');
  });

  it('difiere, y no aprueba, si el modelo se saltara el esquema', async () => {
    const { adapter } = arbitro([
      () => respuesta({ outcome: 'ACCEPT_DOCUMENT', rationale: 'A mí me parece buena.' }),
    ]);

    const veredicto = await adapter.arbitrate(PETICION);
    expect(veredicto.outcome).toBe('DEFERRED');
  });

  it('no manda la imagen ni datos del titular, sólo el dictamen de la puerta', async () => {
    const { adapter, cuerpos } = arbitro([() => respuesta({ outcome: 'DEFERRED', rationale: 'Dudo.' })]);
    await adapter.arbitrate(PETICION);

    const mensajes = cuerpos[0]?.messages as { role: string; content: unknown }[];
    const usuario = mensajes.find((m) => m.role === 'user');
    expect(typeof usuario?.content).toBe('string');
    const enviado = JSON.parse(usuario?.content as string) as Record<string, unknown>;
    expect(Object.keys(enviado).sort()).toEqual([
      'confianzaDeEvidencia',
      'detalle',
      'motivo',
      'senales',
      'tipoDocumentoPropuesto',
    ]);
  });

  it('exige un proveedor que honre el esquema y pide el coste', async () => {
    const { adapter, cuerpos } = arbitro([() => respuesta({ outcome: 'DEFERRED', rationale: 'Dudo.' })]);
    await adapter.arbitrate(PETICION);

    expect(cuerpos[0]?.provider).toEqual({ require_parameters: true });
    expect(cuerpos[0]?.usage).toEqual({ include: true });
    expect(cuerpos[0]?.temperature).toBe(0);
  });

  it('firma el 402 como falta de créditos, distinguible de una avería', async () => {
    const { adapter } = arbitro([
      () =>
        new Response(
          JSON.stringify({ error: { code: 402, message: 'Insufficient credits. Add more using…' } }),
          { status: 402, headers: { 'content-type': 'application/json' } },
        ),
    ]);

    const veredicto = await adapter.arbitrate(PETICION);
    expect(veredicto.outcome).toBe('DEFERRED');
    expect(veredicto.provider).toBe('openrouter-sin-creditos');
    expect(veredicto.rationale).toMatch(/No quedan créditos/u);
  });

  it('una caída del proveedor deja el caso en la bandeja, con otra firma', async () => {
    const { adapter } = arbitro([
      () => new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }),
    ]);

    const veredicto = await adapter.arbitrate(PETICION);
    expect(veredicto).toMatchObject({
      outcome: 'DEFERRED',
      provider: 'openrouter-no-disponible',
    });
  });

  it('health() mira el saldo con GET /key y no gasta tokens', async () => {
    const llamadas: string[] = [];
    const fetchDoble = ((url: string): Promise<Response> => {
      llamadas.push(url);
      return Promise.resolve(
        new Response(JSON.stringify({ data: { limit_remaining: 0 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;

    const adapter = new OpenRouterIdentityArbitrationAdapter(
      new OpenRouterChatClient({
        apiKey: 'or-de-prueba',
        model: 'openai/gpt-4.1-mini',
        fetchImplementation: fetchDoble,
      }),
    );

    await expect(adapter.health()).resolves.toMatchObject({ ready: false });
    expect(llamadas).toEqual(['https://openrouter.ai/api/v1/key']);
  });

  it('no se puede construir el cliente sin credencial', () => {
    expect(
      () => new OpenRouterChatClient({ apiKey: '   ', model: 'openai/gpt-4.1-mini' }),
    ).toThrow(/OPENROUTER_API_KEY/u);
  });
});
