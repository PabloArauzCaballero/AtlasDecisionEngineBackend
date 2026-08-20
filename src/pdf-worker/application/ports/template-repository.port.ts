/**
 * Acceso al catálogo de templates (§8).
 *
 * Existe para que ningún caso de uso contenga un `switch (templateId)`. Añadir un documento
 * es registrar un contrato; el motor central no cambia (§50). El puerto es de LECTURA salvo
 * `register`, que sólo se invoca durante la composición del módulo: publicar un template en
 * caliente desde una petición sería aceptar plantillas del exterior, que es justo lo que el
 * §24 prohíbe.
 */
import type { TemplateContract } from '../../domain/contracts/template-contract';

export interface TemplateRepositoryPort {
  /**
   * Devuelve el contrato exacto. Sin `version`, la última publicada.
   *
   * Lanza `TemplateNotFoundError` o `TemplateVersionNotFoundError`: devolver `undefined`
   * obligaría a cada llamante a inventar su propio mensaje, y el catálogo de errores dejaría
   * de ser el único sitio donde se lee qué significa cada rechazo.
   */
  getTemplate(templateId: string, version?: string): TemplateContract;
  hasTemplate(templateId: string, version?: string): boolean;
  /** Un resumen por template, en su ÚLTIMA versión. */
  listTemplates(): readonly TemplateContract[];
  /** Todas las versiones registradas de un template, en orden semántico ascendente. */
  listVersions(templateId: string): readonly string[];
  getLatestVersion(templateId: string): string;
  register(contract: TemplateContract): void;
  /**
   * Retira una versión del catálogo en memoria.
   *
   * Sólo la usa la administración, y sólo sobre templates publicados por la API. El registro
   * no sabe de orígenes ni de permisos: quién puede retirar qué lo decide el caso de uso.
   */
  unregister(templateId: string, version: string): void;
  readonly size: number;
}

export const TEMPLATE_REPOSITORY_PORT = Symbol('TemplateRepositoryPort');
