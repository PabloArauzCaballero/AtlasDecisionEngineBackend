/**
 * ¿Se parece esto a una cédula boliviana DE VERDAD?
 *
 * `identity-evidence.ts` contesta una pregunta anterior —«¿hay un documento de
 * identidad delante?»— y la contesta con seis señales genéricas que cumple casi
 * cualquier documento oficial del mundo. Este archivo contesta la siguiente, que
 * es la que separa el fraude: dado que hay una cédula boliviana delante, ¿tiene
 * la plantilla COMPLETA de alguna de las dos generaciones que el SEGIP emite?
 *
 * ## Por qué se mide contra la mejor generación y no contra las dos a la vez
 *
 * Porque las dos plantillas son distintas y una cédula legítima de 2021 no lleva
 * MRZ. Promediar las dos conformidades castigaría a todas las cédulas anteriores
 * a noviembre de 2023 por no tener algo que su generación no imprime, y esos son
 * millones de documentos perfectamente válidos. Un falso positivo aquí le cierra
 * el producto a alguien que no hizo nada mal, y —a diferencia de una foto
 * movida— no tiene forma de arreglarlo repitiendo la captura.
 *
 * ## Qué NO hace este archivo
 *
 * No decide. Devuelve una medida y una lista de lo que faltó, y quien decide es
 * `identity-fraud.scorer.ts` con los umbrales del despliegue. Es la misma
 * separación que ya existe entre `identity-evidence` y `identity-triage`, y por
 * el mismo motivo: recalibrar no puede obligar a tocar las señales.
 */

import {
  MARCAS_DE_FALSIFICACION,
  NOMBRES_DE_DEPARTAMENTO,
  esNumeroDeCedulaValido,
} from '../catalog/bolivia-ci.catalog';
import {
  reconocerCedulaBoliviana,
  type ConformidadDePlantilla,
} from '../catalog/bolivia-ci.recognizer';
import { plegarTexto } from '../engine/identity-evidence';
import type { ExtractedIdentityData } from '../domain/extracted-identity.types';
import type { MrzTd1 } from '../parsers/mrz-td1';

/*
 * La MEDIDA de conformidad vive en `catalog/bolivia-ci.recognizer.ts` y este
 * archivo la reexporta.
 *
 * No es un reparto cosmético: la misma cobertura tiene que servir para NOMBRAR
 * el documento —el clasificador la usa para decidir si es una cédula— y para
 * juzgar si su plantilla está completa, que es lo que se hace aquí. Con dos
 * implementaciones, el día que se separen un documento sería una cédula para la
 * puerta y una plantilla incompleta para el análisis de fraude, por la misma
 * foto y en la misma ejecución.
 */
export type { ConformidadDePlantilla } from '../catalog/bolivia-ci.recognizer';

/** Una incoherencia entre datos del propio documento. No es una opinión: es aritmética. */
export interface IncoherenciaEstructural {
  readonly codigo: string;
  readonly detalle: string;
  /** Cuánto suma al riesgo de fraude, en `[0, 1]`. */
  readonly peso: number;
}

export interface AnalisisDePlantilla {
  /** La generación que mejor explica lo que se leyó. */
  readonly mejor: ConformidadDePlantilla;
  readonly todas: readonly ConformidadDePlantilla[];
  readonly incoherencias: readonly IncoherenciaEstructural[];
  /** Marcas de falsificación literales encontradas en el texto. */
  readonly marcasDeFalsificacion: readonly string[];
}

export interface EntradaDePlantilla {
  readonly textoAnverso: string;
  readonly textoReverso: string;
  readonly campos: ExtractedIdentityData;
  readonly mrz: MrzTd1 | null;
  /** Fecha de referencia. La entrega quien llama para que el análisis sea reproducible. */
  readonly ahora: Date;
}

const DIA_MS = 86_400_000;
const ANIO_MS = 365.2425 * DIA_MS;

/**
 * Contrasta lo leído con todas las plantillas y devuelve el análisis completo.
 *
 * El texto del ANVERSO y el del REVERSO se pasan por separado y no unidos, y es
 * la diferencia entre medir una plantilla y contar palabras: un anclaje del
 * reverso encontrado en el anverso no es la tarjeta que el catálogo describe.
 * Cuando sólo hay anverso —que es una captura legítima y frecuente— los anclajes
 * de reverso no restan: ausentes por no haberse fotografiado, no por no existir.
 */
export function analizarPlantilla(entrada: EntradaDePlantilla): AnalisisDePlantilla {
  const completo = `${plegarTexto(entrada.textoAnverso)}\n${plegarTexto(entrada.textoReverso)}`;
  const { mejor, todas } = reconocerCedulaBoliviana({
    textoAnverso: entrada.textoAnverso,
    textoReverso: entrada.textoReverso,
  });

  return {
    mejor,
    todas,
    incoherencias: buscarIncoherencias(entrada, completo),
    marcasDeFalsificacion: MARCAS_DE_FALSIFICACION.filter((marca) =>
      marca.patron.test(completo),
    ).map((marca) => marca.codigo),
  };
}

/**
 * Las incoherencias, que son la parte que un falsificador no puede arreglar
 * mirando la tarjeta.
 *
 * Un montaje se hace copiando una plantilla y escribiendo datos encima. Los
 * rótulos salen bien —están en la plantilla— y lo que sale mal es la ARITMÉTICA
 * entre los datos escritos: la MRZ dice un número y el anverso otro, la
 * caducidad cae antes del nacimiento, el documento dura veinte años, el sexo de
 * la MRZ no es ninguno de los tres que admite la norma. Nada de esto se ve
 * mirando; todo se comprueba calculando.
 *
 * Los pesos van de 0,15 a 0,45 y el criterio es cuánto puede explicarse por un
 * fallo del OCR: una fecha ilegible mal leída produce una incoherencia de fechas
 * con relativa facilidad, así que pesa menos; un número de MRZ cuyos dígitos de
 * control CUADRAN y que aun así discrepa del anverso no lo explica ningún fallo
 * de lectura, y pesa el máximo.
 */
function buscarIncoherencias(
  entrada: EntradaDePlantilla,
  textoCompleto: string,
): IncoherenciaEstructural[] {
  const fallos: IncoherenciaEstructural[] = [];
  const { campos, mrz, ahora } = entrada;

  // --- 1. El número de cédula respeta el formato del SEGIP -----------------
  const numero = campos.documentNumber?.value ?? null;
  if (numero && !esNumeroDeCedulaValido(numero)) {
    fallos.push({
      codigo: 'DOCUMENT_NUMBER_FORMAT_INVALID',
      detalle: `El número leído no tiene la forma de una cédula boliviana (cinco a ocho dígitos, sin cero inicial, complemento opcional).`,
      peso: 0.25,
    });
  }

  // --- 2. La MRZ y el anverso dicen lo mismo -------------------------------
  /*
   * Sólo se contrasta cuando el dígito de control del número de la MRZ CUADRA.
   *
   * Sin esa condición, una MRZ mal leída —que es lo normal en una foto con
   * reflejos— produciría una acusación de manipulación contra un documento
   * legítimo. Con ella, la discrepancia significa lo que parece: los dos números
   * están bien leídos y son distintos, o sea que el reverso y el anverso no son
   * de la misma tarjeta.
   */
  if (mrz?.documentNumber && mrz.checks.documentNumber && numero) {
    const enMrz = mrz.documentNumber.replace(/\D/gu, '');
    const enAnverso = numero.replace(/\D/gu, '');
    if (enMrz && enAnverso && !enMrz.endsWith(enAnverso) && !enAnverso.endsWith(enMrz)) {
      fallos.push({
        codigo: 'MRZ_DOCUMENT_NUMBER_MISMATCH',
        detalle:
          'El número de la zona de lectura mecánica valida su dígito de control y aun así no coincide con el impreso en el anverso.',
        peso: 0.45,
      });
    }
  }

  if (mrz && mrz.sex !== null && !['M', 'F', 'X'].includes(mrz.sex)) {
    fallos.push({
      codigo: 'MRZ_SEX_INVALID',
      detalle: 'El campo de sexo de la MRZ no es ninguno de los tres valores que admite la norma.',
      peso: 0.2,
    });
  }

  /*
   * Una MRZ presente cuyo control COMPUESTO no cuadra.
   *
   * El compuesto se calcula sobre los dos renglones enteros, así que acertarlo
   * por casualidad es difícil y fallarlo por un glifo mal leído es fácil. Por
   * eso pesa poco: es una señal para escalar, nunca para rechazar sola.
   */
  if (mrz && !mrz.checks.composite) {
    fallos.push({
      codigo: 'MRZ_COMPOSITE_CHECK_FAILED',
      detalle:
        'Se leyó una zona de lectura mecánica pero su dígito de control compuesto no cuadra.',
      peso: 0.15,
    });
  }

  // --- 3. Las fechas son coherentes entre sí -------------------------------
  const nacimiento = aFecha(campos.dateOfBirth?.value);
  const emision = aFecha(campos.issueDate?.value);
  const caducidad = aFecha(campos.expirationDate?.value);

  if (nacimiento && caducidad && caducidad.getTime() <= nacimiento.getTime()) {
    fallos.push({
      codigo: 'DATE_ORDER_IMPOSSIBLE',
      detalle: 'La fecha de expiración es anterior o igual a la de nacimiento.',
      peso: 0.4,
    });
  }
  if (emision && caducidad && caducidad.getTime() <= emision.getTime()) {
    fallos.push({
      codigo: 'ISSUE_AFTER_EXPIRY',
      detalle: 'La fecha de emisión es posterior a la de expiración.',
      peso: 0.4,
    });
  }
  if (nacimiento && nacimiento.getTime() > ahora.getTime()) {
    fallos.push({
      codigo: 'BIRTH_DATE_IN_FUTURE',
      detalle: 'La fecha de nacimiento es futura.',
      peso: 0.4,
    });
  }

  /*
   * Vigencias imposibles.
   *
   * La tarjeta física dura cinco años; el DS 4342 llegó a ampliarla a diez, y a
   * partir de los 58 años puede ser indefinida —que en la práctica se imprime
   * con una caducidad muy lejana—. Así que el tope se pone en 60 años, muy por
   * encima de cualquier caso legítimo: lo que esto atrapa es la caducidad
   * inventada de un montaje («válida hasta 2099»), no una vigencia larga real.
   */
  if (emision && caducidad) {
    const anios = (caducidad.getTime() - emision.getTime()) / ANIO_MS;
    if (anios > 60) {
      fallos.push({
        codigo: 'VALIDITY_SPAN_IMPLAUSIBLE',
        detalle: `Entre la emisión y la expiración hay ${anios.toFixed(0)} años, muy por encima de cualquier vigencia que el SEGIP emita.`,
        peso: 0.3,
      });
    }
  }

  /*
   * Un titular con menos de dieciséis años.
   *
   * No es imposible —el SEGIP emite cédula a menores— pero SÍ lo es para el
   * flujo que llama a este worker, que es el alta de un producto financiero. Se
   * anota como incoherencia con peso bajo para que escale a una persona, y no
   * como rechazo: quien decide si un menor puede contratar es la política del
   * artefacto, no el lector del documento.
   */
  if (nacimiento) {
    const edad = (ahora.getTime() - nacimiento.getTime()) / ANIO_MS;
    if (edad < 16) {
      fallos.push({
        codigo: 'HOLDER_UNDERAGE',
        detalle: `El documento declara un titular de ${edad.toFixed(0)} años.`,
        peso: 0.2,
      });
    }
    if (edad > 120) {
      fallos.push({
        codigo: 'HOLDER_AGE_IMPLAUSIBLE',
        detalle: `El documento declara un titular de ${edad.toFixed(0)} años.`,
        peso: 0.35,
      });
    }
  }

  // --- 4. El lugar de nacimiento nombra un departamento boliviano ----------
  /*
   * Sólo se comprueba cuando se llegó a leer el campo. Un lugar ilegible es
   * silencio, y el silencio no acusa a nadie: lo que se busca aquí es un lugar
   * PERFECTAMENTE legible que no está en Bolivia, que es la firma de una
   * plantilla de otro país reetiquetada.
   */
  const lugar = campos.placeOfBirth?.value;
  if (lugar && lugar.trim().length >= 4) {
    const plegado = plegarTexto(lugar);
    const conocido = NOMBRES_DE_DEPARTAMENTO.some((departamento) => plegado.includes(departamento));
    if (!conocido && /BOLIVIA/u.test(plegado) === false) {
      fallos.push({
        codigo: 'BIRTH_PLACE_NOT_BOLIVIAN',
        detalle: `El lugar de nacimiento leído («${lugar.slice(0, 40)}») no nombra ningún departamento de Bolivia.`,
        peso: 0.15,
      });
    }
  }

  // --- 5. La nacionalidad de la MRZ ----------------------------------------
  if (mrz?.nationality && mrz.nationality !== 'BOL' && /^[A-Z]{3}$/u.test(mrz.nationality)) {
    fallos.push({
      codigo: 'MRZ_NATIONALITY_NOT_BOL',
      detalle: `La MRZ declara nacionalidad ${mrz.nationality} en un documento que se presenta como cédula boliviana.`,
      peso: 0.2,
    });
  }

  // --- 6. Rastros de que la imagen es una captura de pantalla --------------
  /*
   * Una cédula fotografiada no lleva reloj ni barra de batería. Estos rótulos
   * salen del CROMO de un teléfono, y encontrarlos significa que lo que se subió
   * es la foto de la pantalla de otro dispositivo: el vector más común del
   * fraude de identidad barato, porque no hace falta tener la tarjeta, sólo una
   * imagen de ella.
   */
  if (
    /\b(?:CAPTURA\s+DE\s+PANTALLA|SCREENSHOT|WHATSAPP|TELEGRAM|MESSENGER)\b/u.test(textoCompleto)
  ) {
    fallos.push({
      codigo: 'SCREEN_CAPTURE_ARTIFACTS',
      detalle:
        'El texto leído contiene rótulos de la interfaz de una aplicación, no del documento.',
      peso: 0.3,
    });
  }

  return fallos;
}

/** Una fecha ISO del analizador, como fecha UTC. `null` si no hay o no se puede. */
function aFecha(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const fecha = new Date(`${valor}T00:00:00.000Z`);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}
