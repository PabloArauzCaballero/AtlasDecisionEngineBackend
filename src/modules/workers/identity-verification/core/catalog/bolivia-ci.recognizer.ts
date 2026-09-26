/**
 * ¿Qué GENERACIÓN de cédula boliviana es ésta, y cuánta de su plantilla se ve?
 *
 * ## Qué problema resuelve
 *
 * El worker tenía dos formas de contestar «esto es una cédula» y las dos fallan
 * sobre una fotografía real:
 *
 * - `HeuristicDocumentClassifierAdapter` buscaba literalmente `CEDULA` o
 *   `IDENTIDAD` en el texto leído. Medido sobre una cédula auténtica del DS 4924
 *   fotografiada con un móvil, el reconocedor devuelve `CEI 1 DE` y `IDENTI AD`:
 *   ninguna de las dos casa, así que el tipo salía `UNKNOWN` **en las cuatro
 *   orientaciones**. Y como la búsqueda de orientación usaba ese mismo
 *   clasificador como criterio de éxito, tampoco encontraba el giro bueno. El
 *   resultado que veía la persona era «la imagen no corresponde a ningún
 *   documento de identidad soportado» sobre su cédula perfectamente válida.
 * - `template-conformance.ts` medía la cobertura con expresiones exactas y le
 *   daba entre 0,059 y 0,186 a esa misma cédula, muy por debajo del 0,55 que
 *   `identity-fraud.scorer.ts` exige: o sea que si la puerta la hubiera dejado
 *   pasar, la habría marcado como plantilla incompleta.
 *
 * Este archivo es la respuesta única a las dos preguntas, y es el reparto que
 * ya usa el worker de extractos con las entidades financieras
 * (`bank-statement/core/institutions/signal-descriptors.ts`): un catálogo
 * VERSIONADO de lo que cada generación imprime, un cotejo tolerante a las
 * erratas del reconocedor, y un **porcentaje de evidencia** sobre el que decidir.
 * No hay dos vocabularios ni dos umbrales: la cobertura que clasifica es la
 * misma que después mide la conformidad.
 *
 * ## Por qué mide contra cada generación y se queda con la mejor
 *
 * Porque las dos conviven legítimamente y son distintas. Una cédula de 2021 no
 * lleva MRZ; exigirle la plantilla nueva la rechazaría por falsa, que es el peor
 * error posible de este módulo. Un documento tiene que parecerse mucho a
 * *alguna* cédula boliviana real, no a la última.
 *
 * ## Lo que NO hace
 *
 * No decide. Devuelve una medida y la lista de lo que casó; quién decide es
 * `identity-triage.ts` para la puerta y `identity-fraud.scorer.ts` para la
 * autenticidad, cada uno con los umbrales de su despliegue.
 */

import {
  PLANTILLAS,
  type AnclajeDeCatalogo,
  type BoliviaCiGeneration,
  type PlantillaDeCedula,
} from './bolivia-ci.catalog';
import { casarGrafias, plegarParaCotejo } from './approximate-match';

/** El resultado de contrastar una lectura con una plantilla del catálogo. */
export interface ConformidadDePlantilla {
  readonly generacion: BoliviaCiGeneration;
  readonly nombre: string;
  /** Proporción del peso del catálogo que se encontró, en `[0, 1]`. */
  readonly cobertura: number;
  readonly anclajesEncontrados: readonly string[];
  /** Anclajes marcados obligatorios que no aparecieron. */
  readonly obligatoriosAusentes: readonly string[];
}

export interface ReconocimientoDeCedula {
  /** La generación que mejor explica lo que se leyó. */
  readonly mejor: ConformidadDePlantilla;
  readonly todas: readonly ConformidadDePlantilla[];
}

/** Las dos caras, por separado. El reverso vacío es una captura de sólo anverso. */
export interface CarasLeidas {
  readonly textoAnverso: string;
  readonly textoReverso: string;
}

/** Mayúsculas y sin tildes, conservando la separación. Para los patrones exactos. */
function plegarConservandoEspacios(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toUpperCase();
}

/**
 * Un anclaje del catálogo, cotejado contra un texto por los DOS caminos.
 *
 * El exacto primero porque es el más barato y el más preciso: sobre un texto
 * limpio —un ejemplar sintético, una lectura de buena calidad— acierta sin
 * tolerar nada. El aproximado sólo entra cuando el exacto ya falló, que es
 * exactamente el caso de la fotografía real.
 *
 * Un anclaje ESTRUCTURAL —la MRZ— no tiene grafías y por tanto sólo se cotea
 * por patrón: una zona de lectura mecánica se reconoce por su alfabeto y su
 * relleno, y «parecerse» a una MRZ no significa nada.
 */
export function anclajePresente(
  anclaje: AnclajeDeCatalogo,
  textoConEspacios: string,
  textoPlegado: string,
): boolean {
  if (anclaje.patron.test(textoConEspacios)) return true;
  return casarGrafias(textoPlegado, anclaje.grafias) !== null;
}

/**
 * Mide una lectura contra todas las plantillas del catálogo.
 *
 * El anverso y el reverso van por separado y no unidos, y es la diferencia entre
 * medir una plantilla y contar palabras: un anclaje del reverso encontrado en el
 * anverso no es la tarjeta que el catálogo describe. Cuando sólo hay anverso
 * —una captura legítima y frecuente— los anclajes de reverso no restan: quedan
 * fuera del denominador, ausentes por no haberse fotografiado y no por no
 * existir.
 */
export function reconocerCedulaBoliviana(entrada: CarasLeidas): ReconocimientoDeCedula {
  const anverso = plegarConservandoEspacios(entrada.textoAnverso);
  const reverso = plegarConservandoEspacios(entrada.textoReverso);
  const hayReverso = reverso.replace(/\s+/gu, '').length > 0;

  const caras = {
    ANVERSO: { conEspacios: anverso, plegado: plegarParaCotejo(anverso) },
    REVERSO: { conEspacios: reverso, plegado: plegarParaCotejo(reverso) },
    AMBAS: {
      conEspacios: `${anverso}\n${reverso}`,
      plegado: plegarParaCotejo(`${anverso} ${reverso}`),
    },
  } as const;

  const todas = PLANTILLAS.map((plantilla) => medir(plantilla, caras, hayReverso));
  // El máximo, con desempate estable por el orden del catálogo: dos
  // conformidades idénticas tienen que elegir siempre la misma generación, o el
  // mismo documento contaría una historia distinta en cada ejecución.
  const mejor = todas.reduce((a, b) => (b.cobertura > a.cobertura ? b : a));
  return { mejor, todas };
}

function medir(
  plantilla: PlantillaDeCedula,
  caras: Record<'ANVERSO' | 'REVERSO' | 'AMBAS', { conEspacios: string; plegado: string }>,
  hayReverso: boolean,
): ConformidadDePlantilla {
  const aplicables = plantilla.anclajes.filter(
    (anclaje) => hayReverso || anclaje.cara !== 'REVERSO',
  );
  const encontrados = aplicables.filter((anclaje) => {
    const donde = caras[anclaje.cara];
    return anclajePresente(anclaje, donde.conEspacios, donde.plegado);
  });

  const total = aplicables.reduce((suma, anclaje) => suma + anclaje.peso, 0);
  const logrado = encontrados.reduce((suma, anclaje) => suma + anclaje.peso, 0);

  return {
    generacion: plantilla.generacion,
    nombre: plantilla.nombre,
    cobertura: total === 0 ? 0 : Number((logrado / total).toFixed(3)),
    anclajesEncontrados: encontrados.map((anclaje) => anclaje.id),
    obligatoriosAusentes: aplicables
      .filter((anclaje) => anclaje.obligatorio && !encontrados.includes(anclaje))
      .map((anclaje) => anclaje.id),
  };
}

/*
 * ── De la cobertura al TIPO de documento ───────────────────────────────────
 */

/**
 * Los anclajes que SÓLO imprime una cédula de identidad boliviana.
 *
 * Existen porque la cobertura sola no basta para nombrar el documento, y eso
 * está medido: una licencia de conducir boliviana sintética —que lleva el mismo
 * encabezado del Estado, los mismos rótulos de nombres y apellidos y las mismas
 * dos fechas— alcanzaba 0,623 de cobertura, por encima de la cédula real
 * fotografiada. Es lógico: el catálogo describe una tarjeta oficial boliviana, y
 * todas las tarjetas oficiales bolivianas se parecen.
 *
 * Lo que las separa es esta lista. El rótulo del documento lo dice sin
 * ambigüedad; la MRZ TD1 no la imprime ninguna licencia; SERIE y SECCIÓN son
 * campos administrativos del SEGIP que sólo van en la cédula; el NPIOC y el
 * grupo sanguíneo son exclusivos del rediseño del DS 4924.
 *
 * Es el mismo reparto que `identity-triage.ts` hace con sus señales fuertes, y
 * por el mismo motivo: la cantidad de evidencia dice CUÁNTA hay, y la clase de
 * evidencia dice DE QUÉ.
 */
export const ANCLAJES_IDENTIFICADORES: readonly string[] = [
  'rotulo-cedula',
  'zona-mrz-td1',
  'campo-serie',
  'campo-seccion',
  'campo-npioc',
  'campo-grupo-sanguineo',
];

/**
 * Cobertura mínima para afirmar que la imagen es una cédula boliviana.
 *
 * 0,25 y no más alto porque esto NOMBRA el documento, no lo aprueba: quien
 * decide si la evidencia basta es `identity-triage.ts`, y quien decide si la
 * plantilla está completa es `identity-fraud.scorer.ts` con su propio umbral en
 * 0,55. Subirlo aquí duplicaría esa segunda decisión en el peor sitio —antes de
 * elegir analizador— y devolvería `UNKNOWN` para cédulas que sí se leyeron.
 *
 * Medido sobre la cédula real fotografiada, a las cuatro resoluciones que el
 * pipeline puede usar y en su orientación correcta: 0,291 / 0,463 / 0,515 /
 * 0,664. En las tres orientaciones equivocadas, 0,000 las doce veces. La
 * frontera separa las dos poblaciones con margen por los dos lados.
 */
export const COBERTURA_MINIMA_PARA_NOMBRAR = 0.25;

/**
 * ¿Se puede afirmar que esto es una cédula boliviana?
 *
 * Las DOS condiciones, y ninguna sobra: la cobertura dice que hay bastante
 * plantilla a la vista, y el anclaje identificador dice que la plantilla es la
 * de una cédula y no la de otra tarjeta oficial del mismo país.
 */
export function esCedulaBoliviana(
  reconocimiento: ReconocimientoDeCedula,
  coberturaMinima = COBERTURA_MINIMA_PARA_NOMBRAR,
): boolean {
  const { mejor } = reconocimiento;
  if (mejor.cobertura < coberturaMinima) return false;
  return mejor.anclajesEncontrados.some((id) => ANCLAJES_IDENTIFICADORES.includes(id));
}
