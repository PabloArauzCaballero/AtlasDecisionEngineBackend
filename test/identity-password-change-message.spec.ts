import { ConfigService } from '@nestjs/config';
import { IdentityProviderClient } from '../src/common/security/identity-provider.client';
import { DomainException } from '../src/common/errors/domain-exception';

/**
 * El mensaje que ve quien cambia su contraseña.
 *
 * `send` vuelve opacos los 4xx del proveedor a propósito: en el login, distinguir «contraseña
 * incorrecta» de «tenant inexistente» es un oráculo de enumeración, y esa opacidad se ganó
 * corrigiendo un defecto real. Pero aplicada al cambio de contraseña no protege nada —quien llama
 * ya está autenticado y pregunta por SU cuenta— y sí rompe la pantalla: el portal mostraba
 * «Invalid identity request» cuando lo ocurrido era que la contraseña actual estaba mal escrita.
 *
 * Medido en navegador el 2026-08-20 antes de la corrección.
 */
describe('Mensajes del cambio de contraseña contra el proveedor', () => {
  const config = {
    get: (key: string) => (key === 'IDENTITY_PROVIDER_URL' ? 'http://identity.test/api/v1' : undefined),
  } as unknown as ConfigService;

  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function respondWith(status: number, body: unknown) {
    global.fetch = (async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
  }

  it('propaga el motivo del rechazo, con su estado', async () => {
    respondWith(400, { error: { code: 'BAD_REQUEST', message: 'La contraseña actual no es correcta.' } });
    const client = new IdentityProviderClient(config);

    const error = await client.requestPasswordChange('token', 'la-que-no-es').catch((caught) => caught);

    expect(error).toBeInstanceOf(DomainException);
    expect((error as DomainException).message).toBe('La contraseña actual no es correcta.');
    expect((error as DomainException).status).toBe(400);
  });

  it('propaga también el 429 del cooldown, que la pantalla necesita distinguir', async () => {
    respondWith(429, {
      error: { message: 'Ya te enviamos un código hace menos de un minuto. Revisa tu correo antes de pedir otro.' },
    });
    const client = new IdentityProviderClient(config);

    const error = await client.requestPasswordChange('token', 'correcta').catch((caught) => caught);

    expect((error as DomainException).status).toBe(429);
    expect((error as DomainException).message).toContain('menos de un minuto');
  });

  it('sin mensaje del proveedor no inventa uno específico', async () => {
    respondWith(400, {});
    const client = new IdentityProviderClient(config);

    const error = await client.requestPasswordChange('token', 'x').catch((caught) => caught);

    expect((error as DomainException).message).toBe('El proveedor de identidad rechazó la operación.');
  });

  it('devuelve el desafío cuando el proveedor acepta', async () => {
    respondWith(200, {
      data: { pinChallengeRequired: true, challengeToken: 'x'.repeat(24), expiresInMinutes: 10 },
    });
    const client = new IdentityProviderClient(config);

    const challenge = await client.requestPasswordChange('token', 'correcta');

    expect(challenge.pinChallengeRequired).toBe(true);
    expect(challenge.expiresInMinutes).toBe(10);
  });
});
