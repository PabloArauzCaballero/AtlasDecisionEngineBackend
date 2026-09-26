/**
 * La puerta del generador documental cuando corre suelto.
 *
 * Existe por un hallazgo medido contra el contenedor en marcha:
 *
 *     GET  :3000/pdf/templates  → 401   (dentro del motor: lo cubre su APP_GUARD)
 *     GET  :3100/pdf/templates  → 200   (suelto: no lo cubría nada)
 *     POST :3100/pdf/generate   → 422   (validación; o sea, pasó de largo la autenticación)
 *
 * El 422 es lo que lo delata: un cuerpo vacío llegó hasta el validador de payload. Si hubiera
 * habido autenticación, la petición habría muerto antes con un 401.
 *
 * Estas pruebas fijan las cuatro cosas que impiden que vuelva: que sin clave se rechaza, que
 * con la clave correcta se pasa, que la sonda de vida sigue abierta —el HEALTHCHECK del
 * Dockerfile la llama sin cabeceras— y que declararse suelto sin configurar clave ABORTA el
 * arranque en vez de degradar a modo abierto.
 */
import { ExecutionContext } from '@nestjs/common';
import {
  assertServiceAuthConfigured,
  ServiceAuthGuard,
  type ServiceAuthConfig,
} from '../src/pdf-worker/presentation/http/service-auth.guard';
import { ServiceUnauthorizedError } from '../src/pdf-worker/domain/errors/pdf-worker.errors';
import { loadPdfWorkerEnv } from '../src/pdf-worker/infrastructure/config/pdf-worker.env';

const CLAVE = 'clave-de-servicio-suficientemente-larga-32';

function contexto(path: string, headers: Record<string, string> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ path, headers }) }),
  } as unknown as ExecutionContext;
}

function guardia(config: Partial<ServiceAuthConfig> = {}): ServiceAuthGuard {
  return new ServiceAuthGuard({
    enabled: true,
    apiKey: CLAVE,
    header: 'x-pdf-service-key',
    ...config,
  });
}

describe('ServiceAuthGuard', () => {
  it('rechaza el catálogo sin credencial', () => {
    // La petición exacta que devolvía 200 con plantillas clasificadas CONFIDENTIAL.
    expect(() => guardia().canActivate(contexto('/pdf/templates'))).toThrow(
      ServiceUnauthorizedError,
    );
  });

  it('rechaza la generación sin credencial, ANTES de validar el payload', () => {
    // El hallazgo original: un cuerpo vacío llegaba al validador y volvía con 422. Que el
    // guardia lance aquí es lo que garantiza que hoy muere antes.
    expect(() => guardia().canActivate(contexto('/pdf/generate'))).toThrow(
      ServiceUnauthorizedError,
    );
    expect(() => guardia().canActivate(contexto('/pdf/preview'))).toThrow(ServiceUnauthorizedError);
  });

  it('rechaza una clave que no coincide', () => {
    expect(() =>
      guardia().canActivate(contexto('/pdf/templates', { 'x-pdf-service-key': 'otra-cosa' })),
    ).toThrow(ServiceUnauthorizedError);
  });

  it('deja pasar con la clave correcta', () => {
    expect(guardia().canActivate(contexto('/pdf/templates', { 'x-pdf-service-key': CLAVE }))).toBe(
      true,
    );
  });

  it('deja pasar la sonda de vida sin credencial', () => {
    // El HEALTHCHECK del Dockerfile llama sin cabeceras. Publica estado de vida, no datos.
    expect(guardia().canActivate(contexto('/pdf/health'))).toBe(true);
  });

  it('la exención de la sonda es por ruta COMPLETA, no por prefijo', () => {
    // Con `startsWith`, un futuro `/pdf/health-detallado` entraría solo por parecerse de
    // nombre. La lista es cerrada y se compara entera.
    expect(() => guardia().canActivate(contexto('/pdf/healthcheck-dump'))).toThrow(
      ServiceUnauthorizedError,
    );
  });

  it('una clave vacía en configuración no autentica a nadie', () => {
    // Defensa en profundidad: el esquema de entorno ya impide arrancar así, pero si alguien
    // construyera el guardia a mano con `apiKey: ''`, una cabecera vacía no debe colar.
    expect(() =>
      guardia({ apiKey: '' }).canActivate(contexto('/pdf/templates', { 'x-pdf-service-key': '' })),
    ).toThrow(ServiceUnauthorizedError);
  });

  it('apagada explícitamente, deja pasar todo', () => {
    // Es la única salida para un despliegue donde algo delante ya autentica. Tiene que ser una
    // decisión escrita (`PDF_SERVICE_AUTH_ENABLED=false`), no el resultado de no configurar.
    expect(guardia({ enabled: false }).canActivate(contexto('/pdf/generate'))).toBe(true);
  });
});

describe('Configuración de la puerta del servicio', () => {
  const BASE = { PDF_TEMPLATE_ENGINE: 'handlebars' } as NodeJS.ProcessEnv;

  it('viene ENCENDIDA por omisión', () => {
    const env = loadPdfWorkerEnv({ ...BASE });
    expect(env.PDF_SERVICE_AUTH_ENABLED).toBe(true);
    expect(env.PDF_SERVICE_HEADER).toBe('x-pdf-service-key');
  });

  it('el esquema NO exige la clave: dentro del motor no hay ninguna', () => {
    // Es la parte contraintuitiva y la que más importa. `loadPdfWorkerEnv` también corre cuando
    // el módulo se monta dentro del motor, donde autentica el APP_GUARD del anfitrión. Exigir
    // ahí la clave habría impedido arrancar el motor entero por una credencial que no usa: un
    // endurecimiento que rompe el caso bueno no es endurecimiento.
    expect(() => loadPdfWorkerEnv({ ...BASE })).not.toThrow();
  });

  it('en modo SUELTO, sin clave se aborta el arranque', () => {
    // Un servicio que se abre solo cuando le falta la clave es un servicio sin autenticación
    // con pasos extra. Se cae con el nombre de la variable, y se cae al arrancar.
    expect(() => assertServiceAuthConfigured({ enabled: true })).toThrow(/PDF_SERVICE_API_KEY/);
    expect(() => assertServiceAuthConfigured({ enabled: true, apiKey: 'corta' })).toThrow(
      /PDF_SERVICE_API_KEY/,
    );
  });

  it('en modo suelto con clave suficiente, arranca', () => {
    expect(() => assertServiceAuthConfigured({ enabled: true, apiKey: CLAVE })).not.toThrow();
  });

  it('apagarla a propósito permite arrancar sin clave', () => {
    // La única salida para un despliegue donde algo delante ya autentica, y tiene que ser una
    // decisión escrita en una variable, no el resultado de no configurar nada.
    expect(() => assertServiceAuthConfigured({ enabled: false })).not.toThrow();
    expect(
      loadPdfWorkerEnv({ ...BASE, PDF_SERVICE_AUTH_ENABLED: 'false' }).PDF_SERVICE_AUTH_ENABLED,
    ).toBe(false);
  });
});
