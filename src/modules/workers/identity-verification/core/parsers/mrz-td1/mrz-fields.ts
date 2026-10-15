/**
 * Apellidos y nombres del tercer renglón: `APELLIDOS<<NOMBRES`.
 *
 * Se quitan las CIFRAS de los extremos, y no es cosmética. El tercer renglón es
 * el único de la TD1 sin dígito de control, así que no hay con qué elegir entre
 * sus alineaciones y se toma tal cual; cuando el reconocedor le cuelga un glifo
 * por delante —medido sobre una cédula auténtica: `4QUISPE<MAMANI<<ANA…`—
 * ese glifo se queda PEGADO al apellido y viaja al expediente como parte del
 * nombre de una persona.
 *
 * Sólo se quitan cifras y signos, nunca letras: la norma reserva este renglón a
 * `A-Z` y al relleno, así que un dígito ahí es ruido con certeza. Una letra de
 * más no se puede distinguir de un apellido raro, y no se toca.
 */
export function splitNames(line: string): { lastNames: string | null; firstNames: string | null } {
  const [apellidos, nombres] = line.split('<<');
  const limpiar = (valor: string | undefined): string | null => {
    const texto = (valor ?? '')
      .replace(/</g, ' ')
      .replace(/[^A-ZÑ ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return texto.length > 1 ? texto : null;
  };
  return { lastNames: limpiar(apellidos), firstNames: limpiar(nombres) };
}

/**
 * `AAMMDD` a fecha ISO.
 *
 * El siglo no está en la MRZ y hay que decidirlo. Para un NACIMIENTO, un año
 * por delante del actual sólo puede ser del siglo pasado; para una CADUCIDAD es
 * al revés —una tarjeta caduca hacia adelante—, así que se toma el 20xx salvo
 * que quede absurdamente lejos.
 */
export function toIsoDate(valor: string, tipo: 'nacimiento' | 'caducidad'): string | null {
  if (!/^\d{6}$/.test(valor)) return null;
  const aa = Number(valor.slice(0, 2));
  const mm = Number(valor.slice(2, 4));
  const dd = Number(valor.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

  const dosDigitosDeHoy = new Date().getUTCFullYear() % 100;
  const anio = tipo === 'nacimiento' ? (aa > dosDigitosDeHoy ? 1900 + aa : 2000 + aa) : 2000 + aa;

  const fecha = new Date(Date.UTC(anio, mm - 1, dd));
  if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mm - 1) return null;
  return `${anio}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}
