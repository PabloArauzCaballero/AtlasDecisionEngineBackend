/**
 * El CRUD de templates: publicar, leer, retirar y borrar por API.
 *
 * La prueba que más importa es la del ejemplo descargable: se coge el paquete que publica
 * `GET /pdf/template-format/example`, se sube tal cual y tiene que quedar registrado y generar
 * un PDF. Un formato de ejemplo que no se puede usar es peor que no publicarlo, porque se copia
 * igual y falla después.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BundleCompilerAdapter } from '../src/pdf-worker/infrastructure/templates/bundle-compiler.adapter';
import { FilesystemTemplateStoreAdapter } from '../src/pdf-worker/infrastructure/store/filesystem-template-store.adapter';
import { HandlebarsTemplateEngineAdapter } from '../src/pdf-worker/infrastructure/templates/handlebars/handlebars-template-engine.adapter';
import { TemplateRegistry } from '../src/pdf-worker/infrastructure/registry/template-registry';
import { ManageTemplatesUseCase } from '../src/pdf-worker/application/use-cases/manage-templates/manage-templates.use-case';
import {
  TemplateBuiltinProtectedError,
  TemplateBundleInvalidError,
  TemplateImmutableError,
} from '../src/pdf-worker/domain/errors/pdf-worker.errors';
import type { TemplateBundle } from '../src/pdf-worker/domain/contracts/template-bundle';
import { GenericResultReportTemplate } from '../src/pdf-worker/templates/documents/generic-result-report/1.0.0/template.config';
import type { TemplateContract } from '../src/pdf-worker/domain/contracts/template-contract';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

async function crearCaso() {
  const root = await mkdtemp(join(tmpdir(), 'pdf-crud-'));
  const registry = new TemplateRegistry();
  registry.register(GenericResultReportTemplate as TemplateContract);
  const useCase = new ManageTemplatesUseCase(
    registry,
    new FilesystemTemplateStoreAdapter(root),
    new HandlebarsTemplateEngineAdapter(),
    new BundleCompilerAdapter(),
    logger,
  );
  return { root, registry, useCase, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const compiler = new BundleCompilerAdapter();

describe('CRUD de templates', () => {
  describe('el formato publicado', () => {
    it('el paquete de ejemplo compila y es utilizable tal cual', () => {
      // Si esto falla, `GET /pdf/template-format/example` está repartiendo un formato que el
      // propio backend rechazaría.
      const { contract } = compiler.compile(compiler.example());
      expect(contract.id).toBe('certificado-de-cuenta');
      expect(contract.inlineSources?.body).toContain('atlas/heading');
    });

    it('los datos de ejemplo cumplen el contrato que el propio paquete declara', () => {
      const { contract } = compiler.compile(compiler.example());
      const parsed = contract.schema.parse(contract.fixture());
      expect(parsed.ok).toBe(true);
    });

    it('publica el JSON Schema del formato, no el de un template', () => {
      const schema = compiler.jsonSchema() as { properties?: Record<string, unknown> };
      expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
        'fields',
        'manifest',
        'sample',
        'styles',
        'template',
      ]);
    });
  });

  describe('publicar', () => {
    it('registra el template y lo persiste', async () => {
      const caso = await crearCaso();
      try {
        const stored = await caso.useCase.publish(compiler.example(), 'operador@atlas');
        expect(stored.origin).toBe('custom');
        expect(stored.status).toBe('published');
        expect(stored.createdBy).toBe('operador@atlas');
        expect(stored.checksum).toMatch(/^[0-9a-f]{64}$/);
        expect(caso.registry.hasTemplate('certificado-de-cuenta', '1.0.0')).toBe(true);

        // Persistido de verdad: un registro sólo en memoria desaparece al reiniciar y con él
        // la capacidad de reproducir lo ya emitido.
        const otro = await crearCaso();
        try {
          const store = new FilesystemTemplateStoreAdapter(caso.root);
          expect(await store.get('certificado-de-cuenta', '1.0.0')).toBeDefined();
        } finally {
          await otro.cleanup();
        }
      } finally {
        await caso.cleanup();
      }
    });

    it('rechaza republicar la misma versión y sugiere la siguiente', async () => {
      const caso = await crearCaso();
      try {
        await caso.useCase.publish(compiler.example());
        await expect(caso.useCase.publish(compiler.example())).rejects.toMatchObject({
          code: 'TEMPLATE_IMMUTABLE',
          details: { versionSugerida: '1.0.1' },
        });
        await expect(caso.useCase.publish(compiler.example())).rejects.toBeInstanceOf(
          TemplateImmutableError,
        );
      } finally {
        await caso.cleanup();
      }
    });

    it('restaura del disco lo publicado en un arranque anterior', async () => {
      const caso = await crearCaso();
      try {
        await caso.useCase.publish(compiler.example());

        const nuevoRegistro = new TemplateRegistry();
        const trasReinicio = new ManageTemplatesUseCase(
          nuevoRegistro,
          new FilesystemTemplateStoreAdapter(caso.root),
          new HandlebarsTemplateEngineAdapter(),
          new BundleCompilerAdapter(),
          logger,
        );
        expect(await trasReinicio.restore()).toBe(1);
        expect(nuevoRegistro.hasTemplate('certificado-de-cuenta', '1.0.0')).toBe(true);
      } finally {
        await caso.cleanup();
      }
    });
  });

  describe('rechazos del paquete', () => {
    const conCambio = (cambio: (bundle: TemplateBundle) => void): TemplateBundle => {
      const bundle = compiler.example();
      cambio(bundle);
      return bundle;
    };

    it('plantilla con interpolación sin escapar', () => {
      const bundle = conCambio((b) => {
        (b as { template: string }).template = '<p>{{{data.titular}}}</p>';
      });
      expect(() => compiler.compile(bundle)).toThrow(TemplateBundleInvalidError);
    });

    it('hoja de estilos que trae la red de vuelta', () => {
      for (const css of [
        '@import url(https://fonts.example.com/a.css);',
        '.x{background:url("https://cdn.example.com/f.png")}',
      ]) {
        const bundle = conCambio((b) => {
          (b as { styles?: string }).styles = css;
        });
        expect(() => compiler.compile(bundle)).toThrow(TemplateBundleInvalidError);
      }
    });

    it('datos de ejemplo que no cumplen su propio contrato', () => {
      const bundle = conCambio((b) => {
        (b as { sample: unknown }).sample = { titular: 'Ana' };
      });
      try {
        compiler.compile(bundle);
        throw new Error('debería haber lanzado');
      } catch (error) {
        const issues = (error as TemplateBundleInvalidError).issues;
        // Se prefijan con `sample.` para que quien publica sepa que el problema está en el
        // ejemplo y no en el contrato.
        expect(issues.some((issue) => issue.field.startsWith('sample.'))).toBe(true);
      }
    });

    it('un tipo de campo fuera del vocabulario cerrado', () => {
      const bundle = conCambio((b) => {
        (b.fields as Record<string, unknown>).saldo = { type: 'funcion', required: true };
      });
      expect(() => compiler.compile(bundle)).toThrow(TemplateBundleInvalidError);
    });

    it('acumula TODOS los problemas en una sola respuesta', () => {
      const bundle = conCambio((b) => {
        (b as { template: string }).template = '<p>{{{data.titular}}}</p>';
        (b as { styles?: string }).styles = '@import url(https://x.test/a.css);';
      });
      try {
        compiler.compile(bundle);
        throw new Error('debería haber lanzado');
      } catch (error) {
        // De uno en uno, corregir un paquete con cuatro erratas cuesta cuatro viajes.
        expect((error as TemplateBundleInvalidError).issues.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe('retirada y borrado', () => {
    it('deprecar deja el template generando; borrar lo saca del catálogo', async () => {
      const caso = await crearCaso();
      try {
        await caso.useCase.publish(compiler.example());

        const deprecado = await caso.useCase.deprecate('certificado-de-cuenta', '1.0.0');
        expect(deprecado.status).toBe('deprecated');
        // Sigue registrado: lo ya emitido con esa versión tiene que poder reproducirse.
        expect(caso.registry.hasTemplate('certificado-de-cuenta', '1.0.0')).toBe(true);

        await caso.useCase.remove('certificado-de-cuenta', '1.0.0');
        expect(caso.registry.hasTemplate('certificado-de-cuenta', '1.0.0')).toBe(false);
      } finally {
        await caso.cleanup();
      }
    });

    it('los templates incorporados no se tocan por la API', async () => {
      const caso = await crearCaso();
      try {
        for (const operacion of [
          () => caso.useCase.remove('generic-result-report', '1.0.0'),
          () => caso.useCase.deprecate('generic-result-report', '1.0.0'),
          () => caso.useCase.source('generic-result-report', '1.0.0'),
        ]) {
          await expect(operacion()).rejects.toBeInstanceOf(TemplateBuiltinProtectedError);
        }
        expect(caso.registry.hasTemplate('generic-result-report', '1.0.0')).toBe(true);
      } finally {
        await caso.cleanup();
      }
    });

    it('el inventario distingue origen y estado', async () => {
      const caso = await crearCaso();
      try {
        await caso.useCase.publish(compiler.example());
        const inventario = await caso.useCase.inventory();

        const propio = inventario.find((entry) => entry.id === 'certificado-de-cuenta');
        const incorporado = inventario.find((entry) => entry.id === 'generic-result-report');
        expect(propio?.origin).toBe('custom');
        expect(incorporado?.origin).toBe('builtin');
        expect(incorporado?.checksum).toBeUndefined();
      } finally {
        await caso.cleanup();
      }
    });
  });
});
