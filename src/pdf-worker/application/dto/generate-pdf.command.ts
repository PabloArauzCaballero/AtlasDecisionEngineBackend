/**
 * La entrada universal (§15).
 *
 * Es lo ÚNICO que un artefacto del ecosistema necesita construir: qué template, qué datos y,
 * si acaso, cómo se llama el archivo. No hay hueco para HTML, ni para CSS, ni para una ruta,
 * ni para el nombre de una fuente — no por austeridad, sino porque cada uno de esos huecos
 * sería una vía por la que el consumidor pasa a ser responsable del aspecto del documento, y
 * a partir de ahí el generador ya no puede cambiar nada sin romperle el informe a alguien.
 */
import type { DocumentClassification } from '../../domain/enums/document.enums';
import type { PageSetupOverrides } from '../../domain/value-objects/page-setup';

export interface GenerationMetadata {
  /** Fuerza el identificador del documento; si no viene, lo emite el worker. */
  readonly documentId?: string;
  readonly correlationId?: string;
  /** Quién pidió el documento. Se archiva y se imprime si la marca lo declara. */
  readonly requestedBy?: string;
  /** BCP-47. Decide el formato de fechas y números dentro de la plantilla. */
  readonly locale?: string;
  /** IANA (`America/La_Paz`). Sin él, el pie fecharía en UTC y nadie lo diría. */
  readonly timezone?: string;
  /** Ver §31 y `IdempotencyStorePort`. */
  readonly idempotencyKey?: string;
}

/**
 * Opciones sobrescribibles desde la petición (§13).
 *
 * La lista es corta A PROPÓSITO y está publicada en `config-precedence.ts`. Todo lo demás
 * —tipografía, colores, membrete, pie institucional, escala— es `protected`: lo fijan la
 * marca y el template, y un intento de fijarlo aquí se rechaza con
 * `PROTECTED_OPTION_OVERRIDE` en vez de ignorarse.
 */
export interface GenerationOptions {
  readonly persist?: boolean;
  readonly filename?: string;
  /** Se sanea siempre; ver `safeFilename`. */
  readonly classification?: DocumentClassification;
  readonly page?: PageSetupOverrides;
  /** `false` en el modo asíncrono: el búfer no viaja por la cola. */
  readonly returnContent?: boolean;
}

export interface GeneratePdfCommand<TPayload = unknown> {
  readonly templateId: string;
  /** Ausente = última versión publicada. La resuelta se archiva en el resultado. */
  readonly templateVersion?: string;
  readonly payload: TPayload;
  /** Identidad visual. Ausente = la marca por defecto del despliegue. */
  readonly brandId?: string;
  readonly metadata?: GenerationMetadata;
  readonly options?: GenerationOptions;
}

/** Previsualización: mismos caminos, datos ficticios del propio template (§21). */
export interface PreviewTemplateCommand {
  readonly templateId: string;
  readonly templateVersion?: string;
  readonly brandId?: string;
  /**
   * Payload alternativo. Si falta, se usa `fixture()`.
   *
   * Se valida contra el MISMO contrato: una previsualización que acepta datos que la
   * generación rechazaría no sirve para comprobar nada.
   */
  readonly payload?: unknown;
  readonly locale?: string;
  readonly timezone?: string;
}

export interface ValidatePayloadCommand {
  readonly templateId: string;
  readonly templateVersion?: string;
  readonly payload: unknown;
}
