/**
 * El pipeline de verificación de identidad, ejercitado ENTERO.
 *
 * Es la prueba de equivalencia funcional que exige la integración: el núcleo
 * absorbido del paquete original —normalización con `sharp`, medida de calidad,
 * OCR, clasificador, analizador de cédula boliviana, comparación biométrica y
 * motor de decisión— corre dentro de este repositorio, con su compilación a
 * CommonJS y sobre imágenes reales generadas al vuelo.
 *
 * **Aquí ya no queda nada simulado.** Los proveedores lo estaban —era lo que el
 * paquete original sustituía en su laboratorio— y eso hacía que esta batería
 * midiera el cableado y no la verificación: el comparador devolvía el parecido
 * que le pedía el nombre del escenario, así que «se rechaza por rostro distinto»
 * pasaba con dos imágenes idénticas. Hoy el texto lo lee Tesseract y los rostros
 * los detecta, describe y compara Human, los dos en local y sobre WebAssembly.
 * Un escenario aprueba porque las dos caras son la misma, y la prueba tarda
 * segundos por caso porque está haciendo el trabajo de verdad.
 *
 * Lo que se afirma es el VEREDICTO de cada escenario, no que se llamara a nadie:
 * un escenario que promete «va a revisión» y termina verificado no es un
 * escenario, es una etiqueta —y la consola se la enseña al usuario antes de
 * ejecutarlo—.
 */
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { HeuristicDocumentClassifierAdapter } from '../src/modules/workers/identity-verification/core/adapters/local-providers.adapter';
import {
  HumanFaceDetectorAdapter,
  HumanFaceMatchAdapter,
  HumanLivenessAdapter,
} from '../src/modules/workers/identity-verification/core/adapters/human-face.adapter';
import { TesseractOcrAdapter } from '../src/modules/workers/identity-verification/core/adapters/tesseract-ocr.adapter';
import { SharpImageAdapter } from '../src/modules/workers/identity-verification/core/adapters/sharp-image.adapter';
import { IdentityDecision } from '../src/modules/workers/identity-verification/core/domain/identity-enums';
import { IdentityDomainError } from '../src/modules/workers/identity-verification/core/domain/identity-domain.error';
import { ImageQualityAssessmentService } from '../src/modules/workers/identity-verification/core/image-quality-assessment.service';
import {
  IDENTITY_DEFAULTS,
  type IdentityOptions,
} from '../src/modules/workers/identity-verification/core/identity-options';
import { BoliviaCiDocumentParser } from '../src/modules/workers/identity-verification/core/parsers/bolivia-ci-document.parser';
import {
  GenericDocumentParser,
  PassportDocumentParser,
} from '../src/modules/workers/identity-verification/core/parsers/document-parser';
import { DocumentParserRegistry } from '../src/modules/workers/identity-verification/core/parsers/document-parser.registry';
import {
  buildIdentityFixtureImages,
  findIdentityFixture,
  IDENTITY_FIXTURES,
} from '../src/modules/workers/identity-verification/fixtures/identity-fixtures';
import { IdentityPipelineService } from '../src/modules/workers/identity-verification/identity-pipeline.service';
import type { IdentityVerificationOutcome } from '../src/modules/workers/identity-verification/identity-result';

// Remuestrear tres imágenes de un megapíxel cuesta segundos, no milisegundos.
jest.setTimeout(180_000);

/**
 * Los umbrales MEDIDOS, no unos de laboratorio.
 *
 * Salen de `scripts/calibrar-identidad.mjs` sobre la población sintética: 60
 * personas, tres tomas de cada una, 156 parejas genuinas y 13 374 impostoras.
 * El corte de aprobación es el percentil de las impostoras que deja pasar una de
 * cada mil, y el de rechazo el que rechaza una de cada cien genuinas.
 *
 * Se declaran AQUÍ y no se toman del entorno porque sin ellos el motor de
 * decisión devuelve `REVIEW_REQUIRED` para todo —su valor seguro— y esta prueba
 * no distinguiría un pipeline sano de uno que no llega nunca a comparar.
 */
const APROBACION = 0.8824;
const REVISION = 0.7789;
const OPTIONS: IdentityOptions = {
  ...IDENTITY_DEFAULTS,
  matchThreshold: APROBACION,
  reviewThreshold: REVISION,
  thresholdProfileVersion: 'sintetico-60x3-fmr1e-3-fnmr1e-2',
};

/**
 * Un solo lector para toda la batería. Arrancar Tesseract carga el wasm y el
 * modelo del idioma: hacerlo por prueba multiplicaría por diez el reloj sin
 * comprobar nada nuevo.
 */
const ocr = new TesseractOcrAdapter();

afterAll(async () => {
  await ocr.onModuleDestroy();
});

function buildPipeline(options: IdentityOptions = OPTIONS): IdentityPipelineService {
  const images = new SharpImageAdapter(options);
  const parsers = new DocumentParserRegistry(
    new BoliviaCiDocumentParser(),
    new PassportDocumentParser(),
    new GenericDocumentParser(),
  );
  return new IdentityPipelineService(
    options,
    images,
    ocr,
    new HeuristicDocumentClassifierAdapter(),
    new HumanFaceDetectorAdapter(options),
    new HumanFaceMatchAdapter(options),
    new HumanLivenessAdapter(options),
    parsers,
    new ImageQualityAssessmentService(options),
  );
}

async function runFixture(
  code: string,
  pipeline = buildPipeline(),
): Promise<IdentityVerificationOutcome> {
  const fixture = findIdentityFixture(code);
  if (!fixture) throw new Error(`escenario inexistente: ${code}`);
  const images = await buildIdentityFixtureImages(fixture);
  return pipeline.run({
    documentImage: images.document,
    documentBackImage: images.documentBack,
    selfieImage: images.selfie,
    documentCountry: 'BO',
    correlationId: 'prueba',
    /*
     * Lo mismo que pone el worker cuando la ejecución nace del catálogo.
     *
     * Sin esto, la prueba de vida CORRE sobre una imagen generada y el antispoof
     * responde lo que debe responder ante un dibujo: ni convencido ni en contra
     * —medido, entre 0,44 y 0,67—, o sea NO CONCLUYENTE, y el escenario limpio
     * terminaba en revisión por ese motivo. La salida correcta no era bajar el
     * listón del antispoof —eso debilita la defensa contra la foto impresa, que
     * es el ataque que existe para parar— sino declarar que sobre una entrada
     * fabricada la prueba de vida no se ejecuta.
     */
    entradaGenerada: true,
  });
}

/**
 * El escenario limpio con la foto DERECHA, ejecutado una sola vez.
 *
 * Es la referencia contra la que se comparan las tomas giradas. Se compara
 * contra ella y no contra un decimal escrito a mano por el mismo motivo que la
 * prueba del parecido ambiguo no fija el suyo: un número clavado en el archivo
 * convierte la prueba en un detector de cambios de versión del modelo. Lo que
 * hay que afirmar es la IGUALDAD entre las dos rutas, y eso sobrevive a que el
 * comparador se actualice.
 */
let derechaCache: Promise<IdentityVerificationOutcome> | null = null;
function derechaMemo(): Promise<IdentityVerificationOutcome> {
  derechaCache ??= runFixture('identidad-aprobada');
  return derechaCache;
}

describe('escenarios del worker de verificación de identidad', () => {
  it('genera imágenes reales, deterministas y distintas entre escenarios', async () => {
    const huellas = new Set<string>();
    for (const fixture of IDENTITY_FIXTURES) {
      const primera = await buildIdentityFixtureImages(fixture);
      // PNG: los ocho bytes de firma. Si esto cambia, la validación de entrada
      // rechazaría el propio escenario.
      expect([...primera.document.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect([...primera.selfie.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      // La huella se toma del contenido ENTERO. Comparar los primeros bytes
      // decía «sólo hay dos escenarios distintos»: la cabecera PNG y su IHDR
      // son idénticos para dos imágenes del mismo tamaño, así que ese atajo
      // medía el formato, no los píxeles.
      huellas.add(createHash('sha256').update(primera.document).digest('hex'));
      // Y son reproducibles: la deduplicación se apoya en esa huella.
      const segunda = await buildIdentityFixtureImages(fixture);
      expect(segunda.document.equals(primera.document)).toBe(true);
    }
    // La idempotencia del worker se apoya en la huella del contenido: dos
    // escenarios con los mismos píxeles se fundirían en una sola ejecución y el
    // segundo devolvería el veredicto del primero.
    expect(huellas.size).toBe(IDENTITY_FIXTURES.length);
  });

  it('«Verificación limpia» termina VERIFICADO y lee la cédula', async () => {
    const outcome = await runFixture('identidad-aprobada');

    expect(outcome.decision).toBe(IdentityDecision.VERIFIED);
    expect(outcome.reasonCodes).toEqual([]);
    expect(outcome.calibratedFaceDecision).toBe('MATCH');
    expect(outcome.documentType).toBe('BOLIVIA_CI');
    // El analizador absorbido tiene que haber leído de verdad: nombre completo,
    // fecha de nacimiento normalizada a ISO y caducidad. Sin esto, la prueba
    // pasaría igual con un analizador que devolviera campos vacíos.
    expect(outcome.fields.fullName?.value).toBe('MARIA RENEE RODRIGUEZ GONZALEZ');
    expect(outcome.fields.dateOfBirth?.value).toBe('2003-04-05');
    expect(outcome.fields.expirationDate?.value).toBe('2028-11-01');
    // Y salen de la MRZ, no del texto impreso: es la fuente que se puede
    // demostrar con sus dígitos de control.
    expect(outcome.fields.dateOfBirth?.source).toBe('MRZ');
    expect(outcome.fields.documentNumber?.source).toBe('MRZ');
    expect(outcome.thresholdProfileVersion).toBe('sintetico-60x3-fmr1e-3-fnmr1e-2');
  });

  /**
   * La cédula fotografiada CON EL MÓVIL EN VERTICAL.
   *
   * Es como la fotografía la mayoría de la gente, y era un rechazo seguro:
   * Tesseract lee texto horizontal, así que sobre la tarjeta tumbada devolvía
   * ruido —medido: 403 caracteres y cero palabras reconocibles, frente a 26
   * palabras derecha—, el clasificador no encontraba «CÉDULA» y el pipeline
   * contestaba «la imagen tiene texto, pero no corresponde a ningún documento de
   * identidad soportado». El mensaje culpaba al documento, que estaba perfecto.
   *
   * Se prueban los cuatro cuartos de vuelta, no sólo uno: 180° es el caso que
   * más fácil se cuela, porque ahí el reconocedor SÍ devuelve secuencias con
   * pinta de palabras —27, una más que la orientación correcta— y cualquier
   * criterio basado en «cuánto texto salió» elegiría esa.
   */
  it.each([90, 180, 270] as const)(
    'una cédula fotografiada girada %i° se endereza y da el MISMO resultado',
    async (grados) => {
      const fixture = findIdentityFixture('identidad-aprobada');
      const images = await buildIdentityFixtureImages(fixture!);
      // PNG: el giro de la ENTRADA no debe perder nada, o la prueba mediría la
      // compresión en vez de la orientación.
      const girar = (imagen: Buffer) => sharp(imagen).rotate(grados).png().toBuffer();

      const outcome = await buildPipeline().run({
        documentImage: await girar(images.document),
        documentBackImage: images.documentBack ? await girar(images.documentBack) : null,
        // La selfie NO se gira: quien sujeta el móvil en vertical se hace la
        // selfie derecha. Girarla también sería probar otra cosa.
        selfieImage: images.selfie,
        documentCountry: 'BO',
        correlationId: `prueba-girada-${grados}`,
        entradaGenerada: true,
      });

      expect(outcome.decision).toBe(IdentityDecision.VERIFIED);
      expect(outcome.documentType).toBe('BOLIVIA_CI');
      expect(outcome.reasonCodes).toEqual([]);
      // No basta con que clasifique: el documento tiene que quedar derecho
      // también para el retrato, o la verificación se cae un paso más allá con
      // «no se detectó ningún rostro» —el mismo rechazo, con otro nombre—.
      expect(outcome.fields.fullName?.value).toBe('MARIA RENEE RODRIGUEZ GONZALEZ');
      expect(outcome.fields.documentNumber?.value).toBe('••••567');
      expect(outcome.fields.dateOfBirth?.value).toBe('2003-04-05');
      expect(outcome.fields.expirationDate?.value).toBe('2028-11-01');
      /*
       * Y el parecido sale EXACTO, no parecido.
       *
       * Es lo que separa este arreglo de uno que sólo tape el síntoma. Se probó
       * antes girando la imagen ya normalizada —más barato— y el parecido caía a
       * 0,8707, por debajo del umbral de aprobación: la cédula se reconocía y
       * aun así la persona terminaba en revisión manual. Enderezando la foto
       * ORIGINAL y normalizando después, el descriptor ve exactamente los mismos
       * píxeles que habría visto con la foto derecha. Si alguien vuelve a mover
       * el giro detrás de la normalización, este decimal lo canta.
       */
      expect(outcome.faceMatch?.comparable).toBe(true);
      const derecha = await derechaMemo();
      expect(outcome.faceMatch?.similarityScore).toBe(derecha.faceMatch?.similarityScore);
    },
  );

  it('el número de documento sale enmascarado del pipeline, no de la pantalla', async () => {
    const outcome = await runFixture('identidad-aprobada');
    // Lo que se guarda en la fila es este objeto: una consola de base de datos
    // leería el número entero si el enmascarado viviera en el frontend.
    expect(outcome.fields.documentNumber?.value).toBe('••••567');
    expect(JSON.stringify(outcome)).not.toContain('1234567');
  });

  it('«Parecido ambiguo» va a revisión, no se aprueba ni se rechaza', async () => {
    const outcome = await runFixture('identidad-revision');
    expect(outcome.decision).toBe(IdentityDecision.REVIEW_REQUIRED);
    expect(outcome.reasonCodes).toContain('AMBIGUOUS_MATCH');
    /*
     * El parecido cae DENTRO de la franja, y eso es todo lo que se puede
     * afirmar. Antes esto exigía 0,78 exacto porque el comparador simulado
     * devolvía esa constante; hoy sale de comparar dos imágenes y depende del
     * modelo, así que fijar un decimal convertiría esta prueba en un detector de
     * cambios de versión en vez de una comprobación de la regla.
     */
    const parecido = outcome.faceMatch?.similarityScore ?? 0;
    expect(parecido).toBeGreaterThanOrEqual(REVISION);
    expect(parecido).toBeLessThan(APROBACION);
  });

  it('«Rostro distinto» se rechaza', async () => {
    const outcome = await runFixture('identidad-rechazada');
    expect(outcome.decision).toBe(IdentityDecision.NOT_VERIFIED);
    expect(outcome.reasonCodes).toContain('FACE_NO_MATCH');
    expect(outcome.calibratedFaceDecision).toBe('NO_MATCH');
  });

  it('«Documento sin retrato» se rechaza ANTES de comparar', async () => {
    /*
     * Aquí había un escenario que prometía NO CONCLUYENTE, y con el comparador
     * simulado lo cumplía porque bastaba pedírselo. Con biometría real NO ES
     * ALCANZABLE desde una cédula con retrato: en cuanto el detector encuentra
     * la cara, el descriptor devuelve rasgos. Se midió —pixelar a 64 px ya
     * impide detectarla, y quemarla a ×3,4 seguía comparando a 0,79—, así que
     * mantenerlo habría sido volver a anunciar algo que el motor no hace.
     *
     * Lo que sí ocurre, y es lo que se comprueba, es que una fotocopia sin
     * retrato se corta antes de comparar. El motor no inventa un parecido.
     */
    await expect(runFixture('identidad-sin-retrato')).rejects.toMatchObject({
      code: 'IDENTITY_FACE_NOT_FOUND',
      category: 'VALIDATION',
      retryable: false,
    });
  });

  it('«Documento caducado» se rechaza antes que cualquier otra señal', async () => {
    const outcome = await runFixture('identidad-caducada');
    expect(outcome.decision).toBe(IdentityDecision.NOT_VERIFIED);
    /*
     * Rechazo INCONDICIONAL: el rostro de la selfie es el del titular y el
     * parecido queda por encima del corte de aprobación, así que sin la regla de
     * caducidad esto habría salido VERIFICADO. Que el único motivo sea la
     * caducidad es lo que lo demuestra.
     */
    expect(outcome.reasonCodes).toEqual(['DOCUMENT_EXPIRED']);
  });

  it('«Campos no legibles» se reconoce como cédula pero va a revisión', async () => {
    /*
     * La otra mitad de la comprobación anterior, y la que impide que el rechazo
     * se coma casos legítimos: aquí el lector SÍ ve que es una cédula —la
     * cabecera se lee— pero no puede sacar el número ni el nombre. Eso no es
     * «no es un documento»: es un documento que hay que mirar a mano.
     */
    const outcome = await runFixture('identidad-ilegible');
    expect(outcome.documentType).toBe('BOLIVIA_CI');
    expect(outcome.decision).toBe(IdentityDecision.REVIEW_REQUIRED);
    expect(outcome.reasonCodes).toContain('DOCUMENT_FIELD_INCONSISTENCY');
    expect(outcome.fields.documentNumber?.value).toBeNull();
  });

  it('una imagen cualquiera se RECHAZA por no ser un documento', async () => {
    /*
     * La comprobación que este worker no tenía. Con un lector simulado el OCR
     * inventaba una cédula boliviana pasara lo que pasara en la imagen, así que
     * una foto normal terminaba VERIFICADA. Ahora el texto se lee de verdad: sin
     * letras no hay documento, y eso es un error de VALIDACIÓN —no un veredicto
     * de identidad— que además se corta ANTES de comparar ningún rostro.
     */
    await expect(runFixture('imagen-cualquiera')).rejects.toMatchObject({
      code: 'IDENTITY_DOCUMENT_UNSUPPORTED',
      category: 'VALIDATION',
      retryable: false,
    });
    // Y el mensaje distingue «no leí nada» de «leí algo que no es un documento»:
    // no se arreglan igual.
    await expect(runFixture('imagen-cualquiera')).rejects.toThrow(/no se pudo leer ningún texto/i);
  });

  it('«Foto inservible» falla como error de VALIDACIÓN, no reintentable', async () => {
    // La categoría es lo que el servicio de fondo lee para decidir si reencola:
    // una foto borrosa va a estar borrosa las tres veces.
    await expect(runFixture('identidad-foto-mala')).rejects.toMatchObject({
      code: 'IDENTITY_DOCUMENT_BLURRY',
      category: 'VALIDATION',
      retryable: false,
    });
    await expect(runFixture('identidad-foto-mala')).rejects.toBeInstanceOf(IdentityDomainError);
  });

  /**
   * Una miniatura de 445×282 SE LEE. Y esta prueba antes afirmaba lo contrario.
   *
   * 445×282 es un caso real: la imagen que devuelve un buscador, o la que deja
   * una aplicación de mensajería. La versión anterior de esta prueba fijaba que
   * se rechazara, con este argumento escrito en el archivo: «a ese tamaño el
   * número de la cédula mide unos cinco píxeles de alto, así que rechazarla es
   * lo correcto —no hay lectura posible—».
   *
   * Nadie lo había medido. Cuando se midió (`scripts/medir-resolucion-identidad.ts`),
   * la misma cédula a 450×289 con el gate apagado devolvió el número, el nombre
   * completo y la caducidad, y terminó VERIFICADA con parecido 0,8971. El
   * «cinco píxeles» ignoraba que `normalize` amplía a 1800 px de lado largo
   * antes de leer. O sea: la prueba no comprobaba un límite del motor,
   * comprobaba una creencia — y mientras estuvo verde, impidió arreglarlo.
   *
   * Por eso ahora afirma lo que se midió, y lo afirma FUERTE: no basta con que
   * no reviente, tiene que leer los campos. Una prueba que sólo comprobara
   * «no lanza» pasaría igual con un pipeline que devuelve el veredicto vacío.
   */
  it('una miniatura de 445 px de ancho se LEE: no se rechaza por tamaño', async () => {
    const fixture = findIdentityFixture('identidad-aprobada')!;
    const images = await buildIdentityFixtureImages(fixture);
    // Se baja por ANCHO y se deja que el alto salga solo, que es lo que hace una
    // miniatura de verdad. Con `resize(445, 282)` sharp recorta para cuadrar la
    // proporción (`fit` es `cover` por omisión) y se lleva por delante parte de
    // la MRZ del reverso: la prueba mediría entonces el recorte, no el tamaño.
    const miniatura = await sharp(images.document).resize({ width: 445 }).png().toBuffer();
    // Las DOS caras, como las manda quien fotografía su cédula: el número vive
    // en la MRZ del reverso, así que con el anverso solo se comprobaría menos de
    // lo que el caso reportado tenía delante.
    const reverso = await sharp(images.documentBack!).resize({ width: 450 }).png().toBuffer();

    const outcome = await buildPipeline().run({
      documentImage: miniatura,
      documentBackImage: reverso,
      selfieImage: images.selfie,
      documentCountry: 'BO',
      correlationId: 'prueba-miniatura',
      entradaGenerada: true,
    });

    expect(outcome.documentType).toBe('BOLIVIA_CI');
    expect(outcome.fields.fullName?.value).toBe('MARIA RENEE RODRIGUEZ GONZALEZ');
    expect(outcome.fields.documentNumber?.value).toBeTruthy();
    // Y la biometría llega a comparar, que es la etapa que el rechazo cortaba.
    expect(outcome.faceMatch?.comparable).toBe(true);
    // La medida NO desaparece: sigue viajando como aviso. La diferencia es que
    // ahora informa el veredicto en vez de sustituirlo.
    expect(outcome.quality.document.warnings).toContain('LOW_RESOLUTION');
  });

  /**
   * El suelo que sí queda, y que ahora dice la verdad sobre por qué.
   *
   * A 200×128 la lectura devuelve ruido y el clasificador no reconoce nada:
   * medido, es el escalón donde deja de salir cualquier campo. Ahí el rechazo es
   * correcto — y lleva código PROPIO (`IDENTITY_DOCUMENT_TOO_SMALL`), porque
   * contestarle «no tiene calidad suficiente» a quien mandó una imagen pequeña
   * pero nítida lo manda a arreglar lo que no estaba roto.
   */
  it('por debajo del suelo medido se rechaza, y el código dice que es el tamaño', async () => {
    const fixture = findIdentityFixture('identidad-aprobada')!;
    const images = await buildIdentityFixtureImages(fixture);
    const diminuta = await sharp(images.document).resize(200, 128).png().toBuffer();

    const fallo = await buildPipeline()
      .run({
        documentImage: diminuta,
        documentBackImage: null,
        selfieImage: images.selfie,
        documentCountry: 'BO',
        correlationId: 'prueba-diminuta',
        entradaGenerada: true,
      })
      .catch((error: unknown) => error as IdentityDomainError);

    expect(fallo).toBeInstanceOf(IdentityDomainError);
    const error = fallo as IdentityDomainError;
    expect(error.code).toBe('IDENTITY_DOCUMENT_TOO_SMALL');
    expect(error.category).toBe('VALIDATION');
    expect(error.message).toMatch(/demasiado pequeña/i);
    expect(error.message).not.toMatch(/más luz/i);
  });

  /**
   * Una selfie de 480×480 —una webcam corriente— se compara.
   *
   * Era un rechazo: `IDENTITY_SELFIE_INVALID`, por puntaje. Medido, esa misma
   * imagen compara a 0,9282, y a 96×96 todavía compara a 0,9040. La puerta
   * estaba unas cinco veces por encima de donde la biometría deja de funcionar,
   * y no la abría ninguna evidencia — la abría una fórmula.
   */
  it('una selfie de 480×480 no se rechaza: se compara', async () => {
    const fixture = findIdentityFixture('identidad-aprobada')!;
    const images = await buildIdentityFixtureImages(fixture);
    const pequena = await sharp(images.selfie).resize(480, 480).png().toBuffer();

    const outcome = await buildPipeline().run({
      documentImage: images.document,
      documentBackImage: images.documentBack,
      selfieImage: pequena,
      documentCountry: 'BO',
      correlationId: 'prueba-selfie-pequena',
      entradaGenerada: true,
    });

    expect(outcome.faceMatch?.comparable).toBe(true);
    expect(outcome.decision).toBe(IdentityDecision.VERIFIED);
  });

  it('sin umbrales calibrados TODO va a revisión, y lo dice', async () => {
    /*
     * Es el valor seguro del paquete original y la razón de que los umbrales no
     * tengan defecto: sin una calibración que alguien haya firmado, el motor no
     * afirma nada sobre la identidad de nadie. Esta prueba fija que la
     * integración no lo ablandó por comodidad de la demo.
     */
    const outcome = await runFixture(
      'identidad-aprobada',
      buildPipeline({ ...IDENTITY_DEFAULTS, thresholdProfileVersion: 'unconfigured' }),
    );
    expect(outcome.decision).toBe(IdentityDecision.REVIEW_REQUIRED);
    expect(outcome.reasonCodes).toContain('THRESHOLD_PROFILE_MISSING');
    expect(outcome.thresholdProfileVersion).toBe('unconfigured');
  });

  it('publica los proveedores que decidieron, no sólo el veredicto', async () => {
    const outcome = await runFixture('identidad-aprobada');
    /*
     * Los TRES proveedores son reales y locales, y el resultado los nombra: un
     * veredicto que no dice con qué se decidió no se puede auditar después.
     * Cuando aquí ponía «face: mock», esa línea era justamente lo que impedía
     * leer «VERIFICADO» como una comparación biométrica de verdad.
     */
    expect(outcome.providers.ocr).toBe('tesseract');
    expect(outcome.providers.face).toBe('human');
    /*
     * Y la ejecución LLEVA la marca de que su entrada la fabricó el motor. Sin
     * ella, un «VERIFICADO» de escenario se leería igual que uno de una persona
     * ante la cámara, que es precisamente lo que no debe pasar.
     */
    expect(outcome.providers.liveness).toBe('entrada-generada');
    expect(outcome.liveness.outcome).toBe('NOT_RUN');
    expect(outcome.riskFlags).toContain('GENERATED_INPUT_NO_LIVENESS');
  });

  it('con una entrada NO generada, la prueba de vida corre de verdad', async () => {
    /*
     * La otra mitad, y la que impide que «entrada generada» se convierta en un
     * atajo permanente: con las mismas imágenes pero sin declararlas fabricadas
     * —que es el camino de un archivo subido— la prueba de vida se ejecuta,
     * nombra a su proveedor y devuelve una cifra.
     *
     * Que sobre un dibujo salga NO CONCLUYENTE en vez de superada no es un
     * fallo: es el antispoof haciendo su trabajo. Lo que se afirma aquí es que
     * MIRÓ.
     */
    const fixture = findIdentityFixture('identidad-aprobada')!;
    const images = await buildIdentityFixtureImages(fixture);
    const outcome = await buildPipeline().run({
      documentImage: images.document,
      documentBackImage: images.documentBack,
      selfieImage: images.selfie,
      documentCountry: 'BO',
      correlationId: 'prueba',
    });

    expect(outcome.providers.liveness).toBe('human');
    expect(outcome.liveness.outcome).not.toBe('NOT_RUN');
    expect(typeof outcome.liveness.score).toBe('number');
    expect(outcome.riskFlags).not.toContain('GENERATED_INPUT_NO_LIVENESS');
  });

  it('avanza el progreso por etapas, en orden y sin retroceder', async () => {
    const fixture = findIdentityFixture('identidad-aprobada')!;
    const images = await buildIdentityFixtureImages(fixture);
    const progreso: number[] = [];
    await buildPipeline().run({
      documentImage: images.document,
      selfieImage: images.selfie,
      documentCountry: 'BO',
      correlationId: 'prueba',
      onProgress: async (value) => {
        progreso.push(value);
      },
    });
    expect(progreso.length).toBeGreaterThanOrEqual(5);
    expect([...progreso].sort((a, b) => a - b)).toEqual(progreso);
    expect(Math.max(...progreso)).toBeLessThanOrEqual(100);
  });
});
