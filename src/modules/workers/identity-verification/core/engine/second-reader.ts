import type { ExtractedIdentityData } from '../domain/extracted-identity.types';
import type { SecondReadingProposal } from '../ports/identity.ports';
import { parseMrzTd1 } from '../parsers/mrz-td1';

/**
 * Qué se hace con lo que propuso el segundo lector.
 *
 * **La regla entera, en una frase: el modelo propone y la aritmética decide.**
 *
 * Un modelo multimodal leyendo un carnet acierta casi siempre y se equivoca sin
 * avisar, con la misma prosa segura. Eso lo descarta como fuente de verdad y lo
 * hace excelente como CANDIDATO, porque este documento trae su propio
 * verificador dentro: la MRZ lleva dígitos de control sobre el número y las
 * fechas. Un número inventado no cuadra con ellos; uno bien leído, sí.
 *
 * De ahí las tres reglas que implementa este archivo:
 *
 * 1. **Nunca pisa lo que ya se leyó.** Si el analizador sacó el campo, la
 *    propuesta sólo sirve para COMPARAR. Coinciden: nada que hacer. Discrepan:
 *    aviso `SECOND_READER_DISAGREEMENT`, que es información nueva y valiosa —dos
 *    lectores independientes leyeron cosas distintas de la misma tinta— y por
 *    eso se manda a una persona en vez de elegir a uno de los dos.
 * 2. **Rellena sólo los huecos**, y lo que rellena queda marcado `MODEL`.
 * 3. **`MODEL` no cuenta como documento leído.** `requiredFieldsPresent` ignora
 *    esa procedencia, así que un campo puesto por el modelo NUNCA convierte una
 *    revisión en una aprobación. Lo que sí hace es llegar a la bandeja con el
 *    dato ya escrito, que es donde estaba el coste real.
 *
 * La única excepción, y es la que justifica todo lo demás: **si la MRZ se leyó
 * y su dígito de control cuadra, la MRZ manda**. Un número propuesto que
 * coincide con una MRZ verificada no es una opinión del modelo, es el mismo
 * dato por dos caminos independientes, y sube a procedencia `MRZ` con todos sus
 * derechos. Ahí el segundo lector sí desatasca casos de verdad.
 */

export interface SecondReadingOutcome {
  readonly fields: ExtractedIdentityData;
  readonly riskFlags: readonly string[];
  /** Campos que se rellenaron, para la traza. */
  readonly filled: readonly string[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const INDEFINIDO = 'INDEFINIDO';

export function reconcileSecondReading(
  fields: ExtractedIdentityData,
  proposal: SecondReadingProposal,
  mrzRawText: string,
): SecondReadingOutcome {
  const resultado: ExtractedIdentityData = { ...fields };
  const riskFlags: string[] = [];
  const filled: string[] = [];

  // La MRZ es el árbitro. `checks` dice qué cuadró: lo que no cuadró no arbitra
  // nada, porque un dígito de control fallido significa que ese dato se leyó mal.
  const mrz = parseMrzTd1(mrzRawText);

  const aplicar = (
    clave: 'documentNumber' | 'firstNames' | 'lastNames' | 'dateOfBirth' | 'expirationDate',
    propuesto: string | undefined,
    corroboradoPorMrz: boolean,
  ): void => {
    const limpio = propuesto?.trim();
    if (limpio === undefined || limpio.length === 0) return;

    const actual = resultado[clave]?.value;
    if (actual !== null && actual !== undefined && String(actual).length > 0) {
      // Ya había dato: la propuesta no pisa, sólo delata.
      if (!equivalentes(String(actual), limpio)) {
        riskFlags.push('SECOND_READER_DISAGREEMENT');
      }
      return;
    }

    resultado[clave] = {
      value: limpio,
      // La confianza no se inventa: quien la use tiene que mirar `source`.
      confidence: null,
      source: corroboradoPorMrz ? 'MRZ' : 'MODEL',
    };
    filled.push(clave);
    if (!corroboradoPorMrz) riskFlags.push('FIELD_PROPOSED_BY_MODEL');
  };

  // --- Número: el único campo con verificador aritmético propio -------------
  const numeroPropuesto = normalizarNumero(proposal.documentNumber);
  if (numeroPropuesto !== undefined) {
    const mrzNumero = mrz?.checks.documentNumber === true ? mrz.documentNumber : null;
    if (mrzNumero !== null && mrzNumero !== undefined) {
      if (normalizarNumero(mrzNumero) === numeroPropuesto) {
        // Dos caminos independientes, el mismo número, y uno de ellos con
        // dígito de control. Esto ya no es una propuesta.
        aplicar('documentNumber', numeroPropuesto, true);
      } else {
        // El modelo leyó algo que la MRZ desmiente. Se descarta y se avisa: el
        // caso puede tener un problema de lectura o de montaje, y ninguna de
        // las dos se resuelve quedándose con una de las dos cifras.
        riskFlags.push('SECOND_READER_MRZ_MISMATCH');
      }
    } else {
      aplicar('documentNumber', numeroPropuesto, false);
    }
  }

  aplicar('firstNames', proposal.firstNames, false);
  aplicar('lastNames', proposal.lastNames, false);
  aplicar('dateOfBirth', fecha(proposal.dateOfBirth), false);
  aplicar('expirationDate', caducidad(proposal.expirationDate), false);

  return { fields: resultado, riskFlags: [...new Set(riskFlags)], filled };
}

/**
 * Si `requiredFieldsPresent` puede apoyarse en este campo.
 *
 * Un campo `MODEL` está presente para la persona que revisa y ausente para la
 * decisión automática. Esa asimetría es el punto entero del segundo lector.
 */
export function cuentaComoLeido(source: string | undefined): boolean {
  return source !== 'MODEL';
}

/** Compara ignorando mayúsculas, acentos y separadores: `1234-567` es `1234567`. */
function equivalentes(a: string, b: string): boolean {
  return normalizarTexto(a) === normalizarTexto(b);
}

function normalizarTexto(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^A-Za-z0-9]/gu, '')
    .toUpperCase();
}

/**
 * El número de cédula boliviano admite complemento (`1234567-1A`), y el modelo
 * puede devolverlo con o sin él. Se conserva tal cual salvo espacios: recortar
 * el complemento aquí perdería un dato que distingue a dos personas.
 */
function normalizarNumero(valor: string | undefined): string | undefined {
  const limpio = valor?.replace(/\s+/gu, '').toUpperCase();
  return limpio !== undefined && /^[0-9][0-9A-Z-]{4,14}$/u.test(limpio) ? limpio : undefined;
}

function fecha(valor: string | undefined): string | undefined {
  return valor !== undefined && ISO_DATE.test(valor.trim()) ? valor.trim() : undefined;
}

function caducidad(valor: string | undefined): string | undefined {
  const limpio = valor?.trim().toUpperCase();
  if (limpio === INDEFINIDO) return INDEFINIDO;
  return fecha(valor);
}
