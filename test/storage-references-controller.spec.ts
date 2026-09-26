/**
 * La ruta que AtlasBackend consulta antes de borrar un archivo de un expediente.
 *
 * No existía: el conteo quedaba siempre «incierto» y la papelera de AtlasBackend nunca borraba un
 * archivo. Aquí se fija que cuenta las CUATRO columnas donde el Motor guarda claves del almacén,
 * sólo dentro del tenant de quien pregunta, y que sólo la credencial de ejecución puede llamarla.
 */
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { REQUIRED_AUDIENCE, REQUIRED_ROLES } from '../src/common/security/security.decorators';
import { RUNTIME_DECISION_ROLE } from '../src/common/security/platform-roles';
import { StorageReferencesController } from '../src/modules/workers/storage-references.controller';

function construir(extractos = 0, identidad = 0) {
  const prisma = {
    bankStatementRun: { count: jest.fn().mockResolvedValue(extractos) },
    identityVerificationRun: { count: jest.fn().mockResolvedValue(identidad) },
  };
  return { prisma, controller: new StorageReferencesController(prisma as never) };
}

describe('StorageReferencesController', () => {
  it('suma las referencias de extractos y de identidad (tres caras) dentro del tenant', async () => {
    const { prisma, controller } = construir(1, 2);

    await expect(controller.references(7n, 'identity/7/req-1/selfie-x.jpg')).resolves.toEqual({
      references: 3,
    });

    expect(prisma.bankStatementRun.count).toHaveBeenCalledWith({
      where: { tenantId: 7n, fileObjectKey: 'identity/7/req-1/selfie-x.jpg' },
    });
    expect(prisma.identityVerificationRun.count).toHaveBeenCalledWith({
      where: {
        tenantId: 7n,
        OR: [
          { documentObjectKey: 'identity/7/req-1/selfie-x.jpg' },
          { documentBackObjectKey: 'identity/7/req-1/selfie-x.jpg' },
          { selfieObjectKey: 'identity/7/req-1/selfie-x.jpg' },
        ],
      },
    });
  });

  it('una clave que nadie usa da 0, que es lo que permite borrar', async () => {
    const { controller } = construir(0, 0);
    await expect(controller.references(7n, 'k/libre.pdf')).resolves.toEqual({ references: 0 });
  });

  it('sin clave, o con una absurdamente larga, es 400 y no cuenta nada', async () => {
    const { prisma, controller } = construir();
    await expect(controller.references(7n, '   ')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.references(7n, 'x'.repeat(513))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.bankStatementRun.count).not.toHaveBeenCalled();
  });

  it('sólo la credencial de ejecución (audiencia runtime, rol DECISION_RUNTIME) puede preguntar', () => {
    expect(Reflect.getMetadata(REQUIRED_AUDIENCE, StorageReferencesController)).toBe('runtime');
    expect(Reflect.getMetadata(REQUIRED_ROLES, StorageReferencesController)).toEqual([
      RUNTIME_DECISION_ROLE,
    ]);
  });
});
