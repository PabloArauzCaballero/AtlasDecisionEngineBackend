import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { numeroDeConfig } from '../config/config-coercion.util';
import { DomainException } from '../errors/domain-exception';
import { unauthorized } from './identity-provider.session';

/**
 * Cómo se habla con el proveedor de identidad: URL, plazos por tipo de llamada, reintentos sólo
 * cuando la petición demostrablemente no llegó, y traducción de los estados HTTP a errores de
 * dominio opacos.
 */
export class IdentityProviderTransport {
  constructor(private readonly config: ConfigService) {}

  async request(path: string, init: RequestInit): Promise<unknown> {
    return (await this.send(path, init)).payload;
  }

  /**
   * Igual que `request`, pero dejando pasar el MENSAJE del proveedor cuando rechaza.
   *
   * `send` vuelve opacos los 4xx a propósito: en el login, distinguir «contraseña mala» de
   * «tenant inexistente» es un oráculo de enumeración. En el cambio de contraseña esa razón
   * desaparece —quien llama ya está autenticado y pregunta por SU cuenta—, y el precio de la
   * opacidad es una pantalla que dice «Invalid identity request» cuando lo que pasó es que la
   * contraseña actual estaba mal escrita. Aquí sí se propaga, con el mismo estado y el texto que
   * el proveedor redactó para la persona.
   */
  async requestPropagatingMessage(
    path: string,
    init: RequestInit,
    timeoutMs = numeroDeConfig(this.config, 'IDENTITY_PROVIDER_TIMEOUT_MS', 3_000),
  ): Promise<unknown> {
    const baseUrl = this.config.get<string>('IDENTITY_PROVIDER_URL');
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      // Same product header as `send`: every route here makes the provider mail a code, and the
      // mail names the portal from this header.
      headers: {
        ...(init.headers as Record<string, string>),
        'x-atlas-product': 'decision-engine',
      },
      signal: AbortSignal.timeout(timeoutMs),
    }).catch(() => null);

    if (!response) {
      throw new DomainException(
        'IDENTITY_PROVIDER_UNAVAILABLE',
        'Identity provider is unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const payload: unknown = await response.json().catch(() => null);
    if (response.ok) return (payload as { data?: unknown })?.data ?? payload;

    const message =
      (payload as { error?: { message?: string } } | null)?.error?.message ??
      'El proveedor de identidad rechazó la operación.';
    throw new DomainException('IDENTITY_REQUEST_REJECTED', message, response.status);
  }

  async send(path: string, init: RequestInit): Promise<{ payload: unknown; response: Response }> {
    const baseUrl = this.config.get<string>('IDENTITY_PROVIDER_URL')?.replace(/\/+$/, '');
    if (!baseUrl) {
      throw new DomainException(
        'IDENTITY_PROVIDER_NOT_CONFIGURED',
        'Identity provider is not configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    /*
     * El login tiene su propio presupuesto: firma la contraseña y, con segundo factor, emite el
     * PIN y se lo entrega al canal de correo. Medido, ~4,7 s contra el proveedor local, por
     * encima de los 3 s que le sobran a cualquier lectura.
     */
    const esLogin = path.startsWith('/internal/auth/login');
    const timeoutMs = esLogin
      ? numeroDeConfig(this.config, 'IDENTITY_PROVIDER_LOGIN_TIMEOUT_MS', 12_000)
      : numeroDeConfig(this.config, 'IDENTITY_PROVIDER_TIMEOUT_MS', 3_000);
    const maxAttempts = numeroDeConfig(this.config, 'IDENTITY_PROVIDER_RETRY_ATTEMPTS', 2) + 1;
    const backoffMs = numeroDeConfig(this.config, 'IDENTITY_PROVIDER_RETRY_BACKOFF_MS', 300);

    // Bodies are always strings (JSON.stringify) or absent, so `init` is safe to reuse across
    // attempts. Only transient failures retry — a rejected credential (401) surfaces immediately.
    let response: Response;
    for (let attempt = 1; ; attempt++) {
      try {
        response = await fetch(`${baseUrl}${path}`, {
          ...init,
          // Se identifica al motor en TODAS las llamadas, y no en cada una por separado, porque
          // quien redacta los correos de código es el proveedor: sin esta cabecera su membrete
          // lleva un rótulo genérico y quien recibe un PIN no sabe a qué portal está entrando.
          headers: {
            ...(init.headers as Record<string, string>),
            'x-atlas-product': 'decision-engine',
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        /*
         * Retry only when the request PROVABLY never reached the provider.
         *
         * This used to retry on any thrown error, on the premise that "the provider never
         * answered, so a retry cannot double any side effect". That premise is false for a
         * timeout, and it produced a real defect: `/internal/auth/login` mails a PIN, and
         * mailing takes longer than the 3 s default, so the first attempt aborted AFTER the
         * provider had already issued and sent the code. The retry issued a second one — and
         * because issuing a PIN invalidates the previous, the operator received two mails of
         * which the FIRST one no longer worked. Measured: one POST /v1/session/login, two rows
         * in `auth_one_time_codes` 1,6 s apart.
         *
         * A refused connection is different in kind: nothing was written to the socket, so
         * nothing on the other side happened. That is the failure a dev server produces while
         * it restarts, which is what the retry was for.
         */
        if (attempt < maxAttempts && this.neverArrived(error)) {
          await this.backoff(backoffMs * attempt);
          continue;
        }
        throw new DomainException(
          'IDENTITY_PROVIDER_UNAVAILABLE',
          'Identity provider is unavailable',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      // 502/503/504 are the provider (or a proxy) reporting itself momentarily unavailable — retry.
      // Every other non-2xx is a definitive answer and must not be retried.
      if (
        (response.status === 502 || response.status === 503 || response.status === 504) &&
        attempt < maxAttempts
      ) {
        await this.backoff(backoffMs * attempt);
        continue;
      }
      break;
    }
    if (!response.ok) {
      if (response.status === 400)
        throw new DomainException(
          'IDENTITY_REQUEST_INVALID',
          'Invalid identity request',
          HttpStatus.BAD_REQUEST,
        );
      /*
       * 404 and 409 are the provider saying "no such account here", not "I am broken".
       *
       * A 404 is an unknown user; a 409 is a tenant that does not exist or does not match
       * the credential (measured: the provider answers 409 for an unknown `x-tenant-id`).
       * Both are definitive answers from a HEALTHY provider, so they belong with 401/403.
       *
       * They used to fall through to BAD_GATEWAY, and that was wrong twice over. Operationally
       * a 502 means "the identity provider is down": it fires retries, alerts and an on-call
       * page for what is really a typo in the tenant box. And for the caller it is an
       * enumeration oracle — a wrong password answered 401 while a wrong tenant answered 502,
       * so the pair of responses told an attacker which tenants exist. Mapping both to the
       * same opaque 401 removes the signal.
       */
      if (
        response.status === 401 ||
        response.status === 403 ||
        response.status === 404 ||
        response.status === 409
      )
        throw unauthorized();
      if (response.status === 429)
        throw new DomainException(
          'IDENTITY_RATE_LIMITED',
          'Too many authentication attempts',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      throw new DomainException(
        'IDENTITY_PROVIDER_ERROR',
        'Identity provider rejected the request',
        HttpStatus.BAD_GATEWAY,
      );
    }
    try {
      const payload: unknown = await response.json();
      if (payload !== null && typeof payload === 'object' && 'data' in payload) {
        return { payload: (payload as { data: unknown }).data, response };
      }
      return { payload, response };
    } catch {
      throw new DomainException(
        'IDENTITY_PROVIDER_INVALID_RESPONSE',
        'Identity provider returned an invalid response',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
  /**
   * Whether the request demonstrably never reached the provider.
   *
   * `AbortSignal.timeout` rejects with a `TimeoutError`, and that only says WE stopped waiting:
   * the provider may have finished the work — issued a PIN, mailed it, rotated a token — and be
   * writing the response. A refused or reset connection is the opposite: the socket never
   * carried the request, so repeating it is free.
   *
   * Anything unrecognised is treated as "it may have arrived". Guessing the other way is what
   * duplicates side effects, and a login the operator has to repeat is a far smaller cost than
   * a second PIN that silently kills the first.
   */
  private neverArrived(error: unknown): boolean {
    if (error instanceof DOMException && error.name === 'TimeoutError') return false;
    const causa = (error as { cause?: { code?: string } })?.cause?.code;
    return (
      causa === 'ECONNREFUSED' ||
      causa === 'ENOTFOUND' ||
      causa === 'EAI_AGAIN' ||
      causa === 'ECONNRESET'
    );
  }

  private backoff(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
