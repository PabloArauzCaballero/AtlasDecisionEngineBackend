/**
 * Crear algo que ya existe es 409, no 500.
 *
 * Una violación del índice único que ningún servicio traducía llegaba al filtro como error
 * desconocido y salía como `INTERNAL_ERROR`. Tres consecuencias, todas malas: el llamante no
 * podía distinguir "corrige el código duplicado" de "el servidor se cayó", el código no
 * entraba en el catálogo de errores, y el mensaje incluía la consulta de Prisma y la ruta del
 * archivo compilado.
 *
 * Lo detectó el smoke integral (`authoring.artifacts-create.invalid.duplicate-code`), y se
 * observó también en variables, motivos de decisión y objetivos de negocio.
 */
import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { DomainExceptionFilter } from '../src/common/errors/domain-exception.filter';

function hostFor() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status, setHeader: jest.fn(), headersSent: false };
  const request = { method: 'POST', originalUrl: '/v1/artifacts', headers: {} };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

function uniqueViolation(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

describe('violación de unicidad', () => {
  const filter = new DomainExceptionFilter(new ConfigService({ NODE_ENV: 'test' }));

  it('se traduce a 409 con un código catalogado', () => {
    const { host, status, json } = hostFor();

    filter.catch(uniqueViolation(['tenant_id', 'artifact_code']), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    const body = json.mock.calls[0][0];
    expect(body.title).toBe('RESOURCE_ALREADY_EXISTS');
    expect(body.error.code).toBe('RESOURCE_ALREADY_EXISTS');
    expect(body.status).toBe(HttpStatus.CONFLICT);
  });

  it('nombra las columnas en conflicto pero nunca sus valores', () => {
    const { host, json } = hostFor();

    filter.catch(uniqueViolation(['tenant_id', 'variable_code']), host);

    const body = json.mock.calls[0][0];
    expect(body.error.details).toEqual({ target: ['tenant_id', 'variable_code'] });
    // El conflicto puede darse sobre un dato del solicitante, y devolver el valor
    // confirmaría a quien pregunta que ya está registrado.
    expect(JSON.stringify(body)).not.toContain('Unique constraint failed');
  });

  it('deja pasar como error interno lo que no es una violación de unicidad', () => {
    const { host, status, json } = hostFor();

    filter.catch(new Error('algo se rompió de verdad'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json.mock.calls[0][0].error.code).toBe('INTERNAL_ERROR');
  });
});
