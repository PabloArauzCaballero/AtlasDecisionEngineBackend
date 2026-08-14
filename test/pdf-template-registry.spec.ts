/**
 * El registro de templates: resolución de versiones e inmutabilidad (§8, §9).
 *
 * La prueba que más importa aquí es la del registro duplicado. Sobrescribir en silencio no
 * rompe ninguna otra prueba —el worker seguiría generando— pero convierte «este informe se
 * emitió con la 1.0.0» en una afirmación que ya no se puede comprobar.
 */
import { z } from 'zod';
import { defineTemplate } from '../src/pdf-worker/domain/contracts/template-contract';
import {
  TemplateAlreadyRegisteredError,
  TemplateNotFoundError,
  TemplateVersionNotFoundError,
} from '../src/pdf-worker/domain/errors/pdf-worker.errors';
import {
  compareVersions,
  latestVersion,
} from '../src/pdf-worker/domain/value-objects/template-ref';
import { TemplateRegistry } from '../src/pdf-worker/infrastructure/registry/template-registry';
import { zodSchema } from '../src/pdf-worker/infrastructure/validation/zod-payload-schema';

function template(id: string, version: string) {
  return defineTemplate({
    id,
    version,
    title: `Título ${version}`,
    description: 'Template de prueba',
    sourceDir: __dirname,
    schema: zodSchema(z.strictObject({ a: z.string() })),
    fixture: () => ({ a: 'x' }),
  });
}

describe('TemplateRegistry', () => {
  it('devuelve la última versión cuando no se pide ninguna', () => {
    const registry = new TemplateRegistry();
    registry.register(template('informe', '1.0.0'));
    registry.register(template('informe', '2.1.0'));
    registry.register(template('informe', '1.10.0'));

    expect(registry.getTemplate('informe').version).toBe('2.1.0');
    expect(registry.getLatestVersion('informe')).toBe('2.1.0');
  });

  it('ordena las versiones semánticamente y no como texto', () => {
    // `'1.10.0' < '1.9.0'` es cierto en orden alfabético y falso en orden semántico. Es el
    // fallo que aparece a la décima versión menor y no antes.
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(latestVersion(['1.9.0', '1.10.0', '1.2.0'])).toBe('1.10.0');

    const registry = new TemplateRegistry();
    registry.register(template('informe', '1.9.0'));
    registry.register(template('informe', '1.10.0'));
    expect(registry.listVersions('informe')).toEqual(['1.9.0', '1.10.0']);
    expect(registry.getTemplate('informe').version).toBe('1.10.0');
  });

  it('rechaza registrar dos veces la misma pareja id@versión', () => {
    const registry = new TemplateRegistry();
    registry.register(template('informe', '1.0.0'));
    expect(() => registry.register(template('informe', '1.0.0'))).toThrow(
      TemplateAlreadyRegisteredError,
    );
  });

  it('distingue «no existe el template» de «no existe esa versión»', () => {
    const registry = new TemplateRegistry();
    registry.register(template('informe', '1.0.0'));

    expect(() => registry.getTemplate('inexistente')).toThrow(TemplateNotFoundError);
    expect(() => registry.getTemplate('informe', '9.9.9')).toThrow(TemplateVersionNotFoundError);
  });

  it('nombra los templates disponibles cuando uno no existe', () => {
    const registry = new TemplateRegistry();
    registry.register(template('informe', '1.0.0'));
    registry.register(template('factura', '1.0.0'));

    try {
      registry.getTemplate('inexistente');
      throw new Error('debería haber lanzado');
    } catch (error) {
      expect((error as TemplateNotFoundError).details).toEqual({
        templateId: 'inexistente',
        available: ['factura', 'informe'],
      });
    }
  });

  it('lista un contrato por template, en su última versión', () => {
    const registry = new TemplateRegistry();
    registry.register(template('informe', '1.0.0'));
    registry.register(template('informe', '2.0.0'));
    registry.register(template('factura', '1.0.0'));

    expect(registry.listTemplates().map((c) => `${c.id}@${c.version}`)).toEqual([
      'factura@1.0.0',
      'informe@2.0.0',
    ]);
    // `size` cuenta parejas id@versión, que es lo que hay que cargar al arrancar.
    expect(registry.size).toBe(3);
  });
});
