import { BOLIVIA_INSTITUTIONS, type BoliviaInstitution } from './bolivia-institutions';

/**
 * De dónde saca el motor el padrón de entidades, resuelto en cada documento.
 *
 * Es una función y no una lista congelada al construir el motor, y esa es toda
 * su razón de ser: el padrón se administra desde el portal y una licencia se
 * revoca por resolución de ASFI, no por despliegue. Con una lista capturada en
 * el constructor, revocar una entidad no tendría efecto hasta reiniciar el
 * proceso —y el motor se construye una sola vez por worker, así que «hasta
 * reiniciar» puede ser días—. Con esta indirección, quien administra el padrón
 * ve el cambio en el siguiente documento.
 *
 * El anfitrión decide qué hay detrás: una tabla con caché, un archivo, o la
 * semilla compilada.
 */
export interface InstitutionRegistry {
  list(): readonly BoliviaInstitution[];
  /**
   * Si lo que `list()` acaba de devolver es el padrón VIGENTE o la semilla de
   * respaldo.
   *
   * No es telemetría: es un dato del que depende el veredicto. La semilla
   * compilada dice `LICENSED` de entidades cuya licencia pudo revocarse después
   * —una revocación de ASFI se administra en la base, no se despliega—, así que
   * servirla en silencio hacía que un documento que debía ir a revisión saliera
   * aceptado, y justo cuando la capa de datos estaba caída. Quien decide
   * necesita poder distinguir «esta entidad tiene licencia» de «no pude
   * comprobarlo y estoy leyendo una foto vieja».
   */
  isAuthoritative(): boolean;
}

/** El padrón compilado: la nómina de ASFI que viaja con el código. */
export const ASFI_SEED_REGISTRY: InstitutionRegistry = {
  list: () => BOLIVIA_INSTITUTIONS,
  /*
   * La semilla es autoritativa cuando se elige A PROPÓSITO: un despliegue sin
   * padrón administrado no está degradado, simplemente no tiene esa fuente. Lo
   * que no es autoritativo es CAER en ella tras un fallo de carga, y eso lo
   * marca `resolvedRegistry`.
   */
  isAuthoritative: () => true,
};

/**
 * Padrón fijo a partir de una lista dada. Para pruebas y para el anfitrión que
 * quiere un padrón propio sin montar una caché.
 */
export function fixedRegistry(institutions: readonly BoliviaInstitution[]): InstitutionRegistry {
  return { list: () => institutions, isAuthoritative: () => true };
}

/**
 * Padrón resuelto por una función, con la semilla como red.
 *
 * Que un padrón vacío caiga a la semilla NO es una comodidad: es lo que impide
 * que un fallo de la base de datos —o una tabla todavía sin sembrar— deje al
 * motor sin ninguna entidad reconocible y convierta TODOS los extractos en
 * «entidad desconocida» a la vez. Un padrón vacío nunca es una afirmación sobre
 * el sistema financiero boliviano; siempre es un fallo de carga.
 */
export function resolvedRegistry(
  resolve: () => readonly BoliviaInstitution[] | undefined,
): InstitutionRegistry {
  /*
   * `list()` e `isAuthoritative()` se responden con UNA sola resolución.
   * Llamando a `resolve()` dos veces, una carga que se recupera entre ambas
   * llamadas devolvería la semilla marcada como vigente —o al revés—, que es la
   * incoherencia que este par existe para impedir.
   */
  const resolveOnce = () => {
    const institutions = resolve();
    const authoritative = Boolean(institutions && institutions.length > 0);
    return {
      institutions: authoritative
        ? (institutions as readonly BoliviaInstitution[])
        : BOLIVIA_INSTITUTIONS,
      authoritative,
    };
  };

  return {
    list: () => resolveOnce().institutions,
    isAuthoritative: () => resolveOnce().authoritative,
  };
}
