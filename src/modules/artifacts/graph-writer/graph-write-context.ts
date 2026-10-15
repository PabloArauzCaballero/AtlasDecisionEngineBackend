/** A qué versión de qué tenant se está escribiendo el grafo. */
export interface GraphWriteContext {
  readonly tenantId: bigint;
  readonly versionId: bigint;
}
