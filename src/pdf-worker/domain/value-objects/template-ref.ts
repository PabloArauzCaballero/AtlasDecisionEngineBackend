/**
 * Referencia inmutable a un template: `id` + `version`.
 *
 * Es el objeto que se archiva junto al documento (§9). Que sea un value object y no dos
 * cadenas sueltas tiene una consecuencia práctica: no hay ningún punto del código donde se
 * pueda guardar el `id` y perder la `version`, que es exactamente cómo un archivo histórico
 * deja de poder reconstruirse.
 */
import { TemplateNotFoundError } from '../errors/pdf-worker.errors';

/** `kebab-case`, 3–64 caracteres. También es nombre de carpeta, de ahí lo restrictivo. */
export const TEMPLATE_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Versionado semántico estricto, sin `v` inicial y sin sufijos de precompilación. */
export const TEMPLATE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export class TemplateRef {
  private constructor(
    readonly id: string,
    readonly version: string,
  ) {
    Object.freeze(this);
  }

  static of(id: string, version: string): TemplateRef {
    if (!TEMPLATE_ID_PATTERN.test(id) || id.length < 3 || id.length > 64) {
      throw new TemplateNotFoundError(id);
    }
    if (!TEMPLATE_VERSION_PATTERN.test(version)) {
      throw new TemplateNotFoundError(`${id}@${version}`);
    }
    return new TemplateRef(id, version);
  }

  /**
   * Acepta `credit-analysis-report` o `credit-analysis-report@1.2.0`.
   *
   * Sin versión devuelve `undefined` en `version`, que el registro interpreta como «la última
   * publicada». Resolverlo aquí a la última sería peor: el caso de uso tiene que poder
   * DISTINGUIR «pidieron cualquiera» de «pidieron la 1.2.0» para archivar la verdad.
   */
  static parse(reference: string): { id: string; version?: string } {
    const at = reference.lastIndexOf('@');
    if (at <= 0) return { id: reference };
    return { id: reference.slice(0, at), version: reference.slice(at + 1) };
  }

  toString(): string {
    return `${this.id}@${this.version}`;
  }

  equals(other: TemplateRef): boolean {
    return this.id === other.id && this.version === other.version;
  }
}

/** Orden semántico ascendente. Devuelve <0, 0 o >0, apto para `Array.prototype.sort`. */
export function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** La mayor de las versiones dadas, o `undefined` si la lista viene vacía. */
export function latestVersion(versions: readonly string[]): string | undefined {
  if (versions.length === 0) return undefined;
  return [...versions].sort(compareVersions).at(-1);
}
