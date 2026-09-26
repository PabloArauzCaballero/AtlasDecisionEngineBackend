/**
 * Lee las plantillas del disco, por convención y con contención de ruta.
 *
 * Convención sobre configuración: dentro de la carpeta de un template se buscan
 * `template.hbs`, `styles.css` y `partials/*.hbs`. Ningún contrato declara rutas, y por tanto
 * ninguna ruta puede llegar desde fuera. Ésa es la respuesta al «path traversal» del §24: no
 * se sanea una ruta que viene del exterior, es que no hay ninguna.
 *
 * `assertInsideRoot` cubre el caso que sí queda: un contrato mal escrito —o copiado de otro
 * proyecto— cuyo `sourceDir` apunte fuera del árbol de plantillas. Falla al cargar.
 *
 * La caché es permanente salvo `invalidate()`. Un template no cambia en caliente: cambia con
 * un despliegue, y el proceso vuelve a arrancar.
 */
import { Inject, Injectable } from '@nestjs/common';
import { readFile, readdir } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import type {
  DocumentSources,
  SharedSources,
  TemplateSourceLoaderPort,
} from '../../application/ports/template-source-loader.port';
import type { TemplateContract } from '../../domain/contracts/template-contract';
import { TemplateSourceError } from '../../domain/errors/pdf-worker.errors';
import { lintDocumentTemplate } from './template-source.lint';

/** Raíz por defecto: la carpeta `templates/` que acompaña al código compilado. */
export const BUNDLED_TEMPLATES_ROOT = resolve(__dirname, '..', '..', 'templates');

export const TEMPLATES_ROOT_TOKEN = Symbol('PdfTemplatesRoot');

/** Orden fijo: restablecimiento, tokens, componentes, impresión. La cascada depende de él. */
const SHARED_STYLESHEETS = ['reset.css', 'tokens.css', 'components.css', 'print.css'] as const;

@Injectable()
export class FilesystemTemplateLoader implements TemplateSourceLoaderPort {
  private shared?: Promise<SharedSources>;
  private readonly documents = new Map<string, Promise<DocumentSources>>();

  constructor(@Inject(TEMPLATES_ROOT_TOKEN) private readonly root: string) {}

  loadShared(): Promise<SharedSources> {
    this.shared ??= this.readShared();
    return this.shared;
  }

  loadDocument(contract: TemplateContract): Promise<DocumentSources> {
    const key = `${contract.id}@${contract.version}`;
    let pending = this.documents.get(key);
    if (!pending) {
      pending = this.readDocument(contract);
      this.documents.set(key, pending);
    }
    return pending;
  }

  invalidate(): void {
    this.shared = undefined;
    this.documents.clear();
  }

  private async readShared(): Promise<SharedSources> {
    const layouts = join(this.root, 'layouts');
    const [layout, header, footer] = await Promise.all([
      this.read(join(layouts, 'base-document.hbs')),
      this.read(join(layouts, 'header.hbs')),
      this.read(join(layouts, 'footer.hbs')),
    ]);
    const stylesheets = await Promise.all(
      SHARED_STYLESHEETS.map((file) => this.read(join(this.root, 'shared', 'styles', file))),
    );
    return {
      layout,
      header,
      footer,
      css: stylesheets.join('\n'),
      partials: await this.readPartials(join(this.root, 'shared', 'partials')),
    };
  }

  private async readDocument(contract: TemplateContract): Promise<DocumentSources> {
    // Template publicado por la API: su texto ya viaja con el contrato. Se COMPRUEBA igual
    // que el de disco —el lint no distingue procedencias— porque la garantía tiene que ser la
    // misma; lo único que cambia es de dónde salieron los bytes.
    if (contract.inlineSources) {
      lintDocumentTemplate(contract.inlineSources.body, `${contract.id}/template.hbs`);
      return { body: contract.inlineSources.body, css: contract.inlineSources.css, partials: {} };
    }
    if (!contract.sourceDir) {
      throw new TemplateSourceError(
        contract.id,
        'no declara ni «sourceDir» ni «inlineSources»; un contrato debe traer exactamente uno.',
      );
    }
    const directory = this.assertInsideRoot(contract.sourceDir, contract.id);
    const body = await this.read(join(directory, 'template.hbs'));
    lintDocumentTemplate(body, `${contract.id}/template.hbs`);

    const partials = await this.readPartials(join(directory, 'partials'));
    for (const [name, source] of Object.entries(partials)) {
      lintDocumentTemplate(source, `${contract.id}/partials/${name}.hbs`);
    }
    return {
      body,
      css: await this.readOptional(join(directory, 'styles.css')),
      partials,
    };
  }

  private async readPartials(directory: string): Promise<Record<string, string>> {
    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch {
      // Que no haya carpeta de parciales es normal, no un error: la mayoría de los documentos
      // se apañan con los compartidos.
      return {};
    }
    const partials: Record<string, string> = {};
    for (const entry of entries.filter((name) => extname(name) === '.hbs')) {
      partials[basename(entry, '.hbs')] = await this.read(join(directory, entry));
    }
    return partials;
  }

  private async read(path: string): Promise<string> {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      throw new TemplateSourceError(
        relative(this.root, path) || path,
        'no se pudo leer el archivo. ¿Se copió la carpeta «templates» junto al código compilado?',
        error,
      );
    }
  }

  private async readOptional(path: string): Promise<string> {
    try {
      return await readFile(path, 'utf8');
    } catch {
      return '';
    }
  }

  /**
   * Comprueba que la carpeta del contrato cuelga de la raíz de plantillas.
   *
   * Se compara la ruta RELATIVA resuelta: si empieza por `..` o es absoluta, el destino está
   * fuera. Comparar prefijos de cadena es la forma que falla con `templates-malicioso/`.
   */
  private assertInsideRoot(candidate: string, templateId: string): string {
    const absolute = resolve(candidate);
    const rootAbsolute = resolve(this.root);
    if (absolute === rootAbsolute) return absolute;
    const rel = relative(rootAbsolute, absolute);
    if (
      rel.startsWith('..') ||
      rel.startsWith(`..${sep}`) ||
      resolve(rootAbsolute, rel) !== absolute
    ) {
      throw new TemplateSourceError(
        templateId,
        `su carpeta (${absolute}) está fuera de la raíz de plantillas (${rootAbsolute}).`,
      );
    }
    return absolute;
  }
}
