/**
 * Los logotipos de las entidades del padrón, tal como viajan con el código.
 *
 * ## Por qué viven en el repositorio y no se piden a la web del banco
 *
 * Porque el padrón no puede depender de que sesenta y ocho sitios ajenos sigan
 * en pie y sirviendo la misma ruta. El día que un banco rehace su web, una
 * pantalla que pinta `<img src="https://banco.example/logo.svg">` se llena de
 * imágenes rotas y quien la mira concluye que el padrón está mal — cuando lo que
 * se rompió es una URL de un tercero. Y peor: obligaría al navegador de quien
 * administra el padrón a pedir recursos a sesenta y ocho dominios distintos, que
 * es una fuga de comportamiento hacia fuera a cambio de un adorno.
 *
 * Se descargaron una vez, se revisaron uno a uno, y se sirven desde el motor.
 *
 * ## Descargado ≠ generado, y la diferencia se publica
 *
 * De las sesenta y ocho entidades de la nómina de ASFI, quince publican un
 * logotipo utilizable en su sitio. Las demás —la mayoría de las cuarenta y una
 * cooperativas y varias IFD— no tienen sitio, lo tienen caído, o no publican
 * ninguna imagen aprovechable. Para ésas el motor compone un **monograma** con
 * la sigla de ASFI sobre el color de su tipo de entidad.
 *
 * El monograma NO se presenta como si fuera la marca: cada fila lleva
 * `logoSource`, y la pantalla lo rotula. Sin esa distinción alguien acabaría
 * creyendo que el cuadrado verde con tres letras ES el logotipo de la
 * cooperativa, y lo usaría en un documento que sale de la casa.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type InstitutionLogoSource = 'DOWNLOADED' | 'GENERATED' | 'UPLOADED';

export interface InstitutionLogoSeed {
  readonly code: string;
  readonly file: string;
  readonly contentType: string;
  readonly source: InstitutionLogoSource;
  /** La URL exacta de la que se descargó. `null` en los monogramas. */
  readonly sourceUrl: string | null;
  readonly website: string | null;
}

/**
 * La carpeta de los archivos, resuelta desde este módulo.
 *
 * `__dirname` y no la raíz del proyecto: en la imagen de producción el proceso
 * arranca desde `/app` y el código vive en `/app/dist`, así que cualquier ruta
 * relativa al directorio de trabajo apunta a un sitio distinto en desarrollo y en
 * producción. Los archivos se copian a `dist` por la entrada `assets` de
 * `nest-cli.json`.
 */
const LOGO_DIR = join(__dirname, 'logos');

let cached: readonly InstitutionLogoSeed[] | null = null;

/**
 * El manifiesto, leído una vez.
 *
 * Un fallo de lectura devuelve lista vacía y NO revienta el arranque: sin
 * logotipos el padrón sigue funcionando entero —atribuye documentos igual— y
 * tumbar el motor porque falta un adorno sería la peor forma posible de fallar.
 */
export function institutionLogoSeed(): readonly InstitutionLogoSeed[] {
  if (cached) return cached;
  try {
    const raw = readFileSync(join(LOGO_DIR, 'manifest.json'), 'utf8');
    const parsed = JSON.parse(raw) as InstitutionLogoSeed[];
    cached = Array.isArray(parsed) ? parsed : [];
  } catch {
    cached = [];
  }
  return cached;
}

/** Los bytes del logotipo de una entidad, o `null` si no hay archivo. */
export function readInstitutionLogo(seed: InstitutionLogoSeed): Buffer | null {
  try {
    /*
     * El nombre del archivo se toma del manifiesto y aun así se comprueba: es
     * un dato de un archivo JSON, y un `..` dentro convertiría la carga de
     * logotipos en una lectura arbitraria del sistema de archivos. El manifiesto
     * lo escribe el repositorio, no un usuario, pero el coste de comprobarlo es
     * una expresión regular y el de no comprobarlo es una vulnerabilidad de
     * recorrido de rutas esperando a que alguien haga el manifiesto editable.
     */
    if (!/^[A-Z0-9_-]+\.(svg|png|jpg|jpeg)$/i.test(seed.file)) return null;
    return readFileSync(join(LOGO_DIR, seed.file));
  } catch {
    return null;
  }
}
