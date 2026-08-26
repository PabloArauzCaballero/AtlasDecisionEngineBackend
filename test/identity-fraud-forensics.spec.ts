/**
 * La detección de fraude documental, probada sin imágenes y sin red.
 *
 * Las tres familias de señales son funciones puras sobre texto y sobre números, y ésa es la razón
 * de que se pueda ejercitar la política entera aquí: lo único que sale al mundo es el codificador,
 * y entra por un puerto que esta batería sustituye por vectores escritos a mano.
 *
 * Lo que se comprueba NO es «el número sale bonito» sino las decisiones que cuestan caro si se
 * equivocan:
 *
 * - que una cédula legítima leída a medias NO se acuse de falsificación (falso positivo: le cierra
 *   el producto a alguien que no hizo nada mal y no puede arreglarlo),
 * - que un documento que se declara a sí mismo una muestra no pueda aprobarse,
 * - que una prueba QUE FALTA no cuente como prueba superada,
 * - y que ninguna familia de señales, sola, pueda firmar una acusación de fraude.
 */

import {
  NUMERO_CEDULA,
  SONDAS_BOLIVIA_CI,
  esNumeroDeCedulaValido,
} from '../src/modules/workers/identity-verification/core/catalog/bolivia-ci.catalog';
import { analizarPlantilla } from '../src/modules/workers/identity-verification/core/forensics/template-conformance';
import {
  UMBRALES_SEMANTICOS_POR_DEFECTO,
  clasificarSemanticamente,
  type AnalisisSemantico,
  type IdentityEmbedderPort,
} from '../src/modules/workers/identity-verification/core/forensics/identity-semantic.classifier';
import {
  UMBRALES_DE_FRAUDE_POR_DEFECTO,
  evaluarFraude,
} from '../src/modules/workers/identity-verification/core/forensics/identity-fraud.scorer';
import type { AnalisisDeManipulacion } from '../src/modules/workers/identity-verification/core/forensics/image-tamper.analyzer';
import type { ExtractedIdentityData } from '../src/modules/workers/identity-verification/core/domain/extracted-identity.types';
import type { MrzTd1 } from '../src/modules/workers/identity-verification/core/parsers/mrz-td1';

const AHORA = new Date('2026-08-26T12:00:00.000Z');

/** El anverso de una cédula vigente, tal como lo devuelve un OCR razonable. */
const ANVERSO = [
  'ESTADO PLURINACIONAL DE BOLIVIA',
  'SERVICIO GENERAL DE IDENTIFICACION PERSONAL',
  'CEDULA DE IDENTIDAD',
  'SERIE 1  SECCION 4',
  'NOMBRES MARIA RENEE',
  'APELLIDOS RODRIGUEZ GONZALEZ',
  'FECHA DE NACIMIENTO 05 DE ABRIL DE 2003',
  'FECHA DE EMISION 12 DE JUNIO DE 2023',
  'FECHA DE EXPIRACION 12 DE JUNIO DE 2028',
  'N 8942507',
].join('\n');

const REVERSO = [
  'LUGAR DE NACIMIENTO SANTA CRUZ',
  'DOMICILIO AV BUSCH 123',
  'PROFESION U OCUPACION ESTUDIANTE',
  'ESTADO CIVIL SOLTERA',
  'GRUPO SANGUINEO O+',
  'NACION O PUEBLO INDIGENA ORIGINARIO CAMPESINO',
  'IDBOL8942507<9<<<<<<<<<<<<<<<<',
  '0304053F2806125BOL<<<<<<<<<<<0',
  'RODRIGUEZ<GONZALEZ<<MARIA<RENEE<<<<',
].join('\n');

const CAMPOS: ExtractedIdentityData = {
  documentNumber: { value: '8942507', confidence: 0.9, source: 'OCR' },
  fullName: { value: 'MARIA RENEE RODRIGUEZ GONZALEZ', confidence: 0.9, source: 'OCR' },
  dateOfBirth: { value: '2003-04-05', confidence: 0.9, source: 'OCR' },
  issueDate: { value: '2023-06-12', confidence: 0.9, source: 'OCR' },
  expirationDate: { value: '2028-06-12', confidence: 0.9, source: 'OCR' },
  placeOfBirth: { value: 'SANTA CRUZ', confidence: 0.8, source: 'OCR' },
};

const MRZ_BUENA: MrzTd1 = {
  documentNumber: '8942507',
  birthDate: '2003-04-05',
  expirationDate: '2028-06-12',
  sex: 'F',
  nationality: 'BOL',
  issuingState: 'BOL',
  lastNames: 'RODRIGUEZ GONZALEZ',
  firstNames: 'MARIA RENEE',
  checks: { documentNumber: true, birthDate: true, expirationDate: true, composite: true },
};

const SIN_MANIPULACION: AnalisisDeManipulacion = {
  disponible: true,
  senales: [],
  medidas: {
    periodicidad: 0.05,
    residuoMaximoRelativo: 1.4,
    bloquesAtipicos: 0,
    variacionDelRuido: 0.6,
    marcoUniforme: 0.1,
  },
};

const SEMANTICA_LIMPIA: AnalisisSemantico = {
  disponible: true,
  conformidad: 0.9,
  mejorPositiva: { id: 'ci-2023-anverso', parecido: 0.93 },
  mejorNegativa: { id: 'no-pasaporte', parecido: 0.86 },
  margen: 0.07,
  contradicho: false,
  modelo: 'prueba',
};

const UMBRALES = UMBRALES_DE_FRAUDE_POR_DEFECTO;

describe('el catálogo del carnet boliviano', () => {
  it('acepta el número que el SEGIP emite, con y sin complemento', () => {
    expect(esNumeroDeCedulaValido('8942507')).toBe(true);
    expect(esNumeroDeCedulaValido('8942507-1A')).toBe(true);
    expect(esNumeroDeCedulaValido('12345')).toBe(true);
  });

  it('rechaza lo que el SEGIP no puede haber impreso', () => {
    // Cero a la izquierda: la firma de un número tecleado en un formulario que lo rellenó a lo ancho.
    expect(esNumeroDeCedulaValido('0894250')).toBe(false);
    // Cuatro dígitos: por debajo de cualquier cédula emitida.
    expect(esNumeroDeCedulaValido('1234')).toBe(false);
    // Nueve: eso ya no es una cédula, es el número de control de impresión.
    expect(esNumeroDeCedulaValido('123456789')).toBe(false);
    expect(esNumeroDeCedulaValido('')).toBe(false);
    expect(esNumeroDeCedulaValido(null)).toBe(false);
  });

  it('el patrón no cambia entre llamadas: no lleva la bandera global', () => {
    // Un `RegExp` con `/g` conserva `lastIndex` entre llamadas y devuelve `false` una de cada dos
    // veces sobre la MISMA entrada. Sobre un número de documento, eso es un rechazo intermitente
    // que nadie puede reproducir.
    expect(NUMERO_CEDULA.global).toBe(false);
    expect(NUMERO_CEDULA.test('8942507')).toBe(true);
    expect(NUMERO_CEDULA.test('8942507')).toBe(true);
  });

  it('tiene sondas positivas Y negativas: sin contraejemplos el codificador no separa nada', () => {
    expect(SONDAS_BOLIVIA_CI.some((sonda) => sonda.positiva)).toBe(true);
    expect(SONDAS_BOLIVIA_CI.some((sonda) => !sonda.positiva)).toBe(true);
  });
});

describe('la conformidad con la plantilla del catálogo', () => {
  it('una cédula completa cubre la plantilla y no deja obligatorios fuera', () => {
    const analisis = analizarPlantilla({
      textoAnverso: ANVERSO,
      textoReverso: REVERSO,
      campos: CAMPOS,
      mrz: MRZ_BUENA,
      ahora: AHORA,
    });

    expect(analisis.mejor.cobertura).toBeGreaterThan(0.8);
    expect(analisis.mejor.obligatoriosAusentes).toEqual([]);
    expect(analisis.incoherencias).toEqual([]);
    expect(analisis.marcasDeFalsificacion).toEqual([]);
  });

  it('sólo con el anverso NO penaliza los anclajes del reverso', () => {
    /*
     * Es el caso legítimo más frecuente: mucha gente fotografía sólo la cara con la foto. Si los
     * anclajes del reverso contaran como ausentes, toda esa población perdería la mitad de la
     * cobertura y acabaría en revisión por no haber hecho una foto que nadie le exigió.
     */
    const soloAnverso = analizarPlantilla({
      textoAnverso: ANVERSO,
      textoReverso: '',
      campos: CAMPOS,
      mrz: null,
      ahora: AHORA,
    });
    expect(soloAnverso.mejor.cobertura).toBeGreaterThan(0.8);
    expect(soloAnverso.mejor.obligatoriosAusentes).toEqual([]);
  });

  it('una cédula anterior a 2023 se mide contra SU generación y no contra la nueva', () => {
    /*
     * El DS 4924 añadió la MRZ en noviembre de 2023. Las cédulas anteriores siguen vigentes hasta
     * caducar, así que exigirles una MRZ las declararía falsas — millones de documentos legítimos.
     */
    const antigua = analizarPlantilla({
      textoAnverso: ANVERSO,
      textoReverso: 'LUGAR DE NACIMIENTO SANTA CRUZ\nDOMICILIO AV BUSCH 123\nESTADO CIVIL SOLTERA',
      campos: CAMPOS,
      mrz: null,
      ahora: AHORA,
    });
    expect(antigua.mejor.generacion).toBe('PRE_2023');
    expect(antigua.mejor.cobertura).toBeGreaterThan(0.8);
  });

  it('delata un anverso y un reverso de tarjetas distintas', () => {
    const analisis = analizarPlantilla({
      textoAnverso: ANVERSO,
      textoReverso: REVERSO,
      campos: CAMPOS,
      // El dígito de control CUADRA y aun así el número no coincide con el anverso: los dos están
      // bien leídos y son distintos.
      mrz: { ...MRZ_BUENA, documentNumber: '1234567' },
      ahora: AHORA,
    });
    expect(analisis.incoherencias.map((fallo) => fallo.codigo)).toContain(
      'MRZ_DOCUMENT_NUMBER_MISMATCH',
    );
  });

  it('NO acusa de manipulación cuando el dígito de control de la MRZ no cuadra', () => {
    /*
     * Una MRZ mal leída es lo normal en una foto con reflejos. Contrastarla con el anverso ahí
     * produciría una acusación de composición contra un documento perfectamente legítimo, que es el
     * falso positivo más caro de todo el módulo.
     */
    const analisis = analizarPlantilla({
      textoAnverso: ANVERSO,
      textoReverso: REVERSO,
      campos: CAMPOS,
      mrz: {
        ...MRZ_BUENA,
        documentNumber: '1234567',
        checks: { ...MRZ_BUENA.checks, documentNumber: false },
      },
      ahora: AHORA,
    });
    expect(analisis.incoherencias.map((fallo) => fallo.codigo)).not.toContain(
      'MRZ_DOCUMENT_NUMBER_MISMATCH',
    );
  });

  it('detecta fechas que ningún documento real puede llevar', () => {
    const analisis = analizarPlantilla({
      textoAnverso: ANVERSO,
      textoReverso: REVERSO,
      campos: {
        ...CAMPOS,
        expirationDate: { value: '1999-01-01', confidence: 0.9, source: 'OCR' },
      },
      mrz: null,
      ahora: AHORA,
    });
    expect(analisis.incoherencias.map((fallo) => fallo.codigo)).toContain('DATE_ORDER_IMPOSSIBLE');
  });

  it('detecta una vigencia inventada', () => {
    const analisis = analizarPlantilla({
      textoAnverso: ANVERSO,
      textoReverso: REVERSO,
      campos: {
        ...CAMPOS,
        expirationDate: { value: '2099-12-31', confidence: 0.9, source: 'OCR' },
      },
      mrz: null,
      ahora: AHORA,
    });
    expect(analisis.incoherencias.map((fallo) => fallo.codigo)).toContain(
      'VALIDITY_SPAN_IMPLAUSIBLE',
    );
  });

  it('reconoce un documento que se declara a sí mismo una muestra', () => {
    const analisis = analizarPlantilla({
      textoAnverso: `${ANVERSO}\nSPECIMEN`,
      textoReverso: REVERSO,
      campos: CAMPOS,
      mrz: MRZ_BUENA,
      ahora: AHORA,
    });
    expect(analisis.marcasDeFalsificacion).toContain('SPECIMEN_WATERMARK');
  });

  it('reconoce la marca de agua de un banco de imágenes', () => {
    const analisis = analizarPlantilla({
      textoAnverso: `${ANVERSO}\nWWW.SHUTTERSTOCK.COM`,
      textoReverso: '',
      campos: CAMPOS,
      mrz: null,
      ahora: AHORA,
    });
    expect(analisis.marcasDeFalsificacion).toContain('STOCK_IMAGE_MARK');
  });
});

describe('el clasificador por transformers', () => {
  /**
   * Un codificador de mentira, pero con vectores de VERDAD.
   *
   * Devuelve vectores unitarios cuyo coseno se controla desde la prueba, que es lo que permite
   * ejercitar el criterio —suelo, margen, contradicción— sin levantar un servidor de embeddings.
   */
  const embedderQueDevuelve = (
    parecidoPositivo: number,
    parecidoNegativo: number,
  ): IdentityEmbedderPort => ({
    model: 'prueba',
    embed: (textos) =>
      Promise.resolve(
        textos.map((texto, indice) => {
          if (indice === 0) return [1, 0];
          const sonda = SONDAS_BOLIVIA_CI[indice - 1];
          const objetivo = sonda?.positiva ? parecidoPositivo : parecidoNegativo;
          // Un vector unitario con ese coseno contra `[1, 0]`.
          return [objetivo, Math.sqrt(Math.max(0, 1 - objetivo * objetivo))];
        }),
      ),
  });

  const texto = `${ANVERSO}\n${REVERSO}`;

  it('sin codificador NO inventa un puntaje neutro: dice que no se pudo medir', async () => {
    const analisis = await clasificarSemanticamente({
      embedder: null,
      texto,
      umbrales: UMBRALES_SEMANTICOS_POR_DEFECTO,
    });
    expect(analisis.disponible).toBe(false);
    expect(analisis.conformidad).toBeNull();
    expect(analisis.indisponibilidad).toBe('EMBEDDER_NOT_CONFIGURED');
  });

  it('un texto claramente de cédula, con margen sobre los contraejemplos, conforma', async () => {
    const analisis = await clasificarSemanticamente({
      embedder: embedderQueDevuelve(0.95, 0.85),
      texto,
      umbrales: UMBRALES_SEMANTICOS_POR_DEFECTO,
    });
    expect(analisis.disponible).toBe(true);
    expect(analisis.contradicho).toBe(false);
    expect(analisis.conformidad).toBeGreaterThan(0.5);
  });

  it('sin MARGEN, un parecido altísimo no vale nada', async () => {
    /*
     * Es el número que hace todo el trabajo del clasificador. Todos los documentos oficiales se
     * parecen entre sí, así que un coseno de 0,95 contra «cédula boliviana» no dice nada si el
     * coseno contra «documento de otro país» es el mismo. La conformidad tiene que colapsar.
     */
    const analisis = await clasificarSemanticamente({
      embedder: embedderQueDevuelve(0.95, 0.95),
      texto,
      umbrales: UMBRALES_SEMANTICOS_POR_DEFECTO,
    });
    expect(analisis.conformidad).toBe(0);
  });

  it('marca CONTRADICHO cuando un contraejemplo le gana a todas las sondas positivas', async () => {
    const analisis = await clasificarSemanticamente({
      embedder: embedderQueDevuelve(0.85, 0.95),
      texto,
      umbrales: UMBRALES_SEMANTICOS_POR_DEFECTO,
    });
    expect(analisis.contradicho).toBe(true);
  });

  it('un fallo del servidor se declara, no se traga', async () => {
    const analisis = await clasificarSemanticamente({
      embedder: {
        model: 'prueba',
        embed: () => Promise.reject(new Error('503 Service Unavailable')),
      },
      texto,
      umbrales: UMBRALES_SEMANTICOS_POR_DEFECTO,
    });
    expect(analisis.disponible).toBe(false);
    expect(analisis.indisponibilidad).toContain('503');
  });
});

describe('el fusor', () => {
  const plantillaLimpia = analizarPlantilla({
    textoAnverso: ANVERSO,
    textoReverso: REVERSO,
    campos: CAMPOS,
    mrz: MRZ_BUENA,
    ahora: AHORA,
  });

  it('un documento que supera las tres pruebas sale limpio', () => {
    const evaluacion = evaluarFraude({
      plantilla: plantillaLimpia,
      semantica: SEMANTICA_LIMPIA,
      manipulacion: SIN_MANIPULACION,
      umbrales: UMBRALES,
    });
    expect(evaluacion.veredicto).toBe('CLEAR');
    expect(evaluacion.riesgo).toBe(0);
  });

  it('una marca de muestra impide la aprobación por sí sola', () => {
    /*
     * «SPECIMEN» impreso en la tarjeta no es una señal que sume con otras: es el propio documento
     * declarando que no es un documento. Cualquier cosa que no sea cerrar el caso sería fingir que
     * queda algo por decidir.
     */
    const evaluacion = evaluarFraude({
      plantilla: analizarPlantilla({
        textoAnverso: `${ANVERSO}\nSPECIMEN`,
        textoReverso: REVERSO,
        campos: CAMPOS,
        mrz: MRZ_BUENA,
        ahora: AHORA,
      }),
      semantica: SEMANTICA_LIMPIA,
      manipulacion: SIN_MANIPULACION,
      umbrales: UMBRALES,
    });
    expect(evaluacion.veredicto).toBe('FRAUD_SUSPECTED');
    expect(evaluacion.motivos).toContain('SPECIMEN_WATERMARK');
  });

  it('en modo estricto, una prueba que FALTA escala el caso', () => {
    const evaluacion = evaluarFraude({
      plantilla: plantillaLimpia,
      semantica: {
        disponible: false,
        conformidad: null,
        mejorPositiva: null,
        mejorNegativa: null,
        margen: null,
        contradicho: false,
        modelo: null,
        indisponibilidad: 'EMBEDDER_NOT_CONFIGURED',
      },
      manipulacion: SIN_MANIPULACION,
      umbrales: { ...UMBRALES, estricto: true },
    });
    expect(evaluacion.veredicto).toBe('REVIEW');
    expect(evaluacion.motivos).toContain('SEMANTIC_CHECK_UNAVAILABLE');
    expect(evaluacion.pruebasAusentes[0]).toContain('SEMANTIC');
  });

  it('sin modo estricto, la misma prueba ausente se anota y no escala', () => {
    /*
     * Es lo que permite recorrer el flujo en desarrollo, donde no siempre hay servidor de
     * embeddings. La ausencia sigue viajando en `pruebasAusentes`, así que no desaparece: lo que
     * cambia es que no manda el caso a una cola humana que en desarrollo no existe.
     */
    const evaluacion = evaluarFraude({
      plantilla: plantillaLimpia,
      semantica: {
        disponible: false,
        conformidad: null,
        mejorPositiva: null,
        mejorNegativa: null,
        margen: null,
        contradicho: false,
        modelo: null,
        indisponibilidad: 'EMBEDDER_NOT_CONFIGURED',
      },
      manipulacion: SIN_MANIPULACION,
      umbrales: { ...UMBRALES, estricto: false },
    });
    expect(evaluacion.veredicto).toBe('CLEAR');
    expect(evaluacion.pruebasAusentes[0]).toContain('SEMANTIC');
  });

  it('la recompresión sola NO manda a nadie a revisión', () => {
    /*
     * Los cortes del análisis de imagen están medidos contra la cédula sintética del repositorio y
     * contra imágenes que no son documentos; NO hay calibración contra fotos reales de cédulas
     * reales. Y la recompresión tiene una explicación inocente frecuentísima: la aplicación de
     * mensajería por la que mucha gente se manda la foto de su propio carnet antes de subirla.
     */
    const evaluacion = evaluarFraude({
      plantilla: plantillaLimpia,
      semantica: SEMANTICA_LIMPIA,
      manipulacion: {
        ...SIN_MANIPULACION,
        senales: [
          { codigo: 'RECOMPRESSION_PATCHWORK', detalle: 'nueve bloques atípicos', peso: 0.25 },
        ],
      },
      umbrales: UMBRALES,
    });
    expect(evaluacion.veredicto).toBe('CLEAR');
    expect(evaluacion.riesgo).toBeLessThan(UMBRALES.riesgoDeRevision);
  });

  it('el muaré sí escala solo, pero sólo hasta revisión y nunca a sospecha', () => {
    /*
     * Es la única señal de píxeles que afirma algo sin explicación inocente frecuente: una tarjeta
     * de plástico no puede producir la rejilla de un panel LCD. Aun así no firma una acusación —eso
     * lo hace una persona— y por eso se queda en REVIEW.
     */
    const evaluacion = evaluarFraude({
      plantilla: plantillaLimpia,
      semantica: SEMANTICA_LIMPIA,
      manipulacion: {
        ...SIN_MANIPULACION,
        senales: [{ codigo: 'SCREEN_REPHOTOGRAPH_SUSPECTED', detalle: 'muaré', peso: 0.35 }],
      },
      umbrales: UMBRALES,
    });
    expect(evaluacion.veredicto).toBe('REVIEW');
    expect(evaluacion.riesgo).toBeLessThan(UMBRALES.riesgoDeSospecha);
  });

  it('dos señales de píxeles distintas SÍ llegan a revisión, y no a sospecha', () => {
    const evaluacion = evaluarFraude({
      plantilla: plantillaLimpia,
      semantica: SEMANTICA_LIMPIA,
      manipulacion: {
        ...SIN_MANIPULACION,
        senales: [
          { codigo: 'SCREEN_REPHOTOGRAPH_SUSPECTED', detalle: 'muaré', peso: 0.35 },
          { codigo: 'UNIFORM_DARK_BORDER', detalle: 'marco negro', peso: 0.2 },
        ],
      },
      umbrales: UMBRALES,
    });
    expect(evaluacion.veredicto).toBe('REVIEW');
  });

  it('una contradicción semántica cruza el umbral alto ella sola', () => {
    const evaluacion = evaluarFraude({
      plantilla: plantillaLimpia,
      semantica: { ...SEMANTICA_LIMPIA, contradicho: true, margen: -0.04, conformidad: 0 },
      manipulacion: SIN_MANIPULACION,
      umbrales: UMBRALES,
    });
    expect(evaluacion.veredicto).toBe('FRAUD_SUSPECTED');
    expect(evaluacion.motivos).toContain('SEMANTIC_CONTRADICTED');
  });

  it('una entrada FABRICADA por el catálogo nunca se marca como fraude', () => {
    /*
     * Los escenarios del catálogo dispararían señales por construcción —una tarjeta que dibujamos
     * no pasó por ningún sensor— y eso convertiría cada prueba en una sospecha, hasta enseñar a
     * quien la lea que el color rojo no significa nada. Se conserva el riesgo y sus motivos, y lo
     * que se topa es el veredicto.
     */
    const evaluacion = evaluarFraude({
      plantilla: analizarPlantilla({
        textoAnverso: `${ANVERSO}\nSPECIMEN`,
        textoReverso: REVERSO,
        campos: CAMPOS,
        mrz: MRZ_BUENA,
        ahora: AHORA,
      }),
      semantica: SEMANTICA_LIMPIA,
      manipulacion: SIN_MANIPULACION,
      entradaGenerada: true,
      umbrales: UMBRALES,
    });
    expect(evaluacion.veredicto).toBe('REVIEW');
    expect(evaluacion.motivos).toContain('SPECIMEN_WATERMARK');
  });

  it('el riesgo se compone y nunca llega a 1: ninguna heurística merece la palabra certeza', () => {
    const evaluacion = evaluarFraude({
      plantilla: analizarPlantilla({
        textoAnverso: 'SPECIMEN LOREM IPSUM',
        textoReverso: '',
        campos: {},
        mrz: null,
        ahora: AHORA,
      }),
      semantica: { ...SEMANTICA_LIMPIA, contradicho: true, conformidad: 0 },
      manipulacion: {
        ...SIN_MANIPULACION,
        senales: [{ codigo: 'SCREEN_REPHOTOGRAPH_SUSPECTED', detalle: 'muaré', peso: 0.35 }],
      },
      umbrales: UMBRALES,
    });
    expect(evaluacion.riesgo).toBeLessThan(1);
    expect(evaluacion.veredicto).toBe('FRAUD_SUSPECTED');
  });
});
