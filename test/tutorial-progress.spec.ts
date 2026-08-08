import { TutorialService } from '../src/modules/tutorials/tutorial.service';
import type { UpsertTutorialProgressDto } from '../src/modules/tutorials/tutorial.dto';
import type { PrismaService } from '../src/common/prisma/prisma.service';

/**
 * El progreso de los tutoriales no otorga ninguna autoridad de dominio, pero sí es una fila
 * por tenant Y por usuario. Lo que hay que fijar es que la clave compuesta viaje entera en
 * cada escritura: perder el `tenantId` o el `userId` de la clave del `upsert` convertiría el
 * progreso en algo compartido entre usuarios —o entre clientes— sin ningún error visible.
 *
 * También se fija la semántica de `completedAt`: se rellena al completar y se LIMPIA al
 * volver atrás, porque una fecha de fin que sobrevive a un reinicio es un dato que miente.
 */
describe('TutorialService', () => {
  const TENANT = 3n;
  const USER = 'usuario-1';

  /** Forma mínima de los argumentos que se inspeccionan; evita un `any` en la prueba. */
  interface UpsertArgs {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }

  function makePrisma() {
    const calls: { upsertArgs?: UpsertArgs; findArgs?: { where: Record<string, unknown> } } = {};
    const row = {
      tutorialId: 'primeros-pasos',
      status: 'STARTED',
      lastStep: 2,
      version: 1,
      autoShow: true,
      completedAt: null,
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      // Campos que NO deben salir hacia fuera.
      id: 99n,
      tenantId: TENANT,
      userId: USER,
    };
    const prisma = {
      userTutorialProgress: {
        findMany: (args: { where: Record<string, unknown> }) => {
          calls.findArgs = args;
          return Promise.resolve([row]);
        },
        upsert: (args: UpsertArgs) => {
          calls.upsertArgs = args;
          return Promise.resolve(row);
        },
      },
    } as unknown as PrismaService;
    return { prisma, calls };
  }

  it('lista el progreso acotado al tenant y al usuario, nunca sólo al tenant', async () => {
    const { prisma, calls } = makePrisma();
    await new TutorialService(prisma).listProgress(TENANT, USER);
    expect(calls.findArgs?.where).toEqual({ tenantId: TENANT, userId: USER });
  });

  it('no devuelve las columnas internas de la fila', async () => {
    const { prisma } = makePrisma();
    const [item] = await new TutorialService(prisma).listProgress(TENANT, USER);
    // Se mapea a una forma de respuesta explícita (regla 10-backend-architecture): el modelo
    // de Prisma no sale crudo.
    expect(Object.keys(item).sort()).toEqual(
      [
        'autoShow',
        'completedAt',
        'lastStep',
        'status',
        'tutorialId',
        'updatedAt',
        'version',
      ].sort(),
    );
  });

  it('la clave del upsert lleva tenant, usuario y tutorial', async () => {
    const { prisma, calls } = makePrisma();
    await new TutorialService(prisma).upsertProgress(TENANT, USER, 'primeros-pasos', {
      status: 'STARTED',
      lastStep: 3,
    } as UpsertTutorialProgressDto);
    expect(calls.upsertArgs?.where).toEqual({
      tenantId_userId_tutorialId: { tenantId: TENANT, userId: USER, tutorialId: 'primeros-pasos' },
    });
    // Y la fila creada también, o el `create` de un upsert dejaría una fila sin dueño.
    expect(calls.upsertArgs?.create).toMatchObject({ tenantId: TENANT, userId: USER });
  });

  it('fecha el fin al completar', async () => {
    const { prisma, calls } = makePrisma();
    await new TutorialService(prisma).upsertProgress(TENANT, USER, 'primeros-pasos', {
      status: 'COMPLETED',
    } as UpsertTutorialProgressDto);
    expect(calls.upsertArgs?.update.completedAt).toBeInstanceOf(Date);
  });

  it('BORRA la fecha de fin si el tutorial vuelve a estar en curso', async () => {
    const { prisma, calls } = makePrisma();
    await new TutorialService(prisma).upsertProgress(TENANT, USER, 'primeros-pasos', {
      status: 'STARTED',
    } as UpsertTutorialProgressDto);
    // `null`, no `undefined`: con `undefined` Prisma dejaría intacta la fecha anterior y el
    // tutorial se leería como terminado y en curso a la vez.
    expect(calls.upsertArgs?.update.completedAt).toBeNull();
  });

  it('los campos opcionales que no se envían no pisan el valor guardado', async () => {
    const { prisma, calls } = makePrisma();
    await new TutorialService(prisma).upsertProgress(TENANT, USER, 'primeros-pasos', {
      status: 'STARTED',
    } as UpsertTutorialProgressDto);
    expect(calls.upsertArgs?.update).not.toHaveProperty('lastStep');
    expect(calls.upsertArgs?.update).not.toHaveProperty('version');
    expect(calls.upsertArgs?.update).not.toHaveProperty('autoShow');
  });

  it('al crear sí aplica los valores por defecto documentados', async () => {
    const { prisma, calls } = makePrisma();
    await new TutorialService(prisma).upsertProgress(TENANT, USER, 'nuevo', {
      status: 'STARTED',
    } as UpsertTutorialProgressDto);
    expect(calls.upsertArgs?.create).toMatchObject({ lastStep: 0, version: 1, autoShow: true });
  });
});
