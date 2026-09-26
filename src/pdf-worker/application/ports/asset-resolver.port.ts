/**
 * Resolución de logotipos, imágenes, iconos y fuentes (§22).
 *
 * Devuelve SIEMPRE un `data:` URI, nunca una URL. Esa decisión resuelve tres problemas a la
 * vez: el render deja de depender de la red (§25), el documento sale idéntico en un portátil
 * sin conexión y en un contenedor de CI, y se cierra la vía por la que un payload podría
 * hacer que el navegador visitase una dirección interna (SSRF, §24).
 *
 * El coste es real —un logotipo de 40 KiB se convierte en ~54 KiB de base64 dentro del HTML—
 * y por eso el resolutor cachea y limita el tamaño; lo que no hace es negociarlo con la red.
 */
export interface ResolvedAsset {
  readonly reference: string;
  readonly mimeType: string;
  readonly dataUri: string;
  readonly sizeBytes: number;
}

export interface AssetResolverPort {
  /** `asset:logo-atlas.svg`. Cualquier otra forma —incluida una URL— se rechaza. */
  resolve(reference: string): Promise<ResolvedAsset>;
  /** Precarga y valida un juego de recursos al arrancar: un logotipo que falta se ve el día uno. */
  warmup(references: readonly string[]): Promise<void>;
  /** Nombres disponibles, para el diagnóstico de `/health` y para el mensaje de error. */
  listAvailable(): Promise<readonly string[]>;
}

export const ASSET_RESOLVER_PORT = Symbol('AssetResolverPort');
