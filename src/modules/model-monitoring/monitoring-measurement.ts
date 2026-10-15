/** Una versión desplegada en producción, que es lo único que se vigila. */
export interface LiveVersion {
  tenantId: bigint;
  artifactVersionId: bigint;
  artifactCode: string;
}

export interface Measurement {
  metricCode: string;
  scope: string;
  value: number;
  sampleSize: number;
  details: Record<string, unknown>;
}
