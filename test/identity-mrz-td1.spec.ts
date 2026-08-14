import {
  mrzDiagnostics,
  parseMrzTd1,
} from '../src/modules/workers/identity-verification/core/parsers/mrz-td1';

/**
 * La zona de lectura mecánica del reverso, sin OCR de por medio.
 *
 * Se prueba aparte del pipeline porque es lo único del documento que se puede
 * verificar: sus dígitos de control permiten distinguir «lo leí» de «lo leí
 * bien». Esa distinción es la que decide si un número entra al expediente de
 * alguien o se descarta, así que merece pruebas que no dependan de qué vio hoy
 * el reconocedor.
 *
 * Las líneas de aquí son sintéticas y sus controles están calculados: si
 * alguien cambia la aritmética, estas pruebas se ponen rojas antes que
 * cualquier escenario.
 */

/** Una TD1 completa y coherente: el caso que debe validar entero. */
const VALIDA = [
  'IDBOL1234567<<4<<<<<<<<<<<<<<<',
  '0304052F2811017BOL<<<<<<<<<<<0',
  'RODRIGUEZ<GONZALEZ<<MARIA<RENE',
].join('\n');

describe('MRZ TD1 del reverso de la cédula', () => {
  it('lee los campos y todos sus controles cuadran', () => {
    const mrz = parseMrzTd1(VALIDA);
    expect(mrz).not.toBeNull();
    expect(mrz?.documentNumber).toBe('1234567');
    expect(mrz?.birthDate).toBe('2003-04-05');
    expect(mrz?.expirationDate).toBe('2028-11-01');
    expect(mrz?.sex).toBe('F');
    expect(mrz?.nationality).toBe('BOL');
    expect(mrz?.issuingState).toBe('BOL');
    expect(mrz?.lastNames).toBe('RODRIGUEZ GONZALEZ');
    expect(mrz?.checks.documentNumber).toBe(true);
    expect(mrz?.checks.birthDate).toBe(true);
    expect(mrz?.checks.expirationDate).toBe(true);
  });

  it('descarta el número cuando su dígito de control no cuadra', () => {
    /*
     * Es la razón de ser de este módulo. Un dígito cambiado produce un número
     * que PARECE igual de válido —siete cifras, formato correcto— y que en un
     * expediente de identidad es peor que no tener ninguno.
     */
    const alterada = VALIDA.replace('IDBOL1234567', 'IDBOL1234568');
    const mrz = parseMrzTd1(alterada);
    expect(mrz?.checks.documentNumber).toBe(false);
    expect(mrz?.documentNumber).toBeNull();
    // Y no contamina a los demás: la fecha de nacimiento sigue siendo válida.
    expect(mrz?.birthDate).toBe('2003-04-05');
  });

  it('sobrevive a que el reconocedor se coma el relleno final', () => {
    /*
     * Medido de verdad sobre una tarjeta perfectamente legible: Tesseract
     * devolvió `IDBOL7654321<<8<<<<<<<<<<<` —26 caracteres en vez de 30— porque
     * un relleno repetido veinte veces es justo lo que un OCR abrevia. La
     * primera versión exigía 28 y descartaba la MRZ entera por eso.
     */
    const corta = [
      'IDBOL1234567<<4<<<<<<<<<<<',
      '0304052F2811017BOL<<<<<<<<<<<0',
      'RODRIGUEZ<GONZALEZ<<MARIA<RENE',
    ].join('\n');
    expect(parseMrzTd1(corta)?.documentNumber).toBe('1234567');
  });

  it('deshace las confusiones de OCR que sólo pueden ser dígitos', () => {
    // En las posiciones numéricas no puede haber letras: una `O` ahí es un cero
    // con certeza, no una interpretación. Y el control lo confirma.
    const confundida = VALIDA.replace('0304052F', 'O3O4O52F');
    expect(parseMrzTd1(confundida)?.birthDate).toBe('2003-04-05');
  });

  it('se queda con los TRES ÚLTIMOS renglones que parecen MRZ', () => {
    /*
     * El reverso trae texto en mayúsculas que, sin espacios, casa con el mismo
     * patrón —un domicilio, por ejemplo—. La MRZ va al pie, así que elegir los
     * primeros tomaba el domicilio como primera línea y no validaba nada.
     */
    const conRuido = ['CSANCHEZLIMANO2520ZSOPOCACHI<<', VALIDA].join('\n');
    expect(parseMrzTd1(conRuido)?.documentNumber).toBe('1234567');
  });

  it('devuelve null cuando no hay MRZ, y eso NO es un error', () => {
    // Es una cédula del formato anterior, o una foto sólo del anverso.
    expect(parseMrzTd1('CEDULA DE IDENTIDAD\nNo 1234567\nA: PERSONA PRUEBA')).toBeNull();
  });

  it('sobrevive a un glifo de ruido dentro del relleno', () => {
    /*
     * Un `¢` o una `|` en medio del relleno descartaba el renglón entero —el
     * filtro era todo-o-nada— y con él la MRZ completa. El glifo se sustituye
     * por relleno y los controles deciden: aquí cae sobre un `<`, así que la
     * tira queda idéntica y TODO valida, compuesto incluido.
     */
    const conBasura = VALIDA.replace(
      'IDBOL1234567<<4<<<<<<<<<<<<<<<',
      'IDBOL1234567<<4<<<<¢<<<<<<<<<<',
    );
    const mrz = parseMrzTd1(conBasura);
    expect(mrz?.documentNumber).toBe('1234567');
    expect(mrz?.checks.composite).toBe(true);
  });

  it('no toma por MRZ un domicilio con puntos y barras', () => {
    // La sustitución de ruido exige relleno real previo: un texto normal con
    // `.` y `/` no trae `<`, así que no se disfraza de renglón MRZ ni desplaza
    // a los verdaderos al elegir los tres últimos.
    const conDomicilio = [VALIDA, 'AV.MUTUALISTAC/CUQUISASNRO2180'].join('\n');
    expect(parseMrzTd1(conDomicilio)?.documentNumber).toBe('1234567');
  });

  it('recupera el número cuando el OCR leyó una letra donde iba una cifra', () => {
    // `I234567` con el control de `1234567`: la variante cruda no cuadra, la
    // normalizada sí, y se entrega la que el control demuestra.
    const confundida = VALIDA.replace('IDBOL1234567', 'IDBOLI234567');
    const mrz = parseMrzTd1(confundida);
    expect(mrz?.documentNumber).toBe('1234567');
    expect(mrz?.checks.documentNumber).toBe(true);
  });

  it('entrega la letra LEGÍTIMA del número cuando lo crudo es lo que valida', () => {
    /*
     * Una TD1 admite letras en el número de documento. `A123456` con su control
     * calculado sobre la A (155 → 5) validaba sobre lo crudo pero se entregaba
     * normalizado —`0123456`, un número que no existe, con el control en
     * verde—. Ahora se entrega la variante que cuadró.
     */
    const conLetra = VALIDA.replace('IDBOL1234567<<4', 'IDBOLA123456<<5');
    const mrz = parseMrzTd1(conLetra);
    expect(mrz?.checks.documentNumber).toBe(true);
    expect(mrz?.documentNumber).toBe('A123456');
  });

  it('el compuesto se recupera de las mismas confusiones que los campos', () => {
    // `O3O4O52F`: cada campo ya se recuperaba, pero el compuesto se calculaba
    // sobre lo crudo y quedaba en falso — y de él depende, por ejemplo, fiarse
    // del estado emisor para la nacionalidad.
    const confundida = VALIDA.replace('0304052F', 'O3O4O52F');
    expect(parseMrzTd1(confundida)?.checks.composite).toBe(true);
  });

  it('tolera el dígito de control compuesto leído como letra', () => {
    // El control es un dígito por norma: una `O` ahí es un cero con certeza.
    const control = VALIDA.replace('BOL<<<<<<<<<<<0', 'BOL<<<<<<<<<<<O');
    expect(parseMrzTd1(control)?.checks.composite).toBe(true);
  });

  it('un glifo espurio DELANTE del renglón se detecta y el renglón se realinea', () => {
    /*
     * El caso medido sobre una cédula real: el reconocedor metió un carácter
     * delante del segundo renglón y TODO se corrió una posición — la
     * nacionalidad salía «5BO» (el control de la caducidad en el hueco de al
     * lado), y las dos fechas se descartaban con sus controles. La variante
     * sin el primer carácter realinea el renglón y los controles la demuestran,
     * incluido el compuesto: el renglón traía 31 caracteres y el último —el
     * control compuesto— se conserva al realinear.
     */
    const corrida = VALIDA.replace(
      '0304052F2811017BOL<<<<<<<<<<<0',
      'X0304052F2811017BOL<<<<<<<<<<<0',
    );
    const mrz = parseMrzTd1(corrida);
    expect(mrz?.birthDate).toBe('2003-04-05');
    expect(mrz?.expirationDate).toBe('2028-11-01');
    expect(mrz?.nationality).toBe('BOL');
    expect(mrz?.checks.composite).toBe(true);
  });

  it('sin corrimiento real, la variante realineada nunca gana: la eligen los controles', () => {
    // Los controles de la MRZ intacta cuadran tal cual; quitarle el primer
    // carácter los rompería todos, así que la puntuación conserva la original.
    const mrz = parseMrzTd1(VALIDA);
    expect(mrz?.documentNumber).toBe('1234567');
    expect(mrz?.birthDate).toBe('2003-04-05');
    expect(mrz?.checks.composite).toBe(true);
  });

  it('el caso real completo: tipo «I<», una cifra leída como letra y DOS renglones corridos', () => {
    /*
     * Reproduce, con un documento inventado, la combinación exacta que traía una
     * cédula boliviana vigente fotografiada sobre una mesa —el caso que motivó
     * todas las tolerancias de este módulo—: el tipo de documento es `I<` y no
     * `ID`, el reconocedor leyó una `Q` donde iba un `0`, y metió un glifo
     * espurio delante del segundo Y del tercer renglón.
     *
     * El número del documento va inventado a propósito: el caso venía de una
     * cédula real, y el número de una persona no se versiona en un repositorio.
     * Lo que se prueba es la ESTRUCTURA del fallo, que es lo que se rompió.
     *
     * Antes de las tolerancias, esto entregaba el número y nada más: las dos
     * fechas se descartaban con sus controles y la nacionalidad salía «5BO» —el
     * dígito de control de la caducidad, corrido al hueco de al lado—.
     */
    const comoLaLeyoElOcr = [
      'I<BOL1234567<<4<<<<<<<<<<<<<<<',
      'X03Q4052F2811017BOL<<<<<<<<<<<0',
      'ERODRIGUEZ<GONZALEZ<<MARIA<RENE',
    ].join('\n');

    const mrz = parseMrzTd1(comoLaLeyoElOcr);
    expect(mrz?.documentNumber).toBe('1234567');
    expect(mrz?.birthDate).toBe('2003-04-05');
    expect(mrz?.expirationDate).toBe('2028-11-01');
    expect(mrz?.nationality).toBe('BOL');
    expect(mrz?.sex).toBe('F');
    expect(mrz?.checks.composite).toBe(true);
  });

  it('el diagnóstico enseña los renglones pero NUNCA el número del documento', () => {
    // La traza de ejecución existe para depurar, y depurar no es una excusa
    // para publicar el número de la cédula de alguien.
    const diagnostico = mrzDiagnostics(VALIDA);
    expect(diagnostico.found).toBe(true);
    expect(diagnostico.lines?.[0]).not.toContain('1234567');
    expect(diagnostico.lines?.[0]).toContain('•');
    // Y sí dice qué controles cuadraron, que es lo que se va a mirar.
    expect(diagnostico.checks?.composite).toBe(true);
  });

  it('sin MRZ el diagnóstico lo dice, en vez de fingir renglones vacíos', () => {
    expect(mrzDiagnostics('CEDULA DE IDENTIDAD\nNo 1234567')).toEqual({ found: false });
  });

  it('sitúa el siglo del nacimiento por delante o por detrás según el año', () => {
    // Una tarjeta caduca hacia adelante; una persona nace hacia atrás. Sin esta
    // asimetría, un nacido en 1998 saldría nacido en 2098.
    // `980405` con su control recalculado: 9·7+8·3+0·1+4·7+0·3+5·1 = 120 → 0.
    // El control se calcula, no se copia: con uno inventado el campo se
    // descartaría y la prueba pasaría por vacío sin comprobar el siglo.
    const mayor = VALIDA.replace('0304052F', '9804050F');
    const leida = parseMrzTd1(mayor);
    expect(leida?.birthDate?.startsWith('19')).toBe(true);
    expect(leida?.expirationDate?.startsWith('20')).toBe(true);
  });
});
