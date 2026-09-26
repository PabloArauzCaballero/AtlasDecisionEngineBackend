/**
 * El carnet tomado con el ESCÁNER DEL SISTEMA (VisionKit en iPhone, ML Kit en
 * Android) en vez de con la cámara de la app.
 *
 * Qué se afirma, y en este orden de importancia:
 *
 * 1. **Sin origen, o con `camera`, nada cambia.** El resultado entero sale igual
 *    que hoy, campo por campo. Es la condición para poder desplegar el Motor
 *    antes que la app: una app vieja no manda el origen.
 * 2. **Con `system_scanner` el caso sale marcado como población no medida**
 *    (`THRESHOLD_PROFILE_UNMEASURED` + `DOCUMENT_CAPTURE_SYSTEM_SCANNER`) y el
 *    recorte del fondo corre IGUAL que por la cámara, para medir una sola
 *    diferencia entre las dos poblaciones. El origen es el del ANVERSO.
 * 3. **`DOCUMENT_GRAYSCALE` nunca aprueba ni rechaza**: un VERIFICADO sigue
 *    VERIFICADO, y un `FACE_NO_MATCH` sobre un anverso sin color pasa a una
 *    persona en vez de rechazar. Todo lo demás —parecido, campos, calidades,
 *    fraude— es idéntico por la cámara y por el escáner sobre la misma imagen.
 * 4. **El origen llega por el `context` de la ejecución** hasta el pipeline, sin
 *    tocar las variables del artefacto `IDENTIDAD_CARNET_MOVIL`, y sus marcas
 *    salen en los `warnings` del nodo, que es lo que llega a la traza.
 *
 * Las imágenes son las cédulas DIBUJADAS de `fixtures/identity-card.ts`: ningún
 * dato ni foto de una persona real. La medición contra cédulas reales escaneadas
 * (fase 5 del plan) no se puede hacer aquí y no se finge: estas pruebas fijan el
 * cableado y la ausencia de regresiones, no la calidad de lectura del escáner.
 */
import sharp from 'sharp';
import { ConfigService } from '@nestjs/config';
import { HeuristicDocumentClassifierAdapter } from '../src/modules/workers/identity-verification/core/adapters/local-providers.adapter';
import { HumanIdentityArbitrationAdapter } from '../src/modules/workers/identity-verification/core/adapters/identity-arbitration.adapter';
import {
  HumanFaceDetectorAdapter,
  HumanFaceMatchAdapter,
  HumanLivenessAdapter,
} from '../src/modules/workers/identity-verification/core/adapters/human-face.adapter';
import { TesseractOcrAdapter } from '../src/modules/workers/identity-verification/core/adapters/tesseract-ocr.adapter';
import { SharpImageAdapter } from '../src/modules/workers/identity-verification/core/adapters/sharp-image.adapter';
import {
  IdentityDecision,
  IdentityDocumentType,
} from '../src/modules/workers/identity-verification/core/domain/identity-enums';
import * as documentColor from '../src/modules/workers/identity-verification/core/forensics/document-color';
import { medirColorDelDocumento } from '../src/modules/workers/identity-verification/core/forensics/document-color';
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
  DOCUMENT_CAPTURE_SOURCES_MEASURED,
  documentCaptureSourceFromContext,
  parseDocumentCaptureSource,
  type DocumentCaptureSource,
} from '../src/modules/workers/identity-verification/document-capture-source';
import {
  buildIdentityFixtureImages,
  findIdentityFixture,
} from '../src/modules/workers/identity-verification/fixtures/identity-fixtures';
import { IdentityPipelineService } from '../src/modules/workers/identity-verification/identity-pipeline.service';
import type { IdentityVerificationOutcome } from '../src/modules/workers/identity-verification/identity-result';
import { WorkerServiceInvokerService } from '../src/modules/workers/worker-service-invoker.service';
import type { SemanticAnalysisPipeline } from '../src/modules/workers/semantic-analysis/core/application/semantic-analysis.pipeline';
import type { AudioTtsRuntimeFactory } from '../src/modules/workers/audio-tts/audio-tts.runtime';
import type { InstitutionCatalogService } from '../src/modules/workers/bank-statement/institutions/institution-catalog.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';

// El pipeline entero corre de verdad: Tesseract y Human sobre WebAssembly.
jest.setTimeout(240_000);

/** Los mismos umbrales medidos que usa `identity-verification-pipeline.spec.ts`. */
const OPTIONS: IdentityOptions = {
  ...IDENTITY_DEFAULTS,
  matchThreshold: 0.8824,
  reviewThreshold: 0.7789,
  thresholdProfileVersion: 'sintetico-60x3-fmr1e-3-fnmr1e-2',
};

/** Las tres marcas que añade el escáner (la de grises, sólo si no hay color). */
const MARCAS_DEL_ESCANER = ['DOCUMENT_CAPTURE_SYSTEM_SCANNER', 'THRESHOLD_PROFILE_UNMEASURED'];

const ocr = new TesseractOcrAdapter();

/**
 * Misma sonda de fuente que la batería del pipeline, y por lo mismo: sin DejaVu
 * fontconfig sustituye en silencio y el OCR lee mal la tarjeta dibujada.
 */
async function faltaLaFuente(): Promise<boolean> {
  const dibujar = (familia: string): Promise<Buffer> =>
    sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="60">` +
          `<text x="4" y="42" font-family="${familia}" font-size="36">MARIA1I</text></svg>`,
      ),
    )
      .png()
      .toBuffer();
  const [pedida, inventada] = await Promise.all([
    dibujar('DejaVu Sans Mono'),
    dibujar('Fuente Que No Existe En Ningun Sistema'),
  ]);
  return pedida.equals(inventada);
}

beforeAll(async () => {
  if (await faltaLaFuente()) {
    throw new Error(
      'Falta la fuente DejaVu: ver el mensaje de identity-verification-pipeline.spec.ts.',
    );
  }
});

afterAll(async () => {
  await ocr.onModuleDestroy();
});

function buildPipeline(options: IdentityOptions = OPTIONS): {
  pipeline: IdentityPipelineService;
  frame: jest.SpyInstance;
} {
  const images = new SharpImageAdapter(options);
  const frame = jest.spyOn(images, 'frame');
  const pipeline = new IdentityPipelineService(
    options,
    images,
    ocr,
    new HeuristicDocumentClassifierAdapter(),
    new HumanFaceDetectorAdapter(options),
    new HumanFaceMatchAdapter(options),
    new HumanLivenessAdapter(options),
    new HumanIdentityArbitrationAdapter(),
    null,
    null,
    new DocumentParserRegistry(
      new BoliviaCiDocumentParser(),
      new PassportDocumentParser(),
      new GenericDocumentParser(),
    ),
    new ImageQualityAssessmentService(options),
  );
  return { pipeline, frame };
}

interface Imagenes {
  readonly document: Buffer;
  readonly documentBack: Buffer | null;
  readonly selfie: Buffer;
}

async function imagenesDe(code: string): Promise<Imagenes> {
  const fixture = findIdentityFixture(code);
  if (!fixture) throw new Error(`escenario inexistente: ${code}`);
  return buildIdentityFixtureImages(fixture);
}

async function verificar(
  imagenes: Imagenes,
  documentCaptureSource?: DocumentCaptureSource,
): Promise<{ outcome: IdentityVerificationOutcome; recortes: number }> {
  const { pipeline, frame } = buildPipeline();
  const outcome = await pipeline.run({
    documentImage: imagenes.document,
    documentBackImage: imagenes.documentBack,
    selfieImage: imagenes.selfie,
    documentCountry: 'BO',
    correlationId: 'prueba-escaner',
    // Como en el resto de escenarios: la prueba de vida no se mide sobre un dibujo.
    entradaGenerada: true,
    ...(documentCaptureSource ? { documentCaptureSource } : {}),
  });
  return { outcome, recortes: frame.mock.calls.length };
}

/**
 * Redondea todos los números a 6 decimales.
 *
 * Dos corridas del MISMO pipeline sobre la MISMA imagen no dan los mismos bits
 * en las calidades: el último dígito (~1e-14) baila entre corridas. No se buscó
 * la causa exacta; lo probable es un cálculo en coma flotante repartido entre
 * hilos (libvips, WebAssembly), donde el orden de la suma cambia el redondeo. Medido aquí: una corrida sin origen y
 * otra con `camera` —que recorren el mismo código— dieron `quality.selfie.score`
 * 0,7674371732600094 contra …102, y la selfie no la toca el origen en nada. Ningún
 * umbral del worker tiene más de 4 decimales, así que a 6 lo que queda es todo
 * lo que puede decidir.
 */
function redondear<T>(valor: T): T {
  return JSON.parse(
    JSON.stringify(valor, (_clave, v: unknown) =>
      typeof v === 'number' ? Number(v.toFixed(6)) : v,
    ),
  ) as T;
}

/**
 * Lo que MIDE el worker, sin el veredicto: lo que tiene que salir idéntico entre
 * la cámara y el escáner sobre la misma imagen, incluido el encuadre (el recorte
 * corre igual por los dos orígenes).
 */
function loQueMide(outcome: IdentityVerificationOutcome) {
  return redondear({
    framing: outcome.framing,
    documentType: outcome.documentType,
    documentEvidence: outcome.documentEvidence,
    fields: outcome.fields,
    faceMatch: outcome.faceMatch,
    liveness: outcome.liveness,
    quality: outcome.quality,
    fraudVerdict: outcome.fraud?.veredicto ?? null,
    fraudRisk: outcome.fraud?.riesgo ?? null,
  });
}

/** Lo que DECIDE: lo que mide más el veredicto y sus motivos. */
function loQueDecide(outcome: IdentityVerificationOutcome) {
  return {
    ...loQueMide(outcome),
    decision: outcome.decision,
    reasonCodes: outcome.reasonCodes,
    calibratedFaceDecision: outcome.calibratedFaceDecision,
  };
}

/** La cédula en color pasada al gris como la deja el filtro de iOS: JPEG de 3 canales. */
async function enGrises(imagen: Buffer): Promise<Buffer> {
  return sharp(imagen).greyscale().toColourspace('srgb').jpeg({ quality: 92 }).toBuffer();
}

/**
 * La tarjeta como la entrega un escáner del sistema: YA recortada.
 *
 * Se obtiene con el mismo detector del worker sobre la cédula dibujada, que
 * trae margen alrededor: lo que sale es sólo la tarjeta. Así la cámara y el
 * escáner pueden compararse sobre los MISMOS píxeles —la cámara ya no encuentra
 * nada que recortar— y cualquier diferencia en lo que decide sería culpa del
 * origen, no de la imagen.
 */
async function yaRecortada(imagenes: Imagenes): Promise<Imagenes> {
  const images = new SharpImageAdapter(OPTIONS);
  const normalizada = await images.normalize(imagenes.document);
  const encuadre = await images.frame(normalizada.buffer);
  if (!encuadre.recortado) throw new Error('la cédula dibujada debería traer margen que recortar');
  return { ...imagenes, document: encuadre.buffer };
}

describe('origen de la captura del documento', () => {
  it('sólo acepta los dos valores del contrato', () => {
    expect(parseDocumentCaptureSource('camera')).toBe('camera');
    expect(parseDocumentCaptureSource('system_scanner')).toBe('system_scanner');
    // Un valor desconocido no rechaza la ejecución: se ignora y se decide como
    // con la cámara, que es la población calibrada.
    for (const valor of ['SYSTEM_SCANNER', 'gallery', '', null, undefined, 1, {}]) {
      expect(parseDocumentCaptureSource(valor)).toBeNull();
    }
  });

  it('se lee del `context` de la ejecución, en `documentCaptureSource`', () => {
    expect(
      documentCaptureSourceFromContext({
        channel: 'MOBILE_APP',
        verificationId: 'v-1',
        behaviorSummaryId: null,
        documentCaptureSource: 'system_scanner',
      }),
    ).toBe('system_scanner');
    expect(documentCaptureSourceFromContext({ channel: 'MOBILE_APP' })).toBeNull();
    expect(documentCaptureSourceFromContext(null)).toBeNull();
    expect(documentCaptureSourceFromContext(undefined)).toBeNull();
  });

  it('sólo la cámara cuenta hoy como población medida', () => {
    // Cambiar esto es una afirmación sobre un corpus (fase 5 del plan), no un ajuste.
    expect([...DOCUMENT_CAPTURE_SOURCES_MEASURED]).toEqual(['camera']);
  });
});

describe('color del anverso', () => {
  it('distingue la cédula en color de la misma cédula en grises y en blanco y negro', async () => {
    const { document } = await imagenesDe('identidad-aprobada');

    const color = await medirColorDelDocumento(document);
    expect(color?.sinColor).toBe(false);
    // Medido: 0,1027 de la tarjeta dibujada tiene color claro (retrato, rótulos).
    expect(color?.fraccionConColor).toBeGreaterThan(0.05);

    // El filtro «Escala de grises» de iOS: JPEG de tres canales iguales.
    expect(await medirColorDelDocumento(await enGrises(document))).toEqual({
      sinColor: true,
      fraccionConColor: 0,
    });
    // Un JPEG gris de UN canal.
    const unCanal = await sharp(document).greyscale().jpeg().toBuffer();
    expect((await medirColorDelDocumento(unCanal))?.sinColor).toBe(true);
    // El filtro «Blanco y negro».
    const bn = await sharp(document).greyscale().threshold(150).jpeg().toBuffer();
    expect((await medirColorDelDocumento(bn))?.sinColor).toBe(true);
  });

  it('una cédula sin retrato sigue contando como en color', async () => {
    // El retrato es la mayor mancha de color; sin él quedan los rótulos verdes y
    // azules, y eso tiene que bastar para no marcarla como gris.
    const { document } = await imagenesDe('identidad-sin-retrato');
    expect((await medirColorDelDocumento(document))?.sinColor).toBe(false);
  });

  it('no puede tumbar nada: lo que no es una imagen devuelve `null`', async () => {
    expect(await medirColorDelDocumento(Buffer.from('no es una imagen'))).toBeNull();
  });
});

describe('pipeline con el origen de la captura', () => {
  let original: Imagenes;
  let sinOrigen: { outcome: IdentityVerificationOutcome; recortes: number };

  beforeAll(async () => {
    original = await imagenesDe('identidad-aprobada');
    sinOrigen = await verificar(original);
  });

  it('con `camera` el resultado es el MISMO que sin origen, campo por campo', async () => {
    const { outcome, recortes } = await verificar(original, 'camera');

    // Todo el desenlace, no sólo lo que decide: marcas, encuadre, campos.
    expect(redondear(outcome)).toEqual(redondear(sinOrigen.outcome));
    expect(outcome.riskFlags).toEqual(sinOrigen.outcome.riskFlags);
    expect(outcome.capture).toBeUndefined();
    expect('capture' in outcome).toBe(false);
    expect(outcome.riskFlags).not.toContain('DOCUMENT_CAPTURE_SYSTEM_SCANNER');
    expect(outcome.riskFlags).not.toContain('DOCUMENT_GRAYSCALE');
    // Y el recorte de fondo sigue corriendo como siempre, y recortando.
    expect(recortes).toBe(sinOrigen.recortes);
    expect(recortes).toBeGreaterThan(0);
    expect(outcome.framing).toEqual(sinOrigen.outcome.framing);
    expect(outcome.framing.recortado).toBe(true);
  });

  it('sin origen, la cédula en grises no lleva la marca: la cámara no mide el color', async () => {
    const gris = { ...original, document: await enGrises(original.document) };
    const { outcome } = await verificar(gris);
    expect(outcome.riskFlags).not.toContain('DOCUMENT_GRAYSCALE');
    expect(outcome.capture).toBeUndefined();
  });

  it('con `system_scanner` sobre la tarjeta YA recortada: la guarda no recorta y decide lo mismo', async () => {
    const recortada = await yaRecortada(original);

    const porCamara = await verificar(recortada, 'camera');
    // La premisa: sobre la tarjeta recortada la cámara tampoco recorta nada, así
    // que las dos corridas leen exactamente los mismos píxeles.
    expect(porCamara.outcome.framing.recortado).toBe(false);

    const porEscaner = await verificar(recortada, 'system_scanner');
    // El detector corre también por el escáner, y su guarda («si ya llena el
    // encuadre, no recortes») deja la tarjeta como llegó.
    expect(porEscaner.recortes).toBe(porCamara.recortes);
    expect(porEscaner.recortes).toBeGreaterThan(0);
    expect(porEscaner.outcome.framing).toEqual(porCamara.outcome.framing);
    expect(porEscaner.outcome.framing.recortado).toBe(false);
    expect(porEscaner.outcome.capture).toEqual({
      source: 'system_scanner',
      color: { sinColor: false, fraccionConColor: expect.any(Number) },
    });
    expect(porEscaner.outcome.riskFlags).toEqual(expect.arrayContaining(MARCAS_DEL_ESCANER));
    expect(porEscaner.outcome.riskFlags).not.toContain('DOCUMENT_GRAYSCALE');

    expect(loQueDecide(porEscaner.outcome)).toEqual(loQueDecide(porCamara.outcome));
    expect(porEscaner.outcome.decision).toBe(IdentityDecision.VERIFIED);
    // Y la foto de cámara con margen, la de siempre, también verificaba.
    expect(sinOrigen.outcome.decision).toBe(IdentityDecision.VERIFIED);
  });

  /*
   * Lo que hace `DOCUMENT_GRAYSCALE`, en dos partes.
   *
   * Primero, el anverso en grises. Sobre las cédulas dibujadas, pasar el anverso
   * a grises baja el parecido con la selfie en color (medido: 0,95 → 0,72 en
   * `identidad-aprobada`) y por la cámara los tres escenarios acaban en
   * NOT_VERIFIED con `FACE_NO_MATCH`, también el de la persona correcta. Por el
   * escáner, que SÍ mide el color, ese rechazo lo firma una persona: sale
   * REVIEW_REQUIRED con `DOCUMENT_GRAYSCALE` entre los motivos. Todo lo que el
   * worker mide —parecido, campos, calidades, fraude, encuadre— es idéntico.
   *
   * El precio, declarado: el escenario `identidad-rechazada` (otra persona)
   * también va a revisión en vez de rechazo. Un parecido bajo nunca se aprueba;
   * lo que cambia es quién dice «no» mientras el filtro gris no esté medido.
   */
  it.each([['identidad-aprobada'], ['identidad-revision'], ['identidad-rechazada']])(
    'sobre %s en grises, el rechazo por parecido del escáner va a una persona',
    async (code) => {
      const recortada = await yaRecortada(await imagenesDe(code));
      const gris: Imagenes = {
        ...recortada,
        document: await enGrises(recortada.document),
        documentBack: recortada.documentBack ? await enGrises(recortada.documentBack) : null,
      };

      const porCamara = await verificar(gris, 'camera');
      const porEscaner = await verificar(gris, 'system_scanner');
      expect(porCamara.outcome.framing.recortado).toBe(false);

      expect(porEscaner.outcome.riskFlags).toContain('DOCUMENT_GRAYSCALE');
      expect(porEscaner.outcome.capture?.color).toEqual({ sinColor: true, fraccionConColor: 0 });
      // La cámara no mide el color: su camino no cambia ni en eso.
      expect(porCamara.outcome.riskFlags).not.toContain('DOCUMENT_GRAYSCALE');
      expect(porCamara.outcome.capture).toBeUndefined();

      // Todo lo que mide, idéntico.
      expect(loQueMide(porEscaner.outcome)).toEqual(loQueMide(porCamara.outcome));
      // Por la cámara, el rechazo por parecido de siempre.
      expect(porCamara.outcome.decision).toBe(IdentityDecision.NOT_VERIFIED);
      expect(porCamara.outcome.reasonCodes).toContain('FACE_NO_MATCH');
      // Por el escáner, a una persona, con el mismo motivo y el de los grises.
      expect(porEscaner.outcome.decision).toBe(IdentityDecision.REVIEW_REQUIRED);
      expect(porEscaner.outcome.calibratedFaceDecision).toBe('REVIEW');
      expect(porEscaner.outcome.reasonCodes).toEqual([
        ...porCamara.outcome.reasonCodes,
        'DOCUMENT_GRAYSCALE',
      ]);

      // Y la única diferencia en las marcas son las del escáner.
      const añadidas = porEscaner.outcome.riskFlags.filter(
        (marca) => !porCamara.outcome.riskFlags.includes(marca),
      );
      const quitadas = porCamara.outcome.riskFlags.filter(
        (marca) => !porEscaner.outcome.riskFlags.includes(marca),
      );
      expect(quitadas).toEqual([]);
      // THRESHOLD_PROFILE_UNMEASURED ya estaba (el perfil de la prueba es
      // sintético), así que no aparece como añadida.
      expect(añadidas.sort()).toEqual(['DOCUMENT_CAPTURE_SYSTEM_SCANNER', 'DOCUMENT_GRAYSCALE']);
    },
  );

  /*
   * Segundo, la marca SOLA sobre un VERIFICADO. En grises no hay ningún
   * escenario dibujado que verifique (ver arriba), así que se aísla la marca:
   * la misma tarjeta en color, por el escáner, con la medida del color forzada
   * a «sin color». Es la única diferencia entre las dos corridas; si la marca
   * pesara en algo, aquí escalaría el VERIFICADO.
   */
  it('la marca sola no escala un VERIFICADO', async () => {
    const recortada = await yaRecortada(original);
    const normal = await verificar(recortada, 'system_scanner');

    const forzada = jest
      .spyOn(documentColor, 'medirColorDelDocumento')
      .mockResolvedValue({ sinColor: true, fraccionConColor: 0 });
    let conMarca: Awaited<ReturnType<typeof verificar>>;
    let medidas: number;
    try {
      conMarca = await verificar(recortada, 'system_scanner');
      // Antes de restaurar: `mockRestore` borra también las llamadas anotadas.
      medidas = forzada.mock.calls.length;
    } finally {
      forzada.mockRestore();
    }
    expect(medidas).toBeGreaterThan(0);

    expect(normal.outcome.riskFlags).not.toContain('DOCUMENT_GRAYSCALE');
    expect(conMarca.outcome.riskFlags).toContain('DOCUMENT_GRAYSCALE');
    expect(normal.outcome.decision).toBe(IdentityDecision.VERIFIED);
    expect(loQueDecide(conMarca.outcome)).toEqual(loQueDecide(normal.outcome));
    expect(conMarca.outcome.riskFlags.filter((m) => !normal.outcome.riskFlags.includes(m))).toEqual(
      ['DOCUMENT_GRAYSCALE'],
    );
  });

  it('con un perfil MEDIDO, el escáner sigue marcando la población como no medida', async () => {
    // Con el perfil sintético la marca ya salía; aquí se ve que la pone el origen.
    const medido: IdentityOptions = { ...OPTIONS, thresholdProfileVersion: 'medido-prueba-v1' };
    const recortada = await yaRecortada(original);
    const correr = (origen?: DocumentCaptureSource) =>
      buildPipeline(medido).pipeline.run({
        documentImage: recortada.document,
        documentBackImage: recortada.documentBack,
        selfieImage: recortada.selfie,
        documentCountry: 'BO',
        correlationId: 'prueba-escaner',
        entradaGenerada: true,
        ...(origen ? { documentCaptureSource: origen } : {}),
      });

    const porCamara = await correr('camera');
    expect(porCamara.riskFlags).not.toContain('THRESHOLD_PROFILE_UNMEASURED');
    const porEscaner = await correr('system_scanner');
    expect(porEscaner.riskFlags).toContain('THRESHOLD_PROFILE_UNMEASURED');
    expect(porEscaner.riskFlags).toContain('DOCUMENT_CAPTURE_SYSTEM_SCANNER');
    // Informativa también: no escala un VERIFICADO.
    expect(porEscaner.decision).toBe(porCamara.decision);
    expect(porEscaner.decision).toBe(IdentityDecision.VERIFIED);
  });

  it('una foto con fondo marcada `system_scanner` se recorta igual que por la cámara', async () => {
    // El caso mezclado: el origen es UNO para las dos caras y la app lo declara
    // `system_scanner` si cualquiera salió del escáner. Un anverso de la cámara
    // de respaldo —la tarjeta sobre un escritorio— llega marcado así y tiene
    // que recortarse como cualquier foto.
    const escritorio = await imagenesDe('identidad-sobre-escritorio');

    const porCamara = await verificar(escritorio);
    expect(porCamara.recortes).toBeGreaterThan(0);
    expect(porCamara.outcome.framing.recortado).toBe(true);

    const porEscaner = await verificar(escritorio, 'system_scanner');
    expect(porEscaner.recortes).toBe(porCamara.recortes);
    expect(porEscaner.outcome.framing).toEqual(porCamara.outcome.framing);
    expect(loQueDecide(porEscaner.outcome)).toEqual(loQueDecide(porCamara.outcome));
  });

  it('con la población ya MEDIDA, el anverso en grises vuelve a rechazar como la cámara', async () => {
    // Lo que manda a una persona es que el escáner no esté medido, no el escáner.
    // Se simula el día en que la fase 5 lo declare medido.
    const gris = await yaRecortada(original);
    const enGris: Imagenes = { ...gris, document: await enGrises(gris.document) };
    const medidas = DOCUMENT_CAPTURE_SOURCES_MEASURED as Set<DocumentCaptureSource>;
    medidas.add('system_scanner');
    let porEscaner: Awaited<ReturnType<typeof verificar>>;
    try {
      porEscaner = await verificar(enGris, 'system_scanner');
    } finally {
      medidas.delete('system_scanner');
    }
    expect(porEscaner.outcome.riskFlags).toContain('DOCUMENT_GRAYSCALE');
    expect(porEscaner.outcome.decision).toBe(IdentityDecision.NOT_VERIFIED);
    expect(porEscaner.outcome.reasonCodes).toContain('FACE_NO_MATCH');
    expect(porEscaner.outcome.reasonCodes).not.toContain('DOCUMENT_GRAYSCALE');
    expect([...DOCUMENT_CAPTURE_SOURCES_MEASURED]).toEqual(['camera']);
  });

  it('un documento vencido en grises sigue rechazando: sólo se aparta el rechazo por parecido', async () => {
    const caducada = await yaRecortada(await imagenesDe('identidad-caducada'));
    const enGris: Imagenes = { ...caducada, document: await enGrises(caducada.document) };
    const porCamara = await verificar(enGris, 'camera');
    const porEscaner = await verificar(enGris, 'system_scanner');
    expect(porEscaner.outcome.riskFlags).toContain('DOCUMENT_GRAYSCALE');
    // La premisa: por la cámara rechaza por la fecha, antes de comparar rostros.
    expect(porCamara.outcome.decision).toBe(IdentityDecision.NOT_VERIFIED);
    expect(porCamara.outcome.reasonCodes).toEqual(['DOCUMENT_EXPIRED']);
    expect(loQueDecide(porEscaner.outcome)).toEqual(loQueDecide(porCamara.outcome));
  });
});

describe('la definición del artefacto no lee las marcas de riesgo', () => {
  /*
   * La otra mitad de «informativa»: el worker publica `riskFlags` en su
   * resultado, pero `IDENTIDAD_CARNET_MOVIL` sólo proyecta decisión, parecido,
   * evidencia, tipo y vida, y ninguna condición mira las marcas. Si un día una
   * versión del artefacto empieza a leerlas, esta prueba se pone roja y obliga
   * a revisar qué marcas —entre ellas las del escáner— pasan a decidir.
   */
  it('ni las salidas del nodo worker ni las condiciones mencionan `riskFlags`', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const definicion = require('../scripts/lib/identidad-carnet-movil.definicion.json') as {
      nodes: Array<{ type: string; config: { outputs?: Array<{ path: string }> } }>;
      conditions: unknown[];
    };
    const worker = definicion.nodes.find((nodo) => nodo.type === 'WORKER');
    expect(worker?.config.outputs?.map((salida) => salida.path).sort()).toEqual(
      [
        'call.errorCode',
        'call.status',
        'result.decision',
        'result.documentEvidence',
        'result.documentType',
        'result.faceSimilarity',
        'result.liveness',
      ].sort(),
    );
    const texto = JSON.stringify(definicion);
    for (const marca of ['riskFlags', 'DOCUMENT_GRAYSCALE', 'DOCUMENT_CAPTURE_SYSTEM_SCANNER']) {
      expect(texto).not.toContain(marca);
    }
    expect(JSON.stringify(definicion.conditions)).not.toContain('THRESHOLD_PROFILE_UNMEASURED');
  });
});

describe('el origen llega desde el `context` de la ejecución hasta el pipeline', () => {
  const principal: AuthenticatedPrincipal = {
    id: 'test',
    tenantId: 1n,
    roles: [],
    audience: 'runtime',
    requestId: 'test',
    authMethod: 'jwt',
  };

  let png: string;
  beforeAll(async () => {
    png = (
      await sharp({
        create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 40, b: 40 } },
      })
        .png()
        .toBuffer()
    ).toString('base64');
  });

  function invocador(
    context?: Record<string, unknown>,
    cambios: Partial<IdentityVerificationOutcome> = {},
  ) {
    const run = jest.fn().mockResolvedValue({
      decision: IdentityDecision.VERIFIED,
      reasonCodes: [],
      calibratedFaceDecision: 'MATCH',
      thresholdProfileVersion: 'p',
      documentType: IdentityDocumentType.BOLIVIA_CI,
      documentCountry: 'BO',
      classification: { confidence: 1, signals: [] },
      documentEvidence: { confidence: 1, signals: [], contraindicator: null },
      fields: {},
      quality: { document: { score: 1, warnings: [] }, selfie: { score: 1, warnings: [] } },
      liveness: { outcome: 'PASSED', provider: 'x' },
      faceMatch: { similarityScore: 0.95, comparable: true, provider: 'x' },
      framing: { recortado: false, areaConservada: 1 },
      riskFlags: [],
      providers: { ocr: 'x', face: 'x', liveness: 'x' },
      ...cambios,
    } satisfies IdentityVerificationOutcome);
    const service = new WorkerServiceInvokerService(
      new ConfigService({ IDENTITY_VERIFICATION_WORKER_ENABLED: true }),
      {} as SemanticAnalysisPipeline,
      {} as AudioTtsRuntimeFactory,
      {} as InstitutionCatalogService,
      { run } as unknown as IdentityPipelineService,
    );
    return { invoker: service.bind(1n, principal, context), run };
  }

  async function responder(
    context?: Record<string, unknown>,
    cambios: Partial<IdentityVerificationOutcome> = {},
  ) {
    const { invoker, run } = invocador(context, cambios);
    const respuesta = await invoker.invoke({
      service: 'identity-verification',
      operation: 'verify',
      nodeKey: 'VERIFICAR_IDENTIDAD',
      arguments: { documentBase64: png, selfieBase64: png, documentCountry: 'BO' },
    });
    return { respuesta, entrada: run.mock.calls[0][0] as Record<string, unknown> };
  }

  async function llamar(context?: Record<string, unknown>) {
    return (await responder(context)).entrada;
  }

  const DEL_ESCANER: Partial<IdentityVerificationOutcome> = {
    riskFlags: [
      'THRESHOLD_PROFILE_UNMEASURED',
      'DOCUMENT_CAPTURE_SYSTEM_SCANNER',
      'DOCUMENT_GRAYSCALE',
      'MULTIPLE_FACES',
    ],
    capture: { source: 'system_scanner', color: { sinColor: true, fraccionConColor: 0 } },
  };

  it('las marcas del escáner van a los `warnings` del nodo sin cambiar el estado de un VERIFICADO', async () => {
    const { respuesta } = await responder({ documentCaptureSource: 'system_scanner' }, DEL_ESCANER);
    // `IDENTIDAD_CONFIRMADA` exige SUCCEEDED: las marcas no pueden tocarlo.
    expect(respuesta.status).toBe('SUCCEEDED');
    // Sólo las de la población; las demás marcas de riesgo no se copian.
    expect(respuesta.warnings).toEqual([
      'THRESHOLD_PROFILE_UNMEASURED',
      'DOCUMENT_CAPTURE_SYSTEM_SCANNER',
      'DOCUMENT_GRAYSCALE',
    ]);
    // Y el bloque `capture` —origen y fracción de color, nada de la persona— sube al resultado.
    expect(respuesta.result.capture).toEqual({
      source: 'system_scanner',
      color: { sinColor: true, fraccionConColor: 0 },
    });
  });

  it('sobre un veredicto no limpio, las marcas se suman a los motivos sin repetirse', async () => {
    const { respuesta } = await responder(
      { documentCaptureSource: 'system_scanner' },
      {
        ...DEL_ESCANER,
        decision: IdentityDecision.REVIEW_REQUIRED,
        reasonCodes: ['FACE_NO_MATCH', 'DOCUMENT_GRAYSCALE'],
      },
    );
    expect(respuesta.status).toBe('SUCCEEDED_WITH_WARNINGS');
    expect(respuesta.warnings).toEqual([
      'REVIEW_REQUIRED',
      'FACE_NO_MATCH',
      'DOCUMENT_GRAYSCALE',
      'THRESHOLD_PROFILE_UNMEASURED',
      'DOCUMENT_CAPTURE_SYSTEM_SCANNER',
    ]);
  });

  it('por la cámara la respuesta del nodo es la de siempre: sin `warnings` nuevos ni `capture`', async () => {
    // Un perfil sintético pone THRESHOLD_PROFILE_UNMEASURED también por la cámara;
    // eso no se copia a la traza, como hasta ahora.
    const { respuesta } = await responder(
      { documentCaptureSource: 'camera' },
      { riskFlags: ['THRESHOLD_PROFILE_UNMEASURED'] },
    );
    expect(respuesta.status).toBe('SUCCEEDED');
    expect(respuesta.warnings).toEqual([]);
    expect('capture' in respuesta.result).toBe(false);
  });

  it('`system_scanner` en el contexto llega al pipeline', async () => {
    const entrada = await llamar({
      channel: 'MOBILE_APP',
      verificationId: 'v-1',
      documentCaptureSource: 'system_scanner',
    });
    expect(entrada.documentCaptureSource).toBe('system_scanner');
  });

  it('`camera` llega tal cual', async () => {
    expect((await llamar({ documentCaptureSource: 'camera' })).documentCaptureSource).toBe(
      'camera',
    );
  });

  it('sin contexto, sin la clave o con un valor desconocido, el pipeline no recibe origen', async () => {
    for (const context of [
      undefined,
      { channel: 'MOBILE_APP', verificationId: 'v-1', behaviorSummaryId: 's-1' },
      { documentCaptureSource: 'gallery' },
    ]) {
      const entrada = await llamar(context);
      expect('documentCaptureSource' in entrada).toBe(false);
    }
  });
});
