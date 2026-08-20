/**
 * El PAQUETE de template: lo que se sube, lo que se descarga y lo que se archiva.
 *
 * Es un único JSON autocontenido. No un `.zip`, no un árbol de archivos: un objeto que se
 * puede pegar en un cliente HTTP, versionar en git, revisar en un «pull request» y diferenciar
 * línea a línea. Un paquete comprimido obliga a descomprimirlo para ver qué cambió.
 *
 * **El esquema del payload viaja como DATOS, nunca como código.** Un template incorporado
 * declara su contrato con Zod —TypeScript compilado, revisado y desplegado—; uno subido no
 * puede, porque aceptar código de una petición es aceptar ejecución arbitraria por muy
 * administrativa que sea la ruta. Por eso `fields` es un vocabulario CERRADO de descriptores
 * que el worker compila a Zod al registrarlo: la expresividad que se pierde es exactamente la
 * que no se puede auditar.
 *
 * Lo mismo con la plantilla y los estilos: son texto, pasan por las mismas comprobaciones que
 * los incorporados (nada de `{{{ }}}`, nada de parciales dinámicos, sólo los ayudantes del
 * catálogo) y se rechazan al subirlos, no al renderizar.
 */
import type { DocumentClassification, PageFormat, PageOrientation } from '../enums/document.enums';

/** Tipos que un template subido puede declarar. Cerrado a propósito: ver la nota de arriba. */
export const FIELD_TYPES = [
  'string',
  'number',
  'integer',
  'boolean',
  'enum',
  'date',
  'array',
  'object',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/**
 * Descriptor de un campo. Los límites (`maxLength`, `maxItems`…) NO son opcionales por
 * capricho de estilo: son la cota superior del trabajo que una petición puede provocar, y sin
 * ellos un payload de dos megas encarga un informe de cuatrocientas páginas.
 */
export interface FieldSpec {
  readonly type: FieldType;
  readonly required?: boolean;
  readonly description?: string;

  readonly minLength?: number;
  readonly maxLength?: number;
  readonly min?: number;
  readonly max?: number;

  /** Sólo para `enum`. Entre 1 y 40 valores. */
  readonly values?: readonly string[];

  /** Sólo para `array`. */
  readonly items?: FieldSpec;
  readonly maxItems?: number;

  /** Sólo para `object` y para `array` de objetos. */
  readonly fields?: Readonly<Record<string, FieldSpec>>;
}

export interface TemplateManifest {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly description: string;
  readonly tags?: readonly string[];
  readonly classification?: DocumentClassification;
  readonly page?: {
    readonly format?: PageFormat;
    readonly orientation?: PageOrientation;
  };
  readonly footer?: {
    readonly institutionalText?: string;
    readonly showGeneratedAt?: boolean;
    readonly showDocumentId?: boolean;
    readonly showPageNumbers?: boolean;
  };
}

export interface TemplateBundle {
  readonly manifest: TemplateManifest;
  /** Contrato de datos, en el vocabulario declarativo. Se compila a Zod al registrar. */
  readonly fields: Readonly<Record<string, FieldSpec>>;
  /** Cuerpo Handlebars. Sólo el CONTENIDO: el membrete, el pie y la numeración los pone el layout. */
  readonly template: string;
  /** CSS propio del documento. Opcional; sólo tokens, sin colores literales. */
  readonly styles?: string;
  /**
   * Datos de ejemplo válidos. Obligatorios: son los que alimentan `POST /pdf/preview` y los que
   * permiten comprobar que el template funciona ANTES de que un algoritmo dependa de él. Un
   * template sin ejemplo se publica sin que nadie lo haya visto impreso nunca.
   */
  readonly sample: unknown;
}

/** Origen de un template registrado. Decide qué se puede hacer con él por la API. */
export const TEMPLATE_ORIGINS = ['builtin', 'custom'] as const;
export type TemplateOrigin = (typeof TEMPLATE_ORIGINS)[number];

/** Estado de publicación. Retirar NO borra: un documento archivado debe poder reproducirse. */
export const TEMPLATE_STATUSES = ['published', 'deprecated'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export interface StoredTemplate {
  readonly bundle: TemplateBundle;
  readonly origin: TemplateOrigin;
  readonly status: TemplateStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy?: string;
  /** Huella del paquete: permite detectar que alguien tocó el archivo por debajo. */
  readonly checksum: string;
}
