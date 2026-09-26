/**
 * Zona de lectura mecánica (MRZ) de una tarjeta TD1, según ICAO 9303 parte 5.
 *
 * Es el reverso de la cédula boliviana vigente: tres renglones de 30 caracteres
 * en OCR-B. Y es, de lejos, **la fuente más fiable del documento**: está pensada
 * para que la lea una máquina, no una persona, y trae DÍGITOS DE CONTROL que
 * permiten saber si se leyó bien en vez de suponerlo.
 *
 * Esa comprobación es la razón de que exista este módulo. Un OCR sobre el
 * anverso puede confundir un 5 con un 6 y nadie se entera: el número resultante
 * parece igual de válido. Aquí, si el dígito de control no cuadra, el campo se
 * descarta —vale más no saber el número que saberlo mal cuando lo que se decide
 * es la identidad de alguien—.
 *
 *   L1  ID BOL 8942507<< 9 <<<<<<<<<<<<<<<
 *       │  │   │        │
 *       │  │   │        └ dígito de control del número
 *       │  │   └ número de documento (9)
 *       │  └ estado emisor (3)
 *       └ tipo de documento (2)
 *
 *   L2  030405 3 F 280612 5 BOL <<<<<<<<<<< 0
 *       │      │ │ │      │ │                │
 *       │      │ │ │      │ │                └ control compuesto
 *       │      │ │ │      │ └ nacionalidad
 *       │      │ │ │      └ control de la caducidad
 *       │      │ │ └ caducidad (AAMMDD)
 *       │      │ └ sexo
 *       │      └ control del nacimiento
 *       └ nacimiento (AAMMDD)
 *
 *   L3  RODRIGUEZ<GONZALEZ<<MARIA<RENEE<<<<
 *       └ apellidos << nombres
 */

export interface MrzTd1 {
  documentNumber: string | null;
  birthDate: string | null;
  expirationDate: string | null;
  sex: 'M' | 'F' | 'X' | null;
  nationality: string | null;
  issuingState: string | null;
  lastNames: string | null;
  firstNames: string | null;
  /**
   * Qué comprobaciones cuadraron, en TRES estados y no en dos.
   *
   * `true` cuadra, `false` NO cuadra, y **`null` no se pudo evaluar**. El tercero
   * es el que faltaba y el que más caro salía: cuando el reconocedor devuelve un
   * `?`, una `c` minúscula o un espacio donde la norma exige un dígito de
   * control, lo que ha ocurrido no es que el documento falle su propio control —
   * es que no se ha leído el control. Tratar esas dos cosas igual convierte una
   * foto regular en una sospecha de manipulación.
   *
   * Medido sobre 23 cédulas bolivianas auténticas: **cuatro** traían el dígito
   * compuesto ilegible (`?`, `c`) y las cuatro salían con
   * `MRZ_COMPOSITE_CHECK_FAILED` en su expediente. Ninguna estaba manipulada; a
   * ninguna se le podía comprobar ese dígito.
   *
   * El corpus lo dice en una línea: «Campo no leído es NO_EVALUABLE, no FALSO».
   */
  checks: {
    documentNumber: boolean | null;
    birthDate: boolean | null;
    expirationDate: boolean | null;
    composite: boolean | null;
  };
}

/**
 * ¿Se puede COMPROBAR este dígito de control?
 *
 * Sólo si es un dígito. La norma reserva esa posición a `0-9` (y admite `<` como
 * relleno cuando el campo entero está vacío), así que cualquier otra cosa es un
 * fallo de lectura y no un fallo del documento.
 */
function esControlLegible(control: string): boolean {
  return /^[0-9]$/.test(control);
}

/**
 * ¿Está esta tira dentro del alfabeto de la MRZ?
 *
 * La norma fija `A-Z`, `0-9` y `<`. Un espacio, una tilde o un signo de
 * interrogación dentro de la entrada de un control significan que el renglón se
 * leyó mal: el control calculado sobre esa tira no dice nada del documento.
 */
function tiraLegible(tira: string): boolean {
  return /^[A-Z0-9<]*$/.test(tira);
}

/** Longitud de cada renglón de una TD1. Lo que no la tenga, no es TD1. */
const LINE_LENGTH = 30;

/**
 * Confusiones que comete cualquier OCR sobre OCR-B y que se pueden deshacer
 * SIN riesgo: en las posiciones numéricas de la MRZ no puede haber letras, así
 * que una `O` ahí es un cero con certeza, no una interpretación.
 */
const NUMERIC_FIXES: Record<string, string> = {
  O: '0',
  Q: '0',
  D: '0',
  I: '1',
  L: '1',
  S: '5',
  B: '8',
  /*
   * `T` por `7`, y ésta es la que costaba un número de cédula.
   *
   * En OCR-B el 7 no lleva travesaño y su asta descendente arranca de un trazo
   * horizontal, así que a poca resolución es exactamente una T. Medido sobre una
   * cédula boliviana auténtica fotografiada con un móvil: el primer renglón
   * llegó como `I<BOL7689658<<T<<<…` a 600 y a 900 px de lado —la `T` está en la
   * posición 14, que es el DÍGITO DE CONTROL del número—, y con el control roto
   * se descartaban el número de documento y la fecha de nacimiento enteros. A
   * 1200 px el mismo renglón se lee `…<<7<<<…` y todo cuadra.
   *
   * Deshacerla no es adivinar: la norma garantiza que esa posición es un dígito,
   * igual que las demás entradas de esta tabla, y si la corrección fuera
   * incorrecta el propio dígito de control seguiría sin cuadrar.
   */
  T: '7',
  /* Por lo mismo, y por el mismo sitio: la `Z` y el `2`, la `G` y el `6`. */
  Z: '2',
  G: '6',
};

/**
 * Confusiones al revés, para las posiciones que la norma reserva a LETRAS.
 *
 * El estado emisor y la nacionalidad de una TD1 son códigos ISO 3166-1 alfa-3:
 * tres letras, nunca un dígito. Así que un `0` ahí es una `O` con la misma
 * certeza con la que una `O` en una fecha es un `0`, y deshacerlo no es
 * interpretar.
 *
 * Hacía falta porque el dato salía mal a la vista de quien revisa un caso: la
 * pantalla llegó a enseñar `B0L` —con un cero— como nacionalidad de una cédula
 * boliviana auténtica. Ninguna de estas dos posiciones está cubierta por el
 * dígito de control compuesto, así que nada más iba a corregirlo.
 */
const ALPHA_FIXES: Record<string, string> = {
  '0': 'O',
  '1': 'I',
  '2': 'Z',
  '5': 'S',
  '6': 'G',
  '8': 'B',
};

/** Deshace las confusiones de OCR en un campo que sólo puede llevar letras. */
function normalizeAlpha(valor: string): string {
  return [...valor].map((caracter) => ALPHA_FIXES[caracter] ?? caracter).join('');
}

/**
 * Extrae la MRZ de un texto de OCR y la interpreta.
 *
 * Devuelve `null` cuando no hay tres renglones que parezcan una TD1: eso NO es
 * un error, es una cédula del formato anterior o una foto sólo del anverso.
 */
export function parseMrzTd1(rawText: string): MrzTd1 | null {
  const lineas = candidateLines(rawText);
  if (lineas.length < 3) return null;

  const [l1, l2, l3] = lineas as [string, string, string];

  /*
   * Cada renglón se prueba TAL CUAL y también SIN su primer carácter, y ganan
   * los dígitos de control.
   *
   * Es la tolerancia al corrimiento: el reconocedor mete un glifo espurio
   * delante del renglón —el borde de la tarjeta, una sombra— y TODA la línea se
   * corre una posición. Medido sobre una cédula real: la nacionalidad salía
   * «5BO» (el control de la caducidad, corrido al hueco de la nacionalidad),
   * los apellidos «EARAUZ», y las dos fechas se descartaban con sus controles.
   * Quitar el primer carácter realinea el renglón entero, y si la variante
   * fuera incorrecta ningún control cuadraría: elegir la que más controles
   * valida no puede inventar un dato, sólo recuperar el que se demuestra.
   */
  /*
   * Las alineaciones con CABECERA VÁLIDA se prueban primero y, si hay alguna,
   * ninguna otra compite.
   *
   * La norma fija el arranque del primer renglón: el tipo de documento es `A`,
   * `C` o `I`, y el estado emisor son tres letras. Una alineación que no lo
   * cumple no es «una lectura peor»: es la MRZ leída desde el sitio equivocado,
   * y todo lo que se calcule sobre ella —incluido el control compuesto— está
   * calculado sobre posiciones que no son las suyas.
   *
   * Sin esta preferencia, un control compuesto acertado POR AZAR —un dígito,
   * una posibilidad entre diez— hacía ganar a una alineación corrida. Medido
   * sobre la MRZ sintética de las pruebas: el estado emisor salía `OLI` y el
   * dígito de control del número caía sobre un relleno. Dos campos publicados
   * mal por una coincidencia aritmética.
   *
   * Cuando NINGUNA variante tiene cabecera válida —el reconocedor se comió el
   * tipo de documento, que pasa— se prueban todas, que es lo que se hacía antes.
   */
  const variantesL1 = variantes(l1);
  const conCabecera = variantesL1.filter((variante) => cabeceraPlausible(variante.linea));
  const candidatasL1 = conCabecera.length > 0 ? conCabecera : variantesL1;

  let mejor: MrzTd1 | null = null;
  let mejorPuntos = -1;
  for (const v1 of candidatasL1) {
    for (const v2 of variantes(l2)) {
      // El tercer renglón no lleva ningún control: no hay con qué elegir entre
      // sus variantes, así que se toma tal cual. Un espurio delante del nombre
      // no se puede demostrar — y un nombre «corregido» sin prueba sería un
      // dato inventado.
      const leida = interpretar(
        v1.linea,
        v2.linea,
        variantes(l3)[0]?.linea ?? l3,
        v1.completa && v2.completa,
      );
      /*
       * Una variante ARRIESGADA sólo se acepta si cuadra el control COMPUESTO.
       *
       * Quitar un carácter de en medio genera treinta variantes por renglón, y
       * con tantas alguna acaba cuadrando un control de un solo dígito por puro
       * azar —una de cada diez—. Ese acierto casual entregaría un número de
       * documento inventado con el sello de «validado», que es exactamente lo
       * que este analizador existe para no hacer.
       *
       * El compuesto se calcula sobre los DOS renglones enteros: acertarlo por
       * casualidad es mucho más difícil, y acertarlo a la vez que el número lo
       * es todavía más. Las variantes de siempre —tal cual y sin el primer
       * carácter— no pasan por aquí: ésas ya estaban demostradas.
       */
      if ((v1.arriesgada || v2.arriesgada) && leida.checks.composite !== true) continue;
      const puntos =
        Number(leida.checks.documentNumber === true) +
        Number(leida.checks.birthDate === true) +
        Number(leida.checks.expirationDate === true) +
        // El compuesto pesa doble: valida los dos renglones enteros, no un campo.
        2 * Number(leida.checks.composite === true) +
        /*
         * Y a igualdad de controles, gana la alineación con FORMA de TD1.
         *
         * Pesa menos que cualquier control —una décima— porque es una pista
         * estructural y no una demostración: no puede darle la vuelta a un
         * dígito que cuadra. Lo que sí hace es desempatar, que es donde hacía
         * falta. Con varios arranques posibles, dos de ellos pueden validar los
         * mismos cero controles y quedarse con el primero era quedarse con el
         * renglón sin recortar; ahora gana el que empieza por el tipo de
         * documento y el emisor, que es de donde salen la nacionalidad y el
         * estado emisor —dos campos que ningún dígito de control cubre—.
         */
        0.1 * Number(cabeceraPlausible(v1.linea)) +
        /*
         * Y, por debajo de todo, que el control se pueda COMPROBAR.
         *
         * Vale cinco centésimas: nunca le gana a un control que cuadra, y
         * desempata entre dos alineaciones igual de buenas a favor de la que
         * deja los dígitos de control sobre dígitos en vez de sobre el relleno.
         * Una alineación que pierde el control no es más segura por no poder
         * fallarlo.
         */
        0.05 *
          (Number(leida.checks.documentNumber !== null) +
            Number(leida.checks.birthDate !== null) +
            Number(leida.checks.expirationDate !== null) +
            Number(leida.checks.composite !== null));
      if (puntos > mejorPuntos) {
        mejor = leida;
        mejorPuntos = puntos;
      }
    }
  }
  return mejor;
}

/** Un renglón candidato: el texto ya ajustado a 30 y si hizo falta inventarse un recorte. */
interface Variante {
  linea: string;
  /** Se quitó un carácter de EN MEDIO. Sólo vale si lo respalda el control compuesto. */
  arriesgada: boolean;
  /**
   * El renglón traía sus 30 caracteres; no hubo que rellenarlo.
   *
   * Importa para el control COMPUESTO, que abarca los dos renglones enteros: si
   * el reconocedor se comió el relleno final —cosa que hace, porque veinte `<`
   * seguidos son justo lo que un OCR abrevia— la tira sobre la que se calcula
   * lleva caracteres que pusimos nosotros. Que un control falle sobre caracteres
   * inventados no dice nada del documento.
   */
  completa: boolean;
}

/**
 * ¿Empieza este renglón donde empieza una TD1 de verdad?
 *
 * La norma fija la CABECERA del primer renglón: la posición 0 es el tipo de
 * documento —`I`, `A` o `C` para una tarjeta de identidad— y las posiciones 2 a
 * 4 son el estado emisor, un código ISO 3166-1 alfa-3 de tres LETRAS. Nada de
 * eso depende de los dígitos de control, y por eso sirve para elegir de dónde
 * arranca el renglón cuando el reconocedor le ha colgado glifos por delante.
 *
 * Es lo que hacía falta para no perder un número de documento por dos caracteres
 * de basura. Medido sobre una cédula boliviana auténtica del DS 4924: el primer
 * renglón llegó como `LEI<BOL4521966<<6<<<…` —el reconocedor metió las dos
 * letras de un rótulo vecino— y las dos únicas variantes que había, «tal cual» y
 * «sin el primer carácter», dejaban el número corrido dos y una posición. Su
 * dígito de control CUADRA en cuanto el renglón se alinea, así que el documento
 * traía la prueba de su propio número y el analizador no llegaba a mirarla.
 *
 * Se usa como criterio de desempate y no como filtro: un renglón cuya cabecera
 * no case sigue probándose, porque el emisor podría no ser boliviano y porque
 * el propio tipo de documento se lee mal a veces. Lo que hace es que, entre dos
 * alineaciones que valen lo mismo para los controles, gane la que ADEMÁS tiene
 * la forma que la norma describe.
 */
function cabeceraPlausible(linea: string): boolean {
  return /^[IAC][A-Z<][A-Z]{3}/.test(linea);
}

/**
 * El renglón tal cual, realineado sin su primer carácter, y —si sobra longitud—
 * sin cada uno de sus caracteres.
 *
 * El ajuste a 30 se hace AQUÍ y no al filtrar candidatos: un renglón de 31
 * caracteres —espurio + 30 reales— recortado antes de tiempo ya habría perdido
 * su último carácter real, que es justamente el control compuesto que la
 * variante realineada necesita para demostrarse.
 *
 * ## Por qué hace falta quitar de EN MEDIO
 *
 * Medido sobre una cédula fotografiada a 445 px: el reconocedor devolvió
 * `IDBOL1234567<<A4<<<...` — treinta y un caracteres, con una `A` colada entre
 * el relleno y el dígito de control. El número estaba impreso, era legible y se
 * leyó entero; lo que se perdió fue su control, corrido una posición. Ni el
 * renglón tal cual ni el realineado por delante recuperan eso, así que el
 * expediente se quedaba sin número de documento por un glifo de más.
 *
 * Sólo se generan cuando el renglón MIDE de más: un renglón de treinta ya está
 * completo y quitarle algo sólo puede empeorarlo.
 *
 * ## Por qué el recorte por DELANTE llega ahora hasta cuatro
 *
 * Era de uno, y uno no basta. El espurio de delante no es un carácter suelto:
 * es texto de la propia tarjeta que el reconocedor arrastra al renglón de la
 * MRZ —el borde impreso, el resto de un rótulo, el sello— y llega en grupo.
 * Medido sobre cinco cédulas bolivianas auténticas, el primer renglón de una de
 * ellas volvió como `LEI<BOL4521966<<6<<<…`: dos caracteres de más, número
 * legible, control correcto, y **ninguna variante que lo alineara**. El
 * expediente salía sin número de documento por eso.
 *
 * Cuatro es donde se para porque más allá el recorte deja de ser un realineado
 * y empieza a comerse el tipo de documento y el emisor, que son lo único con lo
 * que se puede comprobar que el arranque es el bueno.
 *
 * **Un recorte de más de uno NO es gratis**: sigue siendo `arriesgada` salvo que
 * la cabecera resultante tenga la forma que la norma exige (`cabeceraPlausible`).
 * Sin esa condición, ofrecer cinco arranques distintos multiplicaría por cinco
 * las ocasiones de que un dígito de control de una sola cifra cuadre por azar, y
 * un número inventado con el sello de «validado» es exactamente lo que este
 * analizador existe para no producir.
 */
function variantes(linea: string): Variante[] {
  const ajustar = (texto: string): string => texto.padEnd(LINE_LENGTH, '<').slice(0, LINE_LENGTH);
  const completa = (texto: string): boolean => texto.length >= LINE_LENGTH;
  const seguras: Variante[] = [
    { linea: ajustar(linea), arriesgada: false, completa: completa(linea) },
    { linea: ajustar(linea.slice(1)), arriesgada: false, completa: completa(linea.slice(1)) },
  ];

  /*
   * Los recortes de 2 a 4 por delante. Se marcan seguros SÓLO si el renglón
   * resultante empieza como empieza una TD1; en otro caso quedan como
   * arriesgados y tendrán que demostrarse con el control compuesto, igual que
   * las supresiones de en medio.
   */
  const porDelante: Variante[] = [];
  for (let corte = 2; corte <= 4 && corte < linea.length; corte += 1) {
    const recortada = ajustar(linea.slice(corte));
    porDelante.push({
      linea: recortada,
      arriesgada: !cabeceraPlausible(recortada),
      completa: completa(linea.slice(corte)),
    });
  }

  if (linea.length <= LINE_LENGTH) return [...seguras, ...porDelante];

  const sinUno: Variante[] = [];
  for (let i = 1; i < linea.length; i += 1) {
    const sin = `${linea.slice(0, i)}${linea.slice(i + 1)}`;
    sinUno.push({ linea: ajustar(sin), arriesgada: true, completa: completa(sin) });
  }
  return [...seguras, ...porDelante, ...sinUno];
}

function interpretar(l1: string, l2: string, l3: string, renglonesCompletos: boolean): MrzTd1 {
  const numeroCrudo = l1.slice(5, 14);
  // Un dígito de control es un DÍGITO por norma: una letra ahí es un misleído
  // con certeza, así que se deshace antes de comparar.
  const numeroControl = normalizeNumeric(l1.slice(14, 15));
  const nacimientoCrudo = l2.slice(0, 6);
  const nacimientoControl = normalizeNumeric(l2.slice(6, 7));
  const sexo = l2.slice(7, 8);
  const caducidadCruda = l2.slice(8, 14);
  const caducidadControl = normalizeNumeric(l2.slice(14, 15));
  const nacionalidad = normalizeAlpha(l2.slice(15, 18).replace(/</g, ''));
  const compuestoControl = normalizeNumeric(l2.slice(29, 30));

  /*
   * El número se valida en las DOS variantes y se entrega LA QUE CUADRÓ.
   *
   * Antes se validaba lo crudo y se entregaba lo normalizado, que son dos
   * documentos distintos: un número legítimo con letra (una TD1 lo admite)
   * validaba sobre lo crudo y se entregaba con la letra convertida en cifra —un
   * dato corrupto con el control en verde—. Y al revés, un `I234567` que el
   * control demuestra que era `1234567` se descartaba entero.
   */
  const numeroNormalizado = normalizeNumeric(numeroCrudo);
  const numeroValidaCrudo = checkDigit(numeroCrudo) === numeroControl;
  const numeroValidaNormalizado = checkDigit(numeroNormalizado) === numeroControl;
  const numeroBase = (numeroValidaCrudo ? numeroCrudo : numeroNormalizado).replace(/</g, '');

  /*
   * El número DESBORDADO: más de nueve caracteres.
   *
   * La norma reserva nueve posiciones al número y, cuando no caben, marca el
   * hueco del dígito de control con `<` y continúa el número al principio del
   * campo opcional, seguido del dígito de control del número COMPLETO y de un
   * `<`. El corpus lo transcribe entero y añade la parte que importa: ese `<` en
   * la posición 15 **no** significa checksum cero ni número inválido.
   *
   * Una cédula boliviana no llega a nueve caracteres, así que esto no se dispara
   * con `BOLIVIA_CI`. Existe porque `IDENTITY_ACCEPTED_DOCUMENT_TYPES` es una
   * decisión de despliegue: el día que se admita otro documento, un número largo
   * tiene que leerse, no descartarse.
   */
  const desborde = leerDesborde(l1, numeroCrudo);

  const nacimiento = normalizeNumeric(nacimientoCrudo);
  const caducidad = normalizeNumeric(caducidadCruda);

  /*
   * Cada control se declara NO EVALUABLE cuando no se pudo leer.
   *
   * Dos condiciones, y las dos son de LECTURA y no de documento: que el dígito
   * de control no sea un dígito, o que la tira sobre la que se calcula lleve
   * caracteres fuera del alfabeto de la MRZ. Ver `checks` en la interfaz.
   */
  const checks = {
    documentNumber: desborde
      ? desborde.valida
      : !esControlLegible(numeroControl)
        ? null
        : numeroValidaCrudo || numeroValidaNormalizado,
    birthDate: !esControlLegible(nacimientoControl)
      ? null
      : checkDigit(nacimiento) === nacimientoControl,
    expirationDate: !esControlLegible(caducidadControl)
      ? null
      : checkDigit(caducidad) === caducidadControl,
    composite: compuesto(l1, l2, compuestoControl, numeroValidaCrudo, renglonesCompletos),
  };

  const nombres = splitNames(l3);
  return {
    // Cada campo sólo se entrega si SU dígito de control cuadra. Un número que
    // no valida es peor que ninguno: parece un dato y no lo es.
    documentNumber:
      checks.documentNumber === true ? (desborde ? desborde.numero : numeroBase || null) : null,
    birthDate: checks.birthDate === true ? toIsoDate(nacimiento, 'nacimiento') : null,
    expirationDate: checks.expirationDate === true ? toIsoDate(caducidad, 'caducidad') : null,
    sex: sexo === 'M' || sexo === 'F' ? sexo : sexo === '<' ? 'X' : null,
    nationality: nacionalidad || null,
    issuingState: normalizeAlpha(l1.slice(2, 5).replace(/</g, '')) || null,
    lastNames: nombres.lastNames,
    firstNames: nombres.firstNames,
    checks,
  };
}

/**
 * Lo que la MRZ deja ver de sí misma en un diagnóstico: los renglones que el
 * reconocedor entregó —con el número de documento ENMASCARADO, la misma
 * decisión que el resultado— y qué controles cuadraron tras la interpretación.
 *
 * Existe para la traza de ejecución: «los campos no salieron» no se puede
 * depurar; «el renglón llegó con un glifo delante y el control de la caducidad
 * no cuadró» sí. Sin esto, la única forma de ver qué leyó el OCR era volver a
 * correr la verificación con las imágenes en la mano — que el motor borra.
 */
export interface MrzDiagnostics {
  found: boolean;
  /** Los renglones candidatos tal como llegaron, con el número enmascarado. */
  lines?: string[];
  checks?: MrzTd1['checks'];
}

export function mrzDiagnostics(rawText: string): MrzDiagnostics {
  const lineas = candidateLines(rawText);
  if (lineas.length < 3) return { found: false };
  const leida = parseMrzTd1(rawText);
  const enmascaradas = lineas.map((linea, indice) =>
    // El número vive en el primer renglón (posiciones 5-14); con corrimiento
    // posible se cubre un carácter a cada lado. Las fechas y el nombre ya
    // viajan claros en `fields`, así que sus renglones no se tocan.
    indice === 0
      ? `${linea.slice(0, 4)}${'•'.repeat(Math.min(12, Math.max(0, linea.length - 4)))}${linea.slice(16)}`
      : linea,
  );
  return {
    found: true,
    lines: enmascaradas,
    ...(leida ? { checks: leida.checks } : {}),
  };
}

/**
 * El control compuesto en TRES estados.
 *
 * Cuadra, no cuadra, o **no se puede comprobar**. Lo tercero ocurre por tres
 * motivos, todos de LECTURA:
 *
 * 1. El dígito de control no es un dígito —llegó `?`, `c`, un espacio—.
 * 2. Alguno de los dos renglones lleva caracteres fuera del alfabeto de la MRZ.
 * 3. Alguno de los dos renglones llegó corto y hubo que rellenarlo: el control
 *    se calcularía sobre caracteres que no leyó nadie.
 *
 * El tercero sólo invalida cuando el control FALLA. Si cuadra con el relleno
 * puesto, el relleno era el correcto y no hay nada que dudar.
 */
function compuesto(
  l1: string,
  l2: string,
  control: string,
  numeroValidaCrudo: boolean,
  renglonesCompletos: boolean,
): boolean | null {
  if (!esControlLegible(control) || !tiraLegible(`${l1}${l2}`)) return null;
  const cuadra = compositeCheck(l1, l2, control, numeroValidaCrudo);
  if (cuadra) return true;
  return renglonesCompletos ? false : null;
}

/**
 * Control compuesto de la TD1, con un intento de RECUPERACIÓN.
 *
 * El compuesto abarca el número, las dos fechas y sus controles: basta un
 * misleído numérico en cualquiera de ellos —la `Q` por un `0`— para que falle
 * sobre lo crudo aunque cada campo individual se haya recuperado. Así que se
 * prueba primero tal cual llegó y, si no cuadra, sobre la misma tira con las
 * confusiones numéricas deshechas en las posiciones que SÓLO pueden ser
 * dígitos (las fechas y sus controles). El número entra con la variante que
 * validó su propio control: si validó crudo, con letra legítima incluida.
 */
function compositeCheck(
  l1: string,
  l2: string,
  control: string,
  numeroValidaCrudo: boolean,
): boolean {
  const crudo = `${l1.slice(5, 30)}${l2.slice(0, 7)}${l2.slice(8, 15)}${l2.slice(18, 29)}`;
  if (checkDigit(crudo) === control) return true;
  /*
   * El DÍGITO DE CONTROL del número se normaliza SIEMPRE, valide el número
   * crudo o no. Aquí había un defecto que se llevaba por delante el compuesto de
   * cualquier cédula real: `numeroValidaCrudo` se calcula contra el control ya
   * normalizado —`interpretar` hace `normalizeNumeric(l1.slice(14, 15))`— pero
   * la variante «recuperada» volvía a tomar el tramo `5..15` en CRUDO, o sea con
   * la letra mal leída dentro. Medido sobre una cédula boliviana auténtica: el
   * renglón llegó como `I<BOL7689658<<T<<<…`, el número y sus tres compañeros
   * validaban, y el compuesto fallaba por esa misma `T` que el propio módulo ya
   * había decidido que era un `7`. Salía `MRZ_COMPOSITE_CHECK_FAILED` en el
   * expediente de un documento cuyos cuatro campos estaban demostrados.
   *
   * El número (`5..14`) sí conserva su forma cruda cuando validó así: una TD1
   * admite letras en el número de documento y convertirlas sería corromperlo. Lo
   * que no admite letras, por norma, es la posición 14.
   */
  const numero = numeroValidaCrudo ? l1.slice(5, 14) : normalizeNumeric(l1.slice(5, 14));
  const numeroSpan = `${numero}${normalizeNumeric(l1.slice(14, 15))}`;
  const recuperado =
    `${numeroSpan}${l1.slice(15, 30)}${normalizeNumeric(l2.slice(0, 7))}` +
    `${normalizeNumeric(l2.slice(8, 15))}${l2.slice(18, 29)}`;
  return checkDigit(recuperado) === control;
}

/**
 * Los tres renglones de la MRZ dentro del texto del OCR.
 *
 * Se buscan por FORMA y no por posición: el reconocedor mezcla la MRZ con el
 * resto del reverso y no garantiza ningún orden. Un renglón de MRZ es una tira
 * de treinta caracteres de un alfabeto cerrado —mayúsculas, dígitos y `<`— con
 * al menos un `<`, que es lo que no aparece en un texto normal.
 */
function candidateLines(rawText: string): string[] {
  const posibles = rawText
    .split('\n')
    .map((linea) => linea.replace(/\s+/g, '').toUpperCase())
    // El OCR confunde el relleno `<` con `«`, `K` o `C` seguidas; sólo se
    // normaliza el carácter de relleno, nunca el contenido.
    .map((linea) => linea.replace(/[«‹]/g, '<'))
    /*
     * Un renglón que YA trae relleno real y poquísimo ruido es una MRZ
     * maltratada, no un texto: el glifo intruso (`¢`, `|`, `¿`…) se sustituye
     * por relleno y son los dígitos de control quienes deciden si el renglón
     * vale. Antes un solo glifo descartaba el renglón entero, y con él la única
     * fuente del documento que puede demostrarse. La condición de los DOS `<`
     * previos es lo que deja fuera un domicilio con puntos o barras: un texto
     * normal no trae relleno de MRZ.
     */
    .map((linea) => {
      const relleno = (linea.match(/</g) ?? []).length;
      const ruido = (linea.match(/[^A-Z0-9<]/g) ?? []).length;
      return relleno >= 2 && ruido > 0 && ruido <= 3 ? linea.replace(/[^A-Z0-9<]/g, '<') : linea;
    })
    /*
     * El mínimo es 20 y no 28, y esto NO es laxitud: el reconocedor se come los
     * `<` finales con muchísima frecuencia —son relleno, y un relleno repetido
     * veinte veces es justo lo que un OCR abrevia—. Medido aquí:
     * `IDBOL7654321<<8<<<<<<<<<<<` llegó con 26 caracteres, y exigir 28
     * descartaba la línea, con ella la MRZ entera, y con ella la única fuente
     * del documento que trae dígitos de control. El relleno se repone abajo, y
     * si la reposición fuera incorrecta el propio dígito de control lo delata.
     */
    .filter((linea) => /^[A-Z0-9<]{20,34}$/.test(linea) && (linea.match(/</g) ?? []).length >= 2);

  /*
   * Los TRES ÚLTIMOS. La MRZ va al pie del documento, y por delante puede haber
   * texto que también case con el patrón —un domicilio en mayúsculas y sin
   * espacios, por ejemplo—. Quedarse con los primeros elegía justamente ése.
   *
   * Sin ajustar a 30 todavía: eso lo hace `variantes`, que necesita el renglón
   * ENTERO para poder realinearlo sin perder su último carácter.
   */
  return posibles.slice(-3);
}

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
function splitNames(line: string): { lastNames: string | null; firstNames: string | null } {
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
 * Dígito de control de ICAO 9303: pesos 7-3-1 en ciclo, letras como 10..35 y
 * el relleno como cero.
 *
 * Se exporta para poder comprobarlo contra los ejemplos que el propio corpus
 * trae calculados (`520727` → `3`, `AB2134<<<` → `5`). Una aritmética que se
 * demuestra contra un oráculo externo vale más que una que se demuestra contra
 * sus propias pruebas.
 */
export function checkDigit(valor: string): string {
  const pesos = [7, 3, 1];
  let suma = 0;
  for (let i = 0; i < valor.length; i += 1) {
    const caracter = valor[i];
    let peso = 0;
    if (caracter >= '0' && caracter <= '9') peso = caracter.charCodeAt(0) - 48;
    else if (caracter >= 'A' && caracter <= 'Z') peso = caracter.charCodeAt(0) - 55;
    else peso = 0; // `<` y cualquier cosa que no debiera estar ahí
    suma += peso * pesos[i % 3];
  }
  return String(suma % 10);
}

/**
 * El número de documento cuando NO cabe en las nueve posiciones de la TD1.
 *
 * Devuelve `null` cuando no hay desbordamiento —el caso normal— y, cuando lo
 * hay, el número completo con el veredicto de su dígito de control. Si la
 * continuación no se puede interpretar, `valida` es `null`: no evaluable, que es
 * lo que el corpus manda hacer con un desbordamiento ambiguo («REVISIÓN;
 * conservar raw»).
 */
function leerDesborde(
  l1: string,
  numeroCrudo: string,
): { numero: string; valida: boolean | null } | null {
  // El disparador es EXACTAMENTE un `<` en la posición del dígito de control.
  if (l1.slice(14, 15) !== '<') return null;

  /*
   * El campo opcional lleva `<continuación><control del número completo><`.
   *
   * El orden importa y es fácil de leer al revés: el dígito de control va
   * DESPUÉS de la continuación y ANTES del relleno, así que es el carácter que
   * precede al primer `<`, no el que lo sigue.
   */
  const opcional = l1.slice(15, 30);
  const corte = opcional.indexOf('<');
  if (corte <= 1) return null;
  const continuacion = opcional.slice(0, corte - 1);
  const control = normalizeNumeric(opcional.slice(corte - 1, corte));
  const completo = `${numeroCrudo.replace(/</g, '')}${continuacion}`;

  if (!esControlLegible(control)) return { numero: completo, valida: null };
  const cuadra =
    checkDigit(completo) === control || checkDigit(normalizeNumeric(completo)) === control;
  return {
    numero: cuadra && checkDigit(completo) !== control ? normalizeNumeric(completo) : completo,
    valida: cuadra,
  };
}

/** Deshace las confusiones de OCR que sólo pueden ser dígitos. */
function normalizeNumeric(valor: string): string {
  return [...valor].map((caracter) => NUMERIC_FIXES[caracter] ?? caracter).join('');
}

/**
 * `AAMMDD` a fecha ISO.
 *
 * El siglo no está en la MRZ y hay que decidirlo. Para un NACIMIENTO, un año
 * por delante del actual sólo puede ser del siglo pasado; para una CADUCIDAD es
 * al revés —una tarjeta caduca hacia adelante—, así que se toma el 20xx salvo
 * que quede absurdamente lejos.
 */
function toIsoDate(valor: string, tipo: 'nacimiento' | 'caducidad'): string | null {
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
