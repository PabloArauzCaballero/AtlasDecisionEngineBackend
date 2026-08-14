/**
 * El contrato de un documento: qué datos exige y cómo se maqueta.
 *
 * Aquí está la decisión central del §7. Un template NO recibe `Record<string, any>`: recibe
 * exactamente el tipo que declara, y quien no lo cumple obtiene un rechazo con el campo, el
 * problema y la regla esperada ANTES de que se levante ningún navegador. Un PDF con un
 * «undefined» impreso es un defecto que sólo detecta una persona abriendo el archivo; un
 * payload rechazado lo detecta el llamante en el mismo segundo.
 *
 * El dominio no importa Zod. Declara `PayloadSchema<T>`, una interfaz de tres métodos, y el
 * adaptador `infrastructure/validation/zod-payload-schema.ts` la satisface. Eso es lo que
 * hace que el §7 —«Zod o una solución equivalente»— sea cierto y no una intención.
 */
import type { DocumentClassification } from '../enums/document.enums';
import type { PayloadIssue } from '../errors/pdf-worker.errors';
import type { FooterConfig, LetterheadConfig } from './../value-objects/document-brand';
import type { PageSetupOverrides } from '../value-objects/page-setup';

export type PayloadParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly PayloadIssue[] };

/** Descripción legible de un campo, publicada por `GET /pdf/templates/:id/schema` (§19). */
export interface TemplateFieldDescriptor {
  readonly type: string;
  readonly required: boolean;
  readonly description?: string;
  readonly values?: readonly string[];
  readonly items?: TemplateFieldDescriptor;
  readonly fields?: Readonly<Record<string, TemplateFieldDescriptor>>;
}

export interface PayloadSchema<T> {
  /** Valida y NORMALIZA. El valor devuelto es el que llega a la plantilla, no el original. */
  parse(input: unknown): PayloadParseResult<T>;
  /** Mapa plano y legible para humanos y para generadores de clientes. */
  describeFields(): Readonly<Record<string, TemplateFieldDescriptor>>;
  /** JSON Schema completo, para quien prefiera validar en su lado antes de llamar. */
  toJsonSchema(): unknown;
  /** Campos de primer nivel obligatorios. Se deriva del esquema; no se escribe a mano. */
  requiredFields(): readonly string[];
}

/** Aviso de retirada. Un template obsoleto sigue generando: retirarlo rompe el archivo. */
export interface TemplateDeprecation {
  readonly since: string;
  readonly reason: string;
  readonly replacedBy?: string;
}

export interface TemplateContract<TPayload = unknown> {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly description: string;

  /**
   * Carpeta del template, normalmente `__dirname`.
   *
   * De ahí se cargan por convención `template.hbs`, `styles.css` y `partials/*.hbs`. Es una
   * ruta que fija el CÓDIGO, nunca la petición: aceptar una ruta del cliente sería abrir un
   * «path traversal» de manual (§24).
   *
   * Ausente en los templates PUBLICADOS POR LA API, que no tienen carpeta: traen su texto en
   * `inlineSources`. Un contrato debe declarar exactamente uno de los dos.
   */
  readonly sourceDir?: string;

  /**
   * Texto de la plantilla y de los estilos, en memoria.
   *
   * Lo usan los templates subidos por la administración. Que el cargador acepte las dos
   * procedencias —disco y memoria— es lo que permite que un template publicado por la API
   * recorra EXACTAMENTE el mismo camino de composición, escapado y comprobación que uno
   * incorporado. Con dos caminos, uno de los dos acabaría siendo el flojo.
   */
  readonly inlineSources?: {
    readonly body: string;
    readonly css: string;
  };

  readonly schema: PayloadSchema<TPayload>;

  /** Datos ficticios válidos para `POST /pdf/preview` y para el CLI (§21). */
  readonly fixture: () => TPayload;

  readonly page?: PageSetupOverrides;
  readonly letterhead?: Partial<LetterheadConfig>;
  readonly footer?: Partial<FooterConfig>;
  readonly classification?: DocumentClassification;

  /** Recursos que este template usa, para que el resolutor los precargue y los valide. */
  readonly assets?: readonly string[];

  /** Etiquetas de descubrimiento: `GET /pdf/templates?tag=riesgo`. */
  readonly tags?: readonly string[];

  readonly deprecated?: TemplateDeprecation;
}

/**
 * Declara un template conservando la inferencia del payload.
 *
 * Sin este ayudante hay que escribir el parámetro de tipo a mano en tres sitios y basta
 * olvidarlo en uno para que `fixture` acepte cualquier cosa — el agujero exacto que el §7
 * quiere cerrar.
 */
export function defineTemplate<TPayload>(
  contract: TemplateContract<TPayload>,
): TemplateContract<TPayload> {
  return Object.freeze(contract);
}

/** Vista publicable de un template, sin rutas de disco ni funciones. */
export interface TemplateSummary {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly classification?: DocumentClassification;
  readonly requiredFields: readonly string[];
  readonly deprecated?: TemplateDeprecation;
}

export function summarize(contract: TemplateContract): TemplateSummary {
  return {
    id: contract.id,
    version: contract.version,
    title: contract.title,
    description: contract.description,
    tags: contract.tags ?? [],
    classification: contract.classification,
    requiredFields: contract.schema.requiredFields(),
    deprecated: contract.deprecated,
  };
}
