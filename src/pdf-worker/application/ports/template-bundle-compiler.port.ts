/**
 * Convierte un paquete subido en un contrato registrable.
 *
 * Es un puerto y no una función importada directamente por la razón de siempre en este worker:
 * la conversión conoce Zod, el motor de plantillas y las reglas de sintaxis, y la aplicación no
 * puede conocer ninguna de las tres. Con el puerto, `ManageTemplatesUseCase` se prueba dándole
 * un compilador de mentira y sin cargar el validador entero.
 *
 * `compile` valida y LANZA `TemplateBundleInvalidError` con todos los problemas juntos. No
 * devuelve un resultado parcial: un contrato a medias registrado es peor que ninguno.
 */
import type { TemplateBundle } from '../../domain/contracts/template-bundle';
import type { TemplateContract } from '../../domain/contracts/template-contract';

export interface CompiledBundle {
  readonly contract: TemplateContract;
  readonly bundle: TemplateBundle;
}

export interface TemplateBundleCompilerPort {
  compile(input: unknown): CompiledBundle;
  /** El paquete de ejemplo que se publica para descargar. Vive con el compilador porque es
   *  quien conoce el formato exacto que acepta; separarlos garantiza que se desincronicen. */
  example(): TemplateBundle;
  /** JSON Schema del paquete, para que una máquina sepa qué mandar. */
  jsonSchema(): unknown;
}

export const TEMPLATE_BUNDLE_COMPILER_PORT = Symbol('TemplateBundleCompilerPort');
