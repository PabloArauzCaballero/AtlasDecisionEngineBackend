export interface OpenApiIdentity {
  /** Versión del CONTRATO (`API_VERSION`), no del build. */
  apiVersion: string;
  buildVersion: string;
  commitSha: string;
  /**
   * URL pública del despliegue, cuando se conoce. Sin ella se publica solo el servidor
   * relativo: un contrato con la URL de otro ambiente hace que un cliente generado apunte
   * al sitio equivocado, que es peor que no decir nada.
   */
  publicUrl?: string;
}

/**
 * Rutas públicas por diseño: son las sondas del orquestador y deben poder consultarse sin
 * credencial. Se listan aquí para poder vaciarles la seguridad heredada del documento.
 */
export const PUBLIC_OPENAPI_PATHS = ['/health', '/health/live', '/health/ready', '/ready'];
