/**
 * Convierte un paquete subido en un contrato de template registrable.
 *
 * Es la aduana. Todo lo que entra por la API pasa por aquí y sale convertido en el MISMO tipo
 * que declara un template incorporado, de modo que a partir de este punto el resto del worker
 * no distingue el origen — que es justo lo que se quiere: un solo camino de composición, un
 * solo escapado, un solo juego de comprobaciones.
 *
 * Lo que se rechaza aquí no llega nunca a un render. Lo que se acepta aquí ya no se vuelve a
 * comprobar, así que esta función es el sitio donde ser estricto sale barato.
 */
import type { TemplateContract } from '../../domain/contracts/template-contract';
import { defineTemplate } from '../../domain/contracts/template-contract';
import type { TemplateBundle } from '../../domain/contracts/template-bundle';
import {
  TemplateBundleInvalidError,
  type PayloadIssue,
} from '../../domain/errors/pdf-worker.errors';
import { TemplateBundleSchema } from '../validation/bundle.schema';
import { compileFieldSpecs } from '../validation/field-spec-compiler';
import { toPayloadIssues } from '../validation/payload-issues';
import { lintDocumentTemplate } from './template-source.lint';
import { lintStylesheet } from './stylesheet.lint';

/**
 * Valida el paquete y lo convierte.
 *
 * Los problemas se acumulan y se devuelven JUNTOS. De uno en uno, publicar un template con
 * cuatro erratas cuesta cuatro viajes; y quien sube un template suele estar mirando otra cosa.
 */
export function bundleToContract(input: unknown): {
  contract: TemplateContract;
  bundle: TemplateBundle;
} {
  const parsed = TemplateBundleSchema.safeParse(input);
  if (!parsed.success) {
    throw new TemplateBundleInvalidError(toPayloadIssues(parsed.error.issues, input));
  }
  const bundle = parsed.data as unknown as TemplateBundle;
  const issues: PayloadIssue[] = [];

  // 1. La plantilla, con las MISMAS reglas que una incorporada: nada de interpolación sin
  //    escapar, nada de parciales dinámicos, sólo parciales del catálogo compartido.
  collect(issues, 'template', () => lintDocumentTemplate(bundle.template, bundle.manifest.id));

  // 2. Los estilos. Un `@import` o un `url(https://…)` devolverían al documento la dependencia
  //    de la red que todo el diseño existe para quitarle.
  if (bundle.styles) {
    collect(issues, 'styles', () => lintStylesheet(bundle.styles ?? '', bundle.manifest.id));
  }

  // 3. El contrato de datos, compilado. Un tipo mal declarado se ve aquí y no al primer uso.
  let schema: ReturnType<typeof compileFieldSpecs> | undefined;
  collect(issues, 'fields', () => {
    schema = compileFieldSpecs(bundle.fields);
  });

  // 4. Los datos de ejemplo contra su propio contrato. Es la comprobación que más defectos
  //    atrapa: un template cuyo ejemplo no valida es un template que nadie ha visto impreso,
  //    y su vista previa fallaría con un 422 desconcertante.
  if (schema) {
    const sample = schema.parse(bundle.sample);
    if (!sample.ok) {
      for (const issue of sample.issues) {
        issues.push({ ...issue, field: `sample.${issue.field}` });
      }
    }
  }

  if (issues.length > 0) throw new TemplateBundleInvalidError(issues);

  const { manifest } = bundle;
  return {
    bundle,
    contract: defineTemplate({
      id: manifest.id,
      version: manifest.version,
      title: manifest.title,
      description: manifest.description,
      tags: manifest.tags,
      classification: manifest.classification,
      page: manifest.page,
      footer: manifest.footer
        ? {
            institutionalText: manifest.footer.institutionalText,
            showGeneratedAt: manifest.footer.showGeneratedAt ?? true,
            showDocumentId: manifest.footer.showDocumentId ?? true,
            showPageNumbers: manifest.footer.showPageNumbers ?? true,
          }
        : undefined,
      // Sin `sourceDir`: no hay carpeta. El texto viaja con el contrato y el cargador lo sirve
      // desde memoria, comprobándolo igual que si viniera del disco.
      inlineSources: { body: bundle.template, css: bundle.styles ?? '' },
      schema: schema!,
      fixture: () => bundle.sample,
    }),
  };
}

/** Ejecuta una comprobación y convierte su excepción en un problema del campo indicado. */
function collect(issues: PayloadIssue[], field: string, check: () => void): void {
  try {
    check();
  } catch (error) {
    issues.push({
      field,
      problem: error instanceof Error ? error.message : String(error),
    });
  }
}
