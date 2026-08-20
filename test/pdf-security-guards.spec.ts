/**
 * Las barreras del §24, cada una con el ataque que evita.
 *
 * Ninguna de estas pruebas comprueba «que funcione». Comprueban que algo NO ocurre, que es la
 * única forma de que una barrera siga existiendo dentro de seis meses: sin ellas, quitarla no
 * pone nada en rojo.
 */
import {
  AssetResolutionError,
  TemplateSourceError,
} from '../src/pdf-worker/domain/errors/pdf-worker.errors';
import { safeFilename, looksLikePdf } from '../src/pdf-worker/domain/entities/generated-document';
import { FilesystemAssetResolverAdapter } from '../src/pdf-worker/infrastructure/assets/filesystem-asset-resolver.adapter';
import {
  assertNoRawInterpolation,
  assertStaticPartials,
} from '../src/pdf-worker/infrastructure/templates/template-source.lint';
import { HandlebarsTemplateEngineAdapter } from '../src/pdf-worker/infrastructure/templates/handlebars/handlebars-template-engine.adapter';
import { resolve } from 'node:path';

describe('Barreras de seguridad del generador documental', () => {
  describe('escapado e inyección de plantilla', () => {
    it('prohíbe la interpolación sin escapar en las plantillas de documento', () => {
      expect(() => assertNoRawInterpolation('<p>{{{data.texto}}}</p>', 'x')).toThrow(
        TemplateSourceError,
      );
      expect(() => assertNoRawInterpolation('<p>{{& data.texto}}</p>', 'x')).toThrow(
        TemplateSourceError,
      );
      expect(() => assertNoRawInterpolation('<p>{{data.texto}}</p>', 'x')).not.toThrow();
    });

    it('prohíbe un parcial cuyo nombre pueda elegir el payload', () => {
      expect(() => assertStaticPartials('{{> (lookup . "name")}}', 'x')).toThrow(
        TemplateSourceError,
      );
      expect(() => assertStaticPartials('{{#> (lookup . "name")}}{{/x}}', 'x')).toThrow(
        TemplateSourceError,
      );
      expect(() => assertStaticPartials('{{> atlas/table}}', 'x')).not.toThrow();
    });

    it('escapa el marcado que llega en el payload', () => {
      const engine = new HandlebarsTemplateEngineAdapter();
      const html = engine
        .compile('t', '<p>{{data.nombre}}</p>')
        .render({ data: { nombre: '<img src=x onerror=alert(1)>' } });
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img');
    });

    it('no deja alcanzar la cadena de prototipos desde los datos', () => {
      const engine = new HandlebarsTemplateEngineAdapter();
      const html = engine.compile('proto', '[{{data.constructor.name}}]').render({ data: {} });
      expect(html).toBe('[]');
    });

    it('falla al compilar si la plantilla invoca un ayudante que no existe', () => {
      const engine = new HandlebarsTemplateEngineAdapter();
      // Sin `knownHelpersOnly`, esto se resolvería en ejecución como una búsqueda de propiedad
      // y pintaría vacío: la errata llegaría hasta el PDF.
      expect(() => engine.compile('typo', '{{fmtNumer data.x}}')).toThrow(TemplateSourceError);
    });
  });

  describe('recursos y SSRF', () => {
    const resolver = new FilesystemAssetResolverAdapter(
      resolve(__dirname, '../src/pdf-worker/templates/shared/assets'),
    );

    it('rechaza una URL como referencia de recurso', async () => {
      await expect(
        resolver.resolve('https://169.254.169.254/latest/meta-data'),
      ).rejects.toBeInstanceOf(AssetResolutionError);
      await expect(resolver.resolve('http://interno.local/logo.svg')).rejects.toBeInstanceOf(
        AssetResolutionError,
      );
    });

    it('rechaza un nombre con separadores de ruta', async () => {
      await expect(resolver.resolve('asset:../../../../etc/passwd')).rejects.toBeInstanceOf(
        AssetResolutionError,
      );
      await expect(resolver.resolve('asset:sub/dir/logo.svg')).rejects.toBeInstanceOf(
        AssetResolutionError,
      );
    });

    it('rechaza una extensión que no es de imagen ni de fuente', async () => {
      await expect(resolver.resolve('asset:config.json')).rejects.toBeInstanceOf(
        AssetResolutionError,
      );
    });
  });

  describe('nombre de archivo y salida', () => {
    it('sanea un nombre con travesía de directorios', () => {
      expect(safeFilename('../../etc/passwd', 'fallback')).toBe('etc-passwd.pdf');
      expect(safeFilename('..\\..\\windows\\system32', 'fallback')).toBe('windows-system32.pdf');
      expect(safeFilename('', 'informe')).toBe('informe.pdf');
      expect(safeFilename('Informe de crédito.pdf', 'x')).toBe('Informe-de-credito.pdf');
    });

    it('reconoce que unos bytes son un PDF antes de devolverlos', () => {
      expect(looksLikePdf(Buffer.from('%PDF-1.7\n...'))).toBe(true);
      // Una página de error del motor también «pesa» y también tiene checksum.
      expect(looksLikePdf(Buffer.from('<html><body>error</body></html>'))).toBe(false);
      expect(looksLikePdf(Buffer.alloc(0))).toBe(false);
    });
  });
});
