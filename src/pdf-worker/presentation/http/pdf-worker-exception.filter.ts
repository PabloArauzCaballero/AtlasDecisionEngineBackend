/**
 * Traduce los errores del dominio a HTTP, con la forma RFC 7807 que ya usa el motor.
 *
 * Aquí es donde el `httpStatus` numérico del dominio se convierte en una respuesta. Que la
 * traducción viva en la capa de presentación es lo que permite que el MISMO error viaje por la
 * cola asíncrona y por el SDK en proceso sin arrastrar Express detrás.
 *
 * Un error que no es del catálogo NO se detalla: se responde 500 con un identificador y el
 * motivo queda en el registro. Un mensaje de excepción sin filtrar puede llevar una ruta del
 * sistema de archivos, una consulta o un fragmento del payload.
 */
import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { PdfWorkerError } from '../../domain/errors/pdf-worker.errors';

/**
 * Acotado a `PdfWorkerError`, y no un `@Catch()` sin argumentos.
 *
 * Lo era, y estaba mal de una forma que costó encontrar: montado dentro del
 * motor, un filtro que atrapa TODO se traga también las excepciones del
 * anfitrión. El guardia de autenticación rechazaba con su `DomainException`
 * —un 401 perfectamente explicado— y este filtro, que no la reconoce, la
 * convertía en «El generador documental no pudo completar la operación», 500.
 * El portal veía un 500 opaco donde había un problema de credencial, y la
 * pantalla se quedaba sin plantillas sin decir por qué.
 *
 * Con el filtro acotado, cada capa responde de lo suyo: los errores del
 * generador salen con su código y su remedio, y todo lo demás sigue hasta el
 * filtro global del anfitrión, que es quien sabe traducirlo. En el proceso
 * suelto ese papel lo hace el filtro que registra `src/pdf-worker.ts`.
 */
@Catch(PdfWorkerError)
export class PdfWorkerExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('PdfWorkerHttp');

  catch(exception: PdfWorkerError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    // Los 5xx del generador se registran: son defectos del despliegue —plantillas
    // que no viajaron, navegador caído— y nadie los va a ver si sólo viajan en la
    // respuesta. Los 4xx no, porque son la conversación normal con un cliente que
    // manda algo que no vale, y llenarían el registro sin informar de nada.
    if (exception.httpStatus >= 500) {
      this.logger.error({
        message: 'El generador documental rechazó una operación',
        code: exception.code,
        reason: exception.message,
        details: exception.details,
      });
    }

    response.status(exception.httpStatus).json({
      type: `https://atlas.local/errors/${exception.code.toLowerCase()}`,
      title: exception.code,
      status: exception.httpStatus,
      detail: exception.message,
      code: exception.code,
      errors: exception.details,
    });
  }
}
