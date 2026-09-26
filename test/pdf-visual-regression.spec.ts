/**
 * Regresión visual sobre el HTML compuesto (§46).
 *
 * **Qué cubre**: plantilla, parciales, hojas de estilo, tokens de la marca, membrete, pie y los
 * datos del fixture, con el reloj y el identificador de documento congelados. Un retoque
 * accidental en `components.css` que descoloque las tablas de los tres documentos aparece aquí.
 *
 * **Qué NO cubre**: el rasterizado. Otra versión de Chromium puede paginar distinto con el
 * mismo HTML. Para eso están las capturas de `yarn pdf:evidencia`, que mira una persona — y que
 * son las que detectaron que el membrete se pintaba encima del título.
 *
 * No usa el PDF como referencia a propósito: Chromium le pone una `/CreationDate` y dos
 * ejecuciones del mismo documento dan archivos distintos byte a byte.
 *
 * Cuando el cambio es INTENCIONADO: `yarn pdf:visual:baseline --write`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComposeHtmlUseCase } from '../src/pdf-worker/application/use-cases/compose-html/compose-html.use-case';
import {
  REFERENCE_BRAND_ENV,
  REFERENCE_INSTANT,
} from '../src/pdf-worker/infrastructure/config/reference-env';
import { FixedClock } from '../src/pdf-worker/infrastructure/observability/nest-logger.adapter';
import { TemplateRegistry } from '../src/pdf-worker/infrastructure/registry/template-registry';
import { createPdfWorkerHarness, type Harness } from './support/pdf-worker-harness';

const BASELINE = JSON.parse(
  readFileSync(resolve(__dirname, '../docs/pdf-worker/visual-baseline.json'), 'utf8'),
) as Record<string, string>;

/**
 * Se usa el MISMO entorno de referencia que escribió el archivo (`REFERENCE_BRAND_ENV`) y el
 * mismo instante congelado. Sin esa constante compartida, el CLI compondría un membrete y la
 * prueba otro, la comparación fallaría siempre por un motivo que no es un cambio de diseño, y
 * una comprobación que falla sin motivo se acaba desactivando.
 */
describe('Regresión visual de los templates', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createPdfWorkerHarness(
      { ...REFERENCE_BRAND_ENV },
      { clock: new FixedClock(REFERENCE_INSTANT), replaceEnv: true },
    );
  });

  afterAll(async () => {
    await harness.close();
  });

  it('la referencia cubre todos los templates publicados', () => {
    const registry = harness.module.get(TemplateRegistry);
    const publicados = registry
      .listTemplates()
      .flatMap((contrato) =>
        registry.listVersions(contrato.id).map((version) => `${contrato.id}@${version}`),
      )
      .sort();
    // Un template nuevo sin referencia pasaría desapercibido para siempre: la comparación de
    // abajo sólo recorre lo que ya está en el archivo.
    expect(publicados).toEqual(Object.keys(BASELINE).sort());
  });

  it.each(Object.keys(BASELINE))('%s conserva su huella visual', async (clave) => {
    const [templateId, version] = clave.split('@');
    const compose = harness.module.get(ComposeHtmlUseCase);
    const composed = await compose.execute({ templateId, templateVersion: version });

    const huella = createHash('sha256')
      .update(`${composed.html}\n${composed.headerHtml}\n${composed.footerHtml}`)
      .digest('hex');

    expect(huella).toBe(BASELINE[clave]);
  });
});
