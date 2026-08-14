import { ConfigService } from '@nestjs/config';
import { IdentityProviderClient } from '../src/common/security/identity-provider.client';

/**
 * Un tiempo de espera agotado NO prueba que la petición no llegara.
 *
 * El cliente reintentaba ante cualquier error de red con el argumento de que
 * «el proveedor no contestó, así que repetir no puede duplicar nada». Con
 * `/internal/auth/login` eso es falso: el proveedor emite el PIN y se lo entrega
 * al correo, y eso tarda más que los 3 s por omisión. La primera llamada se
 * abortaba DESPUÉS de que el PIN se hubiera enviado, el reintento emitía otro
 * —y emitir uno nuevo invalida el anterior—, así que llegaban dos correos y el
 * del primero ya no servía. Medido: un POST /v1/session/login, dos filas en
 * `auth_one_time_codes` con 1,6 s de diferencia.
 */

function cliente(extra: Record<string, unknown> = {}): IdentityProviderClient {
  return new IdentityProviderClient(
    new ConfigService({
      IDENTITY_PROVIDER_URL: 'http://localhost:3005/api/v1',
      IDENTITY_PROVIDER_TIMEOUT_MS: 3_000,
      IDENTITY_PROVIDER_LOGIN_TIMEOUT_MS: 12_000,
      IDENTITY_PROVIDER_RETRY_ATTEMPTS: 2,
      IDENTITY_PROVIDER_RETRY_BACKOFF_MS: 0,
      ...extra,
    }),
  );
}

const credenciales = { tenantId: '1', email: 'operador@example.com', password: 'secreto' };

function agotado(): DOMException {
  return new DOMException('The operation was aborted due to timeout', 'TimeoutError');
}

function rechazada(): Error {
  return Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
}

describe('reintentos del cliente del proveedor de identidad', () => {
  afterEach(() => jest.restoreAllMocks());

  it('NO repite un login cuya espera se agotó: repetirlo manda un segundo PIN', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(agotado());

    await expect(cliente().login(credenciales)).rejects.toMatchObject({
      code: 'IDENTITY_PROVIDER_UNAVAILABLE',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sí repite cuando la conexión fue rechazada: ahí no llegó nada', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(rechazada());

    await expect(cliente().login(credenciales)).rejects.toMatchObject({
      code: 'IDENTITY_PROVIDER_UNAVAILABLE',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  /*
   * Un error que no se reconoce se trata como «pudo haber llegado». Adivinar al
   * revés es lo que duplica efectos, y repetir un login a mano cuesta mucho menos
   * que un segundo PIN que mata al primero en silencio.
   */
  it('ante un error desconocido no repite', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('vaya'));

    await expect(cliente().login(credenciales)).rejects.toMatchObject({
      code: 'IDENTITY_PROVIDER_UNAVAILABLE',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('el login espera más que una lectura, porque además manda un correo', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(agotado());
    // `AbortSignal.timeout(ms)` no publica su plazo, así que se observa la
    // llamada: lo que importa es que los dos caminos no pidan el mismo número.
    const espia = jest.spyOn(AbortSignal, 'timeout');

    await expect(cliente().login(credenciales)).rejects.toBeDefined();
    await expect(cliente().profile('token-de-acceso')).rejects.toBeDefined();

    expect(espia.mock.calls.map(([ms]) => ms)).toEqual([12_000, 3_000]);
  });
});
