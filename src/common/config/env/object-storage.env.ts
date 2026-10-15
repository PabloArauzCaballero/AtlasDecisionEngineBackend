import { z } from 'zod';
import { booleanFromString, emptyAsUndefined } from './helpers';

export const objectStorageEnv = {
  // --- Almacenamiento persistente de objetos (MinIO) ------------------------------------
  //
  // Hasta 2026-09-03 el motor no tenía ninguno, y las imágenes de identidad vivían en
  // columnas `Bytes` que se ponían a `null` al cerrar cada ejecución. Eso resolvía la
  // privacidad y el crecimiento de la tabla a la vez, pero significaba que la cara y la
  // cédula de un cliente NO EXISTÍAN en cuanto había veredicto: ni para revisar el caso
  // más tarde, ni para responder a una impugnación, ni para auditar la decisión.
  //
  // Ahora las imágenes se copian a MinIO al INGRESAR —una sola escritura, antes de crear
  // la fila— y las columnas `Bytes` siguen siendo la copia de trabajo del pipeline y se
  // siguen borrando igual. Los seis sitios que las ponían a `null` no cambiaron.
  //
  // Vacío = sin almacén: las imágenes vuelven a perderse al cerrar. Se permite porque las
  // pruebas y el desarrollo local no siempre levantan MinIO, pero
  // `IDENTITY_IMAGE_RETENTION_REQUIRED` lo convierte en un fallo de arranque donde importa.
  STORAGE_S3_ENDPOINT: emptyAsUndefined(z.string().url().optional()),
  // Por donde llega el NAVEGADOR del revisor, si no es el mismo camino que este proceso.
  STORAGE_S3_PUBLIC_ENDPOINT: emptyAsUndefined(z.string().url().optional()),
  STORAGE_S3_BUCKET: emptyAsUndefined(z.string().min(1).optional()),
  STORAGE_S3_REGION: z.string().min(1).default('us-east-1'),
  STORAGE_S3_ACCESS_KEY_ID: emptyAsUndefined(z.string().min(1).optional()),
  STORAGE_S3_SECRET_ACCESS_KEY: emptyAsUndefined(z.string().min(1).optional()),
  // MinIO y compatibles exigen el bucket en la ruta; AWS acepta ambos estilos.
  STORAGE_S3_FORCE_PATH_STYLE: booleanFromString.default(true),
  STORAGE_URL_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(300),
  // Prefijo de las imágenes de identidad dentro del bucket compartido con AtlasBackend.
  // Es lo que permite una política de retención propia sin mover un objeto.
  STORAGE_IDENTITY_KEY_PREFIX: z.string().default('identity'),
  // Prefijo del extracto bancario. Separado del de identidad porque son dos poblaciones con
  // sensibilidad y vida útil distintas: un PDF de banco no es la cara de una persona, y poder
  // aplicarles retenciones diferentes sin mover un objeto es justo lo que da el prefijo.
  STORAGE_STATEMENT_KEY_PREFIX: z.string().default('statements'),
  /*
   * Con `true`, arrancar sin almacén es un error en vez de una degradación silenciosa.
   *
   * **Por omisión `true` desde el 2026-09-11.** Estaba en `false`, o sea «acepto perder las
   * imágenes», y eso es lo que pasaba: el stack local no tenía almacén y cada verificación se
   * encolaba con un aviso en el log y las tres claves de objeto en `null`. Medido sobre una
   * cédula boliviana auténtica, tres veces seguidas. Un valor por omisión que renuncia a la
   * evidencia sobre la que se decide acerca de una persona no puede ser el que se aplica cuando
   * nadie eligió nada; quien de verdad acepte esa pérdida ahora lo dice en voz alta poniéndolo
   * en `false`.
   */
  // Con `true` —lo predeterminado—, arrancar sin almacén es un error en vez de una degradación silenciosa que pierde la evidencia de cada decisión.
  IDENTITY_IMAGE_RETENTION_REQUIRED: booleanFromString.default(true),
};
