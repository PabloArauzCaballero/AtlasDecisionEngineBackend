import type { EnvRule } from './env-rule';

export const retainIdentityImagesOnlyWithStorage: EnvRule = (value, ctx) => {
  /*
   * Retención de imágenes: o hay almacén, o se declara que no importa.
   *
   * Sin esta comprobación, la única señal de que las caras y las cédulas se están
   * perdiendo era su ausencia semanas después, cuando alguien fuera a revisar un caso
   * cerrado. Con `IDENTITY_IMAGE_RETENTION_REQUIRED=true` una configuración incompleta
   * impide arrancar, que es donde se descubre a tiempo.
   */
  if (value.IDENTITY_IMAGE_RETENTION_REQUIRED) {
    const faltantes = (
      [
        ['STORAGE_S3_ENDPOINT', value.STORAGE_S3_ENDPOINT],
        ['STORAGE_S3_BUCKET', value.STORAGE_S3_BUCKET],
        ['STORAGE_S3_ACCESS_KEY_ID', value.STORAGE_S3_ACCESS_KEY_ID],
        ['STORAGE_S3_SECRET_ACCESS_KEY', value.STORAGE_S3_SECRET_ACCESS_KEY],
      ] as const
    )
      .filter(([, declarado]) => !declarado)
      .map(([nombre]) => nombre);

    if (faltantes.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['IDENTITY_IMAGE_RETENTION_REQUIRED'],
        message:
          `Se exige conservar las imágenes de identidad pero falta configurar el almacén: ${faltantes.join(', ')}. ` +
          'Declara MinIO, o pon IDENTITY_IMAGE_RETENTION_REQUIRED=false para aceptar que se pierdan al cerrar cada ejecución.',
      });
    }
  }
};
