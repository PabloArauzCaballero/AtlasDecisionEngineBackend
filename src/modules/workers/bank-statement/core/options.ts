/**
 * Opciones del motor de extractos, recortadas a lo que el motor usa de verdad.
 *
 * El paquete original declaraba aquí también `enableUi`, `enableDocs` y
 * `docsAssetUrl`, que gobernaban una interfaz HTML y una referencia interactiva
 * propias. Ninguna de las dos se absorbe: el portal ya provee la interfaz, y
 * publicar una segunda referencia de API sin control de acceso —el módulo
 * original no autenticaba ninguna ruta— habría abierto un mapa de la superficie
 * del motor a cualquiera. Con los controladores fuera, esas tres opciones no
 * tenían quien las leyera, así que desaparecen en vez de quedarse como
 * configuración muerta que alguien acabaría creyéndose.
 *
 * Los valores por defecto sí cambian respecto del paquete original, y los
 * gobierna la configuración del motor (`BANK_STATEMENT_*`), no este archivo.
 */
export const BANK_STATEMENT_OPTIONS = Symbol('BANK_STATEMENT_OPTIONS');

export interface BankStatementModuleOptions {
  maxFileSizeBytes: number;
  /** Rechaza PDF con más páginas que esto antes de leer su contenido de texto. */
  maxPageCount: number;
  /** Presupuesto de tiempo para la extracción completa del PDF. */
  processingTimeoutMs: number;
  /**
   * Perfiles de formato en JSON, tal como se cargarían de un archivo o de una
   * base de datos. Se validan al registrar el módulo: un perfil mal formado
   * debe fallar al arrancar, no en mitad de una conversión.
   *
   * Añadir un formato con un perfil no exige tocar el código del motor.
   */
  statementProfiles?: readonly unknown[];
}

export const DEFAULT_BANK_STATEMENT_OPTIONS: BankStatementModuleOptions = {
  maxFileSizeBytes: 10 * 1_048_576,
  maxPageCount: 60,
  processingTimeoutMs: 15_000,
  statementProfiles: [],
};
