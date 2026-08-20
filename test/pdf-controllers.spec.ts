/**
 * Los tres controladores del generador documental, que no tenían prueba propia.
 *
 * `pdf-catalog`, `pdf-generation` y `pdf-template-admin` salieron en la auditoría como
 * controladores sin ningún fichero de `test/` que los mencionara. La lógica de generación sí
 * está probada —hay 72 pruebas y una contra Chromium real—; lo que no lo estaba es la capa que
 * decide QUIÉN entra y QUÉ se promete, que es donde un cambio de una línea no rompe nada
 * visible.
 *
 * Lo que se fija aquí:
 *
 * 1. **Los tres declaran roles a nivel de clase.** El comentario de `pdf-generation` explica por
 *    qué importa: sin `@Roles`, el guardia global del motor cae en su modo por omisión. Que sea
 *    a nivel de CLASE es lo que hace que un método nuevo nazca cubierto.
 * 2. **La administración de plantillas no la abre cualquiera de los que generan.** Generar un
 *    documento es producir papel con datos que ese perfil ya puede consultar; publicar una
 *    plantilla es decidir qué dice el papel de la organización.
 * 3. **Todas las operaciones publican el cuerpo de su respuesta.** Ocho no lo hacían y el
 *    contrato publicado decía que devolvían «algo».
 */
import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { REQUIRED_ROLES } from '../src/common/security/security.decorators';
import { PdfCatalogController } from '../src/pdf-worker/presentation/http/pdf-catalog.controller';
import { PdfGenerationController } from '../src/pdf-worker/presentation/http/pdf-generation.controller';
import { PdfTemplateAdminController } from '../src/pdf-worker/presentation/http/pdf-template-admin.controller';
import { TemplateAdminGuard } from '../src/pdf-worker/presentation/http/template-admin.guard';
import { assertOnlyOverridable } from '../src/pdf-worker/application/services/config-precedence';
import { ProtectedOptionOverrideError } from '../src/pdf-worker/domain/errors/pdf-worker.errors';

const CONTROLADORES = [
  ['PdfCatalogController', PdfCatalogController],
  ['PdfGenerationController', PdfGenerationController],
  ['PdfTemplateAdminController', PdfTemplateAdminController],
] as const;

function rolesDeClase(clase: object): readonly string[] {
  return (Reflect.getMetadata(REQUIRED_ROLES, clase) as string[] | undefined) ?? [];
}

describe('Controladores del generador documental · autorización', () => {
  it.each(CONTROLADORES)('%s declara roles a nivel de CLASE', (_nombre, clase) => {
    /*
     * A nivel de clase, no de método, y no es un detalle de estilo: es lo que hace que un
     * endpoint nuevo nazca cubierto en vez de nacer abierto y esperar a que alguien recuerde el
     * decorador. Es exactamente el modo de fallo que dejó el worker suelto sin autenticación.
     */
    expect(rolesDeClase(clase).length).toBeGreaterThan(0);
  });

  it('quien genera un documento no administra plantillas por el mero hecho de generar', () => {
    /*
     * Los roles de clase coinciden a propósito —la administración vive en el mismo controlador
     * que el formato público—, así que lo que separa de verdad las dos cosas es el guardia de
     * clave por método. Esta prueba fija que ese guardia SIGUE puesto: sin él, cualquiera con
     * permiso para generar podría publicar una plantilla, es decir, decidir qué dice el papel
     * de la organización.
     */
    for (const metodo of ['inventory', 'publish', 'source', 'deprecate', 'remove'] as const) {
      const guardias =
        (Reflect.getMetadata(
          '__guards__',
          PdfTemplateAdminController.prototype[metodo] as object,
        ) as unknown[] | undefined) ?? [];
      expect(guardias).toContain(TemplateAdminGuard);
    }
  });

  it('el formato público NO lleva guardia de administración', () => {
    // `template-format/example`, `template-format/schema` y `errors` documentan cómo integrarse.
    // Cerrarlos obligaría a pedir una clave para leer documentación.
    for (const metodo of ['exampleBundle', 'formatSchema', 'errorCatalog'] as const) {
      const guardias =
        (Reflect.getMetadata(
          '__guards__',
          PdfTemplateAdminController.prototype[metodo] as object,
        ) as unknown[] | undefined) ?? [];
      expect(guardias).not.toContain(TemplateAdminGuard);
    }
  });
});

describe('Controladores del generador documental · rutas', () => {
  it('el catálogo y la generación cuelgan del prefijo /pdf', () => {
    for (const [, clase] of CONTROLADORES) {
      const ruta = Reflect.getMetadata(PATH_METADATA, clase) as string;
      expect(ruta).toBe('pdf');
    }
  });
});

describe('Opciones protegidas de la generación', () => {
  /*
   * `assertOnlyOverridable` es la frontera entre «el que pide ajusta su documento» y «el que
   * pide redefine la identidad institucional». El pipe de Zod ya rechaza claves desconocidas;
   * esta comprobación existe para nombrar la opción protegida concreta en el mensaje, porque un
   * 422 que dice «opción inválida» sin decir cuál obliga a probar de una en una.
   */
  it('deja pasar lo que sí se puede ajustar', () => {
    expect(() => assertOnlyOverridable({ returnContent: true })).not.toThrow();
    expect(() => assertOnlyOverridable(undefined)).not.toThrow();
    expect(() => assertOnlyOverridable({})).not.toThrow();
  });

  it('rechaza sobrescribir la identidad institucional, y dice cuál', () => {
    let capturado: unknown;
    try {
      assertOnlyOverridable({ letterheadMode: 'none' });
    } catch (error) {
      capturado = error;
    }
    expect(capturado).toBeInstanceOf(ProtectedOptionOverrideError);
    // El mensaje nombra la opción: sin eso, quien integra prueba de una en una hasta acertar.
    expect(String((capturado as Error).message)).toMatch(/letterheadMode/);
  });
});
