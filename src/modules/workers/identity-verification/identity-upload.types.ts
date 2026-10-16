/** Los tres campos de archivo que acepta el alta. */
export const IMAGE_FIELDS = [
  { name: 'document', maxCount: 1 },
  { name: 'documentBack', maxCount: 1 },
  { name: 'selfie', maxCount: 1 },
];

/**
 * Los archivos tal como los deja `FileFieldsInterceptor`.
 *
 * Se declara estructuralmente y no como `Express.Multer.File`, igual que hace
 * el controlador de extractos: el motor no instala `@types/multer` —el tipo no
 * aporta nada que estos tres campos no digan ya— y añadirlo sólo para nombrar
 * una forma que aquí se usa entera sería una dependencia por comodidad.
 */
export interface UploadedImage {
  originalname?: string;
  buffer?: Buffer;
  size?: number;
  mimetype?: string;
}

export interface UploadedImages {
  document?: UploadedImage[];
  documentBack?: UploadedImage[];
  selfie?: UploadedImage[];
}
