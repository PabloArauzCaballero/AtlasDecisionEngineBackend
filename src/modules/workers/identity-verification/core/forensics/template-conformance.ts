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

/**
 * Algo que se anota y que **no suma riesgo**.
 *
 * La distinción entre esto y una incoherencia es la corrección más importante de
 * este archivo, y no es de estilo: es la diferencia entre describir y acusar.
 *
 * Tres cosas se movieron aquí desde las incoherencias, y las tres por el mismo
 * motivo — el corpus demuestra que la regla que las sostenía no está verificada:
 *
 * - **El formato del número de cédula.** Se exigían cinco a ocho dígitos sin
 *   cero inicial. El corpus buscó la gramática del SEGIP y devolvió
 *   `exact_min_length: null`, `exact_max_length: null`,
 *   `leading_zero_assignment_policy: null` y la instrucción literal «conservar
 *   los ceros; no rechazar con una longitud no verificada» (hueco G04).
 * - **La nacionalidad de la MRZ.** Ni la nacionalidad ni el estado emisor están
 *   cubiertos por ningún dígito de control —el corpus lo enumera— y un titular
 *   EXTRANJERO con cédula boliviana tiene legítimamente otra nacionalidad: el
 *   propio corpus lista la cédula de extranjero como documento existente.
 * - **El lugar de nacimiento.** Una persona nacida fuera de Bolivia es una
 *   persona nacida fuera de Bolivia. Medido sobre 23 cédulas auténticas, esta
 *   regla acusó a una.
 *
 * Ninguna de las tres desaparece: se registran, viajan a la traza y quien revisa
 * las ve. Lo que pierden es el peso.
 */
export interface ObservacionEstructural {
  readonly codigo: string;
  readonly detalle: string;
  /** Por qué se registra y no acusa. Va en la traza para que no se reintroduzca. */
  readonly razonDeNoAcusar: string;
}

export interface AnalisisDePlantilla {
  /** La generación que mejor explica lo que se leyó. */
  readonly mejor: ConformidadDePlantilla;
  readonly todas: readonly ConformidadDePlantilla[];
  readonly incoherencias: readonly IncoherenciaEstructural[];
  /** Lo que se anota sin acusar. Ver `ObservacionEstructural`. */
  readonly observaciones: readonly ObservacionEstructural[];
  /**
   * Si la COBERTURA de plantilla se puede juzgar con esta imagen.
   *
   * `false` cuando la captura no da resolución suficiente para leer los rótulos
   * que la plantilla enumera. Entonces una cobertura baja no dice nada del
   * documento —dice que la foto es pequeña— y el fusor de fraude no la puntúa.
   */
  readonly coberturaEvaluable: boolean;
  /** Por qué no se puede juzgar, cuando no se puede. */
  readonly motivoDeNoEvaluable: string | null;
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
  /**
   * Lado largo, en píxeles, de la imagen del documento tal como se capturó.
   *
   * Se pasa para poder decir «no se pudo leer» en vez de «no está». Omitirlo
   * mantiene el comportamiento anterior: la cobertura se juzga siempre.
   */
  readonly ladoLargoPx?: number | null;
  /** Suelo de legibilidad. Por omisión, `LADO_LARGO_MINIMO_LEGIBLE`. */
  readonly ladoLargoMinimo?: number;
}

/**
 * Por debajo de esto, los rótulos de la plantilla no se pueden leer.
 *
 * **Mil píxeles de lado largo**, y el número viene de dos sitios que coinciden:
 *
 * 1. La conversión del corpus: la recomendación general de Tesseract son 300
 *    ppp, y una tarjeta de 85 mm a 300 ppp son 1003,94 px de lado largo.
 * 2. La medición propia sobre una cédula boliviana AUTÉNTICA, que es la que
 *    obliga a poner el suelo aquí y no más abajo:
 *
 *        lado del OCR   600     900     1200    1600
 *        cobertura      0,216   0,463   0,515   0,664
 *
 *    El umbral de cobertura del fusor está en 0,40. A 600 px un documento
 *    legítimo da 0,216 —acusación garantizada— y a 900 da 0,463, que deja un
 *    margen de seis centésimas: cualquier reflejo se lo come.
 *
 * Sobre las 23 cédulas auténticas del directorio de pruebas, la mediana del lado
 * largo es **796 px**. O sea: la mayoría de las fotos que la gente manda por
 * mensajería NO permiten juzgar la plantilla, y el sistema llevaba meses
 * juzgándola igual. Lo que corresponde con esas fotos es pedir otra captura,
 * que es lo que el corpus llama `RECAPTURE_OR_REVIEW`.
 */
export const LADO_LARGO_MINIMO_LEGIBLE = 1000;

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

  const minimo = entrada.ladoLargoMinimo ?? LADO_LARGO_MINIMO_LEGIBLE;
  const lado = entrada.ladoLargoPx ?? null;
  const coberturaEvaluable = lado === null || lado >= minimo;
  const { incoherencias, observaciones } = examinar(entrada, completo, mejor);

  return {
    mejor,
    todas,
    incoherencias,
    observaciones,
    coberturaEvaluable,
    motivoDeNoEvaluable: coberturaEvaluable
      ? null
      : `La imagen mide ${String(lado)} px de lado largo y hacen falta ${String(minimo)} para leer los rótulos de la plantilla.`,
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
function examinar(
  entrada: EntradaDePlantilla,
  textoCompleto: string,
  conformidad: ConformidadDePlantilla,
): { incoherencias: IncoherenciaEstructural[]; observaciones: ObservacionEstructural[] } {
  const fallos: IncoherenciaEstructural[] = [];
  const notas: ObservacionEstructural[] = [];
  const { campos, mrz, ahora } = entrada;

  // --- 1. El número de cédula respeta el formato del SEGIP -----------------
  const numero = campos.documentNumber?.value ?? null;
  if (numero && !esNumeroDeCedulaValido(numero)) {
    notas.push({
      codigo: 'DOCUMENT_NUMBER_SHAPE_UNEXPECTED',
      detalle: `El número leído («${numero.slice(0, 16)}») no encaja en la forma que este catálogo espera.`,
      razonDeNoAcusar:
        'La gramática del número del SEGIP no está verificada: no se conocen longitud mínima, ' +
        'longitud máxima, política de ceros iniciales ni la forma exacta del complemento. ' +
        'Rechazar por una longitud no verificada descartaría cédulas legítimas.',
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
  if (mrz?.documentNumber && mrz.checks.documentNumber === true && numero) {
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
  if (mrz && mrz.checks.composite === null) {
    notas.push({
      codigo: 'MRZ_COMPOSITE_NOT_EVALUABLE',
      detalle:
        'Se leyó una zona de lectura mecánica pero su dígito de control compuesto no es legible.',
      razonDeNoAcusar:
        'Un dígito que el reconocedor no leyó no es un dígito que no cuadre. Medido sobre 23 ' +
        'cédulas auténticas, cuatro traían ese dígito ilegible.',
    });
  }
  if (mrz && mrz.checks.composite === false) {
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
   * Una EMISIÓN futura.
   *
   * Se comprobaba el nacimiento y no la emisión, y la emisión es la que un
   * montaje toca: se parte de una cédula caducada y se le adelantan las fechas
   * para que parezca vigente. Adelantar la emisión es el descuido más fácil de
   * cometer y el más fácil de comprobar — el SEGIP no expide documentos con
   * fecha de mañana.
   *
   * Se dan dos días de margen por la zona horaria: el motor trabaja en UTC y la
   * tarjeta se imprimió en Bolivia (UTC−4), así que una cédula emitida hoy mismo
   * no debe acusarse por unas horas de desfase.
   */
  if (emision && emision.getTime() > ahora.getTime() + 2 * DIA_MS) {
    fallos.push({
      codigo: 'ISSUE_DATE_IN_FUTURE',
      detalle: 'La fecha de emisión es posterior a hoy.',
      /*
       * Pesa 0,2 y no más porque la emisión es el campo menos demostrable de la
       * tarjeta: no está en la MRZ, así que no hay dígito de control que la
       * respalde, y va impresa en el cuerpo más pequeño del anverso. Ver, más
       * abajo, la comprobación de vigencia que se retiró por ese mismo motivo.
       * Aquí la condición sí es imposible —el SEGIP no expide con fecha de
       * mañana— pero un año mal leído la produce, así que escala y no acusa.
       */
      peso: 0.2,
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
    /*
     * Aquí se PROBÓ un corte por vigencia no estándar —5 o 10 años, que es lo
     * que el SEGIP expide— y se retiró, medido.
     *
     * La idea era buena: el tope de sesenta años atrapa el «válida hasta 2099»
     * de un montaje torpe y deja pasar el que importa, que es adelantar la
     * caducidad de una cédula vencida un par de años. El problema es de qué
     * DATOS dispone para juzgar. La caducidad suele venir de la MRZ y trae
     * dígito de control; la EMISIÓN no está en la MRZ y sólo existe impresa, en
     * el cuerpo más pequeño del anverso y sobre el guilloché. O sea que la
     * vigencia se calcula restando un dato demostrado menos un dato no
     * demostrado.
     *
     * Sobre cinco cédulas bolivianas auténticas, la comprobación acusó a una: su
     * anverso imprime `23/06/2026` y el reconocedor devolvió `23/08/2020`, de
     * modo que una tarjeta de cinco años de vigencia parecía tener once. Una de
     * cada cinco cédulas legítimas marcada por el campo que peor se lee no es
     * una defensa contra el fraude: es una cola de revisión.
     *
     * Vuelve a tener sentido el día que la emisión se pueda demostrar —un QR
     * leído, un cotejo contra el SEGIP— y no antes.
     */
  }

  /*
   * La generación VIGENTE sin zona de lectura mecánica.
   *
   * El DS 4924 de 2023 rediseñó la cédula y la MRZ TD1 del reverso es parte del
   * diseño: una tarjeta de esa generación la lleva siempre. Un falsificador que
   * reproduce el anverso —los rótulos, el guilloché, el retrato— se salta la MRZ
   * con frecuencia, porque exige calcular tres dígitos de control que nadie mira
   * a simple vista.
   *
   * Sólo se levanta cuando se fotografió el REVERSO. Sin reverso, la MRZ falta
   * por no haberse fotografiado y no por no existir, que es una captura legítima
   * y frecuente. Y pesa poco —0,2— porque la otra explicación es honesta y
   * corriente: la MRZ es la letra más pequeña de la tarjeta y una foto regular la
   * pierde entera. Es una señal para escalar, nunca para rechazar.
   */
  if (conformidad.generacion === 'DS_4924_2023' && entrada.textoReverso.trim().length > 0 && !mrz) {
    fallos.push({
      codigo: 'MRZ_ABSENT_ON_CURRENT_GENERATION',
      detalle:
        'La tarjeta tiene el diseño vigente (DS 4924 de 2023), que lleva zona de lectura mecánica, y en el reverso fotografiado no se encontró ninguna.',
      peso: 0.2,
    });
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
      notas.push({
        codigo: 'BIRTH_PLACE_NOT_BOLIVIAN',
        detalle: `El lugar de nacimiento leído («${lugar.slice(0, 40)}») no nombra ningún departamento de Bolivia.`,
        razonDeNoAcusar:
          'Una persona nacida fuera de Bolivia puede tener cédula boliviana, y el campo se lee ' +
          'sobre el guilloché del reverso con frecuencia a medias. Medido sobre 23 cédulas ' +
          'auténticas, esta regla acusó a una.',
      });
    }
  }

  // --- 5. La nacionalidad de la MRZ ----------------------------------------
  /*
   * Y sólo cuando el ESTADO EMISOR tampoco dice BOL.
   *
   * Los dos campos son códigos ISO de tres letras y **ninguno de los dos está
   * cubierto por un dígito de control** —el compuesto abarca el número y las dos
   * fechas—, así que los dos se leen mal con la misma facilidad. Medido sobre una
   * cédula boliviana auténtica: el segundo renglón llegó con un glifo de más
   * (`BO0L`), la nacionalidad salió `BOO` y el documento quedaba acusado de
   * declarar una nacionalidad extranjera. El emisor, en el otro renglón, decía
   * `BOL` sin dudar.
   *
   * Exigir que fallen los DOS es lo que separa un montaje de una errata: quien
   * reetiqueta la plantilla de otro país deja los dos campos del país de origen,
   * mientras que el reconocedor se equivoca en uno cada vez.
   */
  if (
    mrz?.nationality &&
    mrz.nationality !== 'BOL' &&
    mrz.issuingState !== 'BOL' &&
    /^[A-Z]{3}$/u.test(mrz.nationality)
  ) {
    notas.push({
      codigo: 'MRZ_NATIONALITY_NOT_BOL',
      detalle: `La MRZ declara nacionalidad ${mrz.nationality} y emisor ${mrz.issuingState ?? '—'} en un documento que se presenta como cédula boliviana.`,
      razonDeNoAcusar:
        'Ni la nacionalidad ni el estado emisor están cubiertos por un dígito de control, así que ' +
        'los dos se leen mal con la misma facilidad; y un titular extranjero con cédula boliviana ' +
        'tiene legítimamente otra nacionalidad.',
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

  return { incoherencias: fallos, observaciones: notas };
}

/** Una fecha ISO del analizador, como fecha UTC. `null` si no hay o no se puede. */
function aFecha(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const fecha = new Date(`${valor}T00:00:00.000Z`);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}
