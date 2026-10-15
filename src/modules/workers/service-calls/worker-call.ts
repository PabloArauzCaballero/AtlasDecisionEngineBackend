import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../../common/errors/domain-exception';
import type { AuthenticatedPrincipal } from '../../../common/security/security.types';
import type { WorkerServiceOutcome, WorkerServiceRequest } from '../../graph/graph.types';
import { StatementProcessingError } from '../bank-statement/core/domain/errors';
import { AudioDomainError } from '../audio-tts/core/domain/errors';

/** Una llamada de un nodo `WORKER`, con quién la pide y desde cuándo corre. */
export interface WorkerServiceCall {
  tenantId: bigint;
  principal: AuthenticatedPrincipal;
  request: WorkerServiceRequest;
  started: number;
  /** El `context` de la petición de decisión (ver `WorkerServiceInvokerService.bind`). */
  context: Readonly<Record<string, unknown>> | null;
}

/** Quien sabe ejecutar UNA operación de un servicio worker llamada desde un nodo. */
export interface WorkerServiceHandler {
  /** `servicio.operación`, tal como la declara el nodo. */
  readonly key: string;
  handle(call: WorkerServiceCall): Promise<WorkerServiceOutcome>;
}

/** Techo absoluto de una llamada desde un nodo, en milisegundos. */
export const MAX_CALL_TIMEOUT_MS = 120_000;

/**
 * Un servicio apagado en este despliegue no puede invocarse desde un nodo.
 *
 * Se comprueba con la MISMA bandera que publica el catálogo `/v1/workers`: si la interfaz
 * dice que la capacidad no está disponible, un algoritmo tampoco debe poder usarla por
 * detrás. La bandera gobierna la capacidad, no el proceso: una réplica de API con el
 * trabajo de fondo apagado (`WORKER_ROLE=api`) sigue pudiendo atender esta llamada.
 */
export function assertAvailable(service: string, available: boolean, nodeKey: string): void {
  if (available) return;
  throw new DomainException(
    'WORKER_SERVICE_UNAVAILABLE',
    `El nodo ${nodeKey} llama al servicio ${service}, que no está habilitado en este despliegue`,
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

/**
 * Un binario que viaja en base64 dentro de una variable de la decisión.
 *
 * Lo comparten los dos servicios que reciben archivos, y comparten también la
 * comprobación de ida y vuelta: `Buffer.from` con base64 ignora en silencio lo
 * que no reconoce, así que una cadena que no es base64 produciría un búfer
 * corto —y una imagen «válida» de trescientos bytes— en vez de un error.
 */
export function decodeBase64(
  request: WorkerServiceRequest,
  argumento: string,
  servicio: string,
): Buffer {
  const encoded = stringArgument(request, argumento);
  if (!encoded) {
    throw new DomainException(
      'WORKER_ARGUMENT_MISSING',
      `El nodo ${request.nodeKey} llama a ${servicio} sin el argumento ${argumento}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  // `Buffer.from` con base64 ignora en silencio lo que no reconoce, así que una cadena
  // que no es base64 produciría un búfer corto en vez de un error. Se comprueba el
  // viaje de ida y vuelta, que es la única señal fiable sin traer un validador nuevo.
  const buffer = Buffer.from(encoded, 'base64');
  if (
    !buffer.byteLength ||
    buffer.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')
  ) {
    throw new DomainException(
      'WORKER_ARGUMENT_INVALID',
      `El argumento ${argumento} que el nodo ${request.nodeKey} envía no es base64 válido`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return buffer;
}

/** El nodo puede pedir menos tiempo que el servicio, nunca más. */
export function timeoutFor(request: WorkerServiceRequest, serviceCeilingMs: number): number {
  const ceiling = Math.min(serviceCeilingMs, MAX_CALL_TIMEOUT_MS);
  if (!request.timeoutMs || request.timeoutMs <= 0) return ceiling;
  return Math.min(request.timeoutMs, ceiling);
}

/**
 * Acota la llamada.
 *
 * El motor de extractos tiene su propio presupuesto para la EXTRACCIÓN del PDF, pero no
 * para el análisis completo; sin esta cota, un documento patológico podría tener una
 * decisión —y su petición HTTP— esperando indefinidamente.
 */
export async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  request: WorkerServiceRequest,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new DomainException(
                'WORKER_SERVICE_TIMEOUT',
                `La llamada del nodo ${request.nodeKey} a ${request.service}.${request.operation} superó ${timeoutMs} ms`,
                HttpStatus.GATEWAY_TIMEOUT,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Las variables de la plantilla, saneadas a `Record<string, string>`.
 *
 * Un nodo puede proyectar aquí cualquier valor de la decisión —un número, una fecha—, así
 * que se convierten a texto en vez de rechazarlos: locutar «tu saldo es 1500» es un caso
 * legítimo. Lo que NO se convierte son objetos y arrays, que sólo pueden venir de un error
 * de cableado y acabarían diciendo «[object Object]» en voz alta.
 */
export function variablesArgument(request: WorkerServiceRequest): Record<string, string> {
  const raw = request.arguments.variables;
  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object')
    .map(([key, value]) => [key, String(value)] as const);
  return Object.fromEntries(entries);
}

export function stringArgument(request: WorkerServiceRequest, name: string): string | undefined {
  const value = request.arguments[name];
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text.length ? text : undefined;
}

/**
 * Traduce el fallo del núcleo a una excepción de dominio conservando su código.
 *
 * El código importa: es lo que acaba en `call.errorCode` de la traza y lo que permite que
 * un algoritmo con `onError: CONTINUE` distinga «el PDF no era un extracto» de «el
 * servicio tardó demasiado».
 */
export function toDomainException(error: unknown, request: WorkerServiceRequest): DomainException {
  if (error instanceof DomainException) return error;
  if (error instanceof StatementProcessingError) {
    return new DomainException(error.code, error.message, error.httpStatus, error.details);
  }
  // Una plantilla inexistente o una variable inválida son culpa de quien llama, no del
  // motor: viajan con su código y con 422, para que un `onError: CONTINUE` pueda
  // distinguirlas de que el proveedor de voz se cayera.
  if (error instanceof AudioDomainError) {
    return new DomainException(error.code, error.message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
  return new DomainException(
    'WORKER_SERVICE_FAILED',
    `La llamada del nodo ${request.nodeKey} a ${request.service}.${request.operation} falló: ` +
      (error instanceof Error ? error.message : String(error)),
    HttpStatus.BAD_GATEWAY,
  );
}
