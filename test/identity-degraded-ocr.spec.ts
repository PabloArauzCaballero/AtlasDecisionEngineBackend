/**
 * Lo que el worker de identidad tiene que aguantar de una FOTOGRAFÍA REAL.
 *
 * ## De dónde salen estos textos
 *
 * De medir. Se fotografió una cédula boliviana auténtica del DS 4924 con un
 * móvil, se pasó por el mismo camino que recorre una subida real —normalizar,
 * encuadrar, reducir, Tesseract con el paquete `spa`— a cuatro resoluciones y en
 * las cuatro orientaciones, y se anotó lo que el reconocedor devolvió. Las
 * mutilaciones que aparecen aquí (`CEI 1 DE`, `IDENTI AD`, `PFrCHA DE
 * MACIMIENTO`, `FECHA DI EMIBION`, `<<T<` en la MRZ) son literales de esa
 * medición, no invenciones para que el analizador lo tenga difícil.
 *
 * Hacía falta porque toda la batería anterior corre sobre los ejemplares
 * sintéticos de `fixtures/identity-card.ts`, que están DIBUJADOS con los rótulos
 * del catálogo en una tipografía limpia. Contra ellos el worker acertaba
 * siempre, y contra una cédula real fallaba entera: la rechazaba por «no es un
 * documento de identidad». Una batería que sólo prueba el caso que el código
 * genera no puede detectar eso.
 *
 * ## Por qué los DATOS son inventados y la FORMA no
 *
 * El número, el nombre y las fechas de aquí son sintéticos, con los dígitos de
 * control de la MRZ recalculados para que cuadren. Es la misma regla que declara
 * `bolivia-ci.catalog.ts` y por la misma razón: una cédula de verdad es el dato
 * con el que se suplanta a una persona, y guardar la de alguien «para calibrar»
 * es fabricar exactamente la fuga que este worker existe para prevenir. Lo que
 * se conserva es la DEGRADACIÓN, que es lo que se está probando.
 */

import { IdentityDocumentType } from '../src/modules/workers/identity-verification/core/domain/identity-enums';
import { HeuristicDocumentClassifierAdapter } from '../src/modules/workers/identity-verification/core/adapters/local-providers.adapter';
import {
  contieneAproximado,
  plegarParaCotejo,
} from '../src/modules/workers/identity-verification/core/catalog/approximate-match';
import {
  esCedulaBoliviana,
  reconocerCedulaBoliviana,
} from '../src/modules/workers/identity-verification/core/catalog/bolivia-ci.recognizer';
import { medirEvidenciaDeIdentidad } from '../src/modules/workers/identity-verification/core/engine/identity-evidence';
import { triageIdentityDocument } from '../src/modules/workers/identity-verification/core/engine/identity-triage';
import { parseMrzTd1 } from '../src/modules/workers/identity-verification/core/parsers/mrz-td1';
import { BoliviaCiDocumentParser } from '../src/modules/workers/identity-verification/core/parsers/bolivia-ci-document.parser';

/**
 * El ANVERSO tal como vuelve del reconocedor a 1200 px de lado largo, que es la
 * resolución con la que el pipeline lee cuando ya sabe que hay un documento.
 */
const ANVERSO_DEGRADADO = [
  '¿us ES JE BOLIVIA CEI 1 DE',
  'ITIFICACIÓN PERSONA) IDENTIDAD',
  'CIÓN N* 4521966',
  'SS 31333 22222',
  ': si CMI',
  ': ANA LUCIA',
  'Y LA Priti',
  'Y po ó , QUISPE MAMANI',
  'PFrCHA DE MACIMIENTO',
  'A 14/03/1990',
  ' FECHA DI EMIBION rca DE FAPIRACIÓN',
  '— 12/06/2025 12/06/2030',
].join('\n');

/** Y el REVERSO, con la MRZ como el reconocedor la entrega de verdad. */
const REVERSO_DEGRADADO = [
  '[s] 0 SANTA CRUZ - ANDRES IBAÑEZ - SANTA E',
  'an 4 CRUZ DE LA SIERRA ae je',
  'í ZE DOMICILI A',
  'Es A o vr METIDO C/CUQUISAS NRO 2180 -—',
  '"” ESTUDIANTE ”',
  'ESTADO Civil f',
  'SOLTERO Z',
  // La `T` de la posición 14 es el DÍGITO DE CONTROL del número leído como
  // letra: en OCR-B el 7 sin travesaño es exactamente una T.
  'I<BOL4521966<<T<<<<<<<<<<<<<<<',
  // Y el `4` de delante es un glifo espurio del borde de la tarjeta, que corre
  // el renglón entero una posición.
  '4 9003141F3006128B0L<<<<<<<<<<<4',
  'QUISPE<MAMANI<<ANA<LUCIA<<<<<<',
].join('\n');

/** La misma foto leída boca abajo: 260 caracteres que no son ninguna palabra. */
const ORIENTACION_EQUIVOCADA = [
  'Y',
  '223 Cd',
  'ez AA',
  ': - HE',
  'a ES. ke:',
  'Sin',
  '119',
  '| ( )',
  '-',
  '—eozmovez ozozmonez , ”. Y',
  'MONDO SOON NOA O',
  '1007/2720 7',
  'OMBTIVEVO ZAvIIV -',
  'Ova',
  '8996997 .N Y',
  'avaLLN3di í',
  '30 Y 19 vIANOS —',
].join('\n');

/** Una licencia de conducir boliviana: misma cabecera, mismos rótulos, otro documento. */
const LICENCIA = [
  'ESTADO PLURINACIONAL DE BOLIVIA',
  'LICENCIA PARA CONDUCIR',
  'CATEGORIA B',
  'NOMBRES ANA LUCIA',
  'APELLIDOS QUISPE MAMANI',
  'FECHA DE NACIMIENTO 14/03/1990',
  'FECHA DE EXPIRACION 12/06/2030',
  'DIRECCION GENERAL DEPARTAMENTAL DE TRANSITO',
].join('\n');

describe('cotejo aproximado de rótulos', () => {
  it('reconoce un rótulo al que el OCR se comió caracteres', () => {
    const texto = plegarParaCotejo('ITIFICACIÓN PERSONA) IDENTIDAD');
    expect(contieneAproximado(texto, 'IDENTIFICACION PERSONAL')).toBe(true);
    expect(contieneAproximado(texto, 'IDENTIDAD')).toBe(true);
  });

  it('tolera una edición por cada cinco caracteres, y ni una más', () => {
    // `DOMICILIO` son nueve: una edición.
    expect(contieneAproximado(plegarParaCotejo('ZE DOMICILI A'), 'DOMICILIO')).toBe(true);
    expect(contieneAproximado(plegarParaCotejo('DOMPCPLPO'), 'DOMICILIO')).toBe(false);
  });

  /*
   * La regla que impide que el catálogo se dispare con cualquier tarjeta
   * oficial. Sin ella, `SECCION` casaba dentro de `DIRECCIÓN DEPARTAMENTAL` a
   * distancia 1 y una licencia de conducir puntuaba más que la cédula real.
   */
  it('no cotea con tolerancia un rótulo de menos de ocho caracteres', () => {
    // Ni siquiera cuando está literalmente ahí: por debajo de ocho, el cotejo
    // aproximado se inhibe entero y el rótulo queda en manos de su expresión
    // regular exacta, que es la comprobación apropiada para una palabra corta.
    expect(contieneAproximado(plegarParaCotejo('DIRECCION DEPARTAMENTAL'), 'SECCION')).toBe(false);
    expect(contieneAproximado(plegarParaCotejo('SECCION 22222'), 'SECCION')).toBe(false);
  });

  it('el rótulo corto lo sigue encontrando el catálogo por su patrón exacto', () => {
    const conSeccion = reconocerCedulaBoliviana({
      textoAnverso: 'CEDULA DE IDENTIDAD SERIE 31333 SECCION 22222',
      textoReverso: '',
    });
    expect(conSeccion.mejor.anclajesEncontrados).toEqual(
      expect.arrayContaining(['campo-serie', 'campo-seccion']),
    );
  });
});

describe('el catálogo sobre una lectura degradada', () => {
  it('reconoce la cédula y nombra su generación', () => {
    const reconocido = reconocerCedulaBoliviana({
      textoAnverso: ANVERSO_DEGRADADO,
      textoReverso: REVERSO_DEGRADADO,
    });
    expect(esCedulaBoliviana(reconocido)).toBe(true);
    expect(reconocido.mejor.generacion).toBe('DS_4924_2023');
    expect(reconocido.mejor.cobertura).toBeGreaterThan(0.4);
  });

  /*
   * El invariante que sostiene la búsqueda de orientación. No hace falta que la
   * orientación correcta cruce ningún umbral —a 600 px no lo cruza—: hace falta
   * que las equivocadas den CERO, para que comparar las cuatro elija siempre la
   * buena.
   */
  it('no reconoce nada en la misma foto leída al revés', () => {
    const reconocido = reconocerCedulaBoliviana({
      textoAnverso: ORIENTACION_EQUIVOCADA,
      textoReverso: '',
    });
    expect(reconocido.mejor.cobertura).toBe(0);
    expect(esCedulaBoliviana(reconocido)).toBe(false);
  });

  it('no da una licencia de conducir por cédula, aunque se le parezca', () => {
    const reconocido = reconocerCedulaBoliviana({ textoAnverso: LICENCIA, textoReverso: '' });
    // Cobertura alta —comparte cabecera, rótulos y fechas— y aun así no es una
    // cédula: le falta cualquier anclaje que sólo lleve una cédula.
    expect(esCedulaBoliviana(reconocido)).toBe(false);
  });
});

describe('la puerta de documentos sobre una lectura degradada', () => {
  const classifier = new HeuristicDocumentClassifierAdapter();

  it('clasifica la cédula real como BOLIVIA_CI y la deja pasar', async () => {
    const classification = await classifier.classify({
      rawText: `${ANVERSO_DEGRADADO}\n${REVERSO_DEGRADADO}`,
      frontText: ANVERSO_DEGRADADO,
      backText: REVERSO_DEGRADADO,
      documentCountry: 'BO',
    });
    expect(classification.type).toBe(IdentityDocumentType.BOLIVIA_CI);

    const evidencia = medirEvidenciaDeIdentidad({
      texto: `${ANVERSO_DEGRADADO}\n${REVERSO_DEGRADADO}`,
      anchoLargo: 1600,
      ladoCorto: 1200,
    });
    expect(evidencia.confidence).toBeGreaterThanOrEqual(0.55);

    const puerta = triageIdentityDocument({
      evidence: evidencia,
      documentType: classification.type,
      acceptedTypes: [IdentityDocumentType.BOLIVIA_CI],
      thresholds: { accept: 0.55, review: 0.25 },
    });
    expect(puerta.verdict).toBe('ACCEPT');
  });

  it('la licencia se rechaza por SU motivo, no por «no es un documento»', async () => {
    const classification = await classifier.classify({
      rawText: LICENCIA,
      frontText: LICENCIA,
      backText: '',
      documentCountry: 'BO',
    });
    expect(classification.type).toBe(IdentityDocumentType.DRIVER_LICENSE);

    const puerta = triageIdentityDocument({
      evidence: medirEvidenciaDeIdentidad({ texto: LICENCIA, anchoLargo: 1600, ladoCorto: 1000 }),
      documentType: classification.type,
      acceptedTypes: [IdentityDocumentType.BOLIVIA_CI],
      thresholds: { accept: 0.55, review: 0.25 },
    });
    expect(puerta).toMatchObject({ verdict: 'REJECT', reason: 'UNSUPPORTED_DOCUMENT_TYPE' });
  });
});

describe('la MRZ con las erratas que comete el OCR de verdad', () => {
  it('recupera el número con el dígito de control leído como letra', () => {
    const mrz = parseMrzTd1(REVERSO_DEGRADADO);
    expect(mrz).not.toBeNull();
    expect(mrz?.documentNumber).toBe('4521966');
    expect(mrz?.checks.documentNumber).toBe(true);
  });

  /*
   * El compuesto se calcula sobre los dos renglones enteros, así que arrastraba
   * la misma `T` que el módulo ya había decidido que era un `7`: los cuatro
   * campos validaban y el documento salía marcado con
   * `MRZ_COMPOSITE_CHECK_FAILED`.
   */
  it('cuadra el control compuesto pese al glifo espurio y a la letra por dígito', () => {
    const mrz = parseMrzTd1(REVERSO_DEGRADADO);
    expect(mrz?.checks).toEqual({
      documentNumber: true,
      birthDate: true,
      expirationDate: true,
      composite: true,
    });
  });

  it('devuelve la nacionalidad en letras, nunca con un cero por una O', () => {
    // El renglón trae `B0L`, con un cero: la norma reserva esas tres posiciones
    // a un código ISO alfa-3, así que el dígito es un misleído con certeza.
    expect(parseMrzTd1(REVERSO_DEGRADADO)?.nationality).toBe('BOL');
  });
});

describe('el analizador de la cédula sobre una lectura degradada', () => {
  const parser = new BoliviaCiDocumentParser();
  const analizar = async () =>
    parser.parse({
      ocr: {
        rawText: `${ANVERSO_DEGRADADO}\n${REVERSO_DEGRADADO}`,
        lines: [...ANVERSO_DEGRADADO.split('\n'), ...REVERSO_DEGRADADO.split('\n')].map((text) => ({
          text,
          confidence: 0.58,
        })),
        provider: 'tesseract',
        modelVersion: 'spa-4.0.0',
      },
      context: { type: IdentityDocumentType.BOLIVIA_CI, country: 'BO' },
    });

  it('saca el nombre de la MRZ cuando bajo el rótulo hay ruido del retrato', async () => {
    const { fields } = await analizar();
    // El anverso trae `CMI` y `Priti` donde deberían ir NOMBRES y APELLIDOS: son
    // glifos que el reconocedor saca de la fotografía del titular.
    expect(fields.firstNames?.value).toBe('ANA LUCIA');
    expect(fields.lastNames?.value).toBe('QUISPE MAMANI');
  });

  it('recupera número y fechas aunque ningún rótulo se lea entero', async () => {
    const { fields } = await analizar();
    expect(fields.documentNumber?.value).toBe('4521966');
    expect(fields.dateOfBirth?.value).toBe('1990-03-14');
    expect(fields.expirationDate?.value).toBe('2030-06-12');
    // `FECHA DI EMIBION`: el rótulo mutilado, cotejado con tolerancia.
    expect(fields.issueDate?.value).toBe('2025-06-12');
  });

  it('saca el lugar de nacimiento por su valor cuando su rótulo no aparece', async () => {
    const { fields } = await analizar();
    // El rótulo `LUGAR DE NACIMIENTO` no está en la lectura; el departamento sí.
    expect(fields.placeOfBirth?.value).toBe('SANTA CRUZ - ANDRES IBAÑEZ - SANTA');
  });

  it('no deja el número ni el nombre sin encontrar', async () => {
    const { warnings } = await analizar();
    expect(warnings).not.toContain('DOCUMENT_NUMBER_NOT_FOUND');
    expect(warnings).not.toContain('NAME_NOT_FOUND');
    expect(warnings).not.toContain('DOCUMENT_MRZ_CHECK_FAILED');
  });
});

describe('rótulos que se parecen entre sí', () => {
  const parser = new BoliviaCiDocumentParser();

  /*
   * `VENCIMIENTO` y `NACIMIENTO` están a dos ediciones, dentro de la tolerancia
   * una de la otra. Sobre una cédula real la grafía de la caducidad se llevó el
   * renglón de la fecha de nacimiento y con él su valor: el documento salía con
   * la fecha de nacimiento puesta como caducidad y, al no coincidir con la MRZ,
   * marcado `DOCUMENT_MRZ_MISMATCH` — una acusación de documento compuesto
   * contra una cédula cuyas dos caras dicen lo mismo.
   */
  it('no adjudica el renglón de NACIMIENTO al campo de caducidad', async () => {
    const lineas = [
      'CIÓN N* 4521966',
      'FECHA DE NACIMIENTO',
      '2 14/03/1990',
      'FECHA DI EMIBION rca DE FAPIRACIÓN',
      '— 12/06/2025 12/06/2030',
      'I<BOL4521966<<T<<<<<<<<<<<<<<<',
      '4 9003141F3006128B0L<<<<<<<<<<<4',
      'QUISPE<MAMANI<<ANA<LUCIA<<<<<<',
    ];
    const { fields, warnings } = await parser.parse({
      ocr: {
        rawText: lineas.join('\n'),
        lines: lineas.map((text) => ({ text, confidence: 0.58 })),
        provider: 'tesseract',
        modelVersion: 'spa-4.0.0',
      },
      context: { type: IdentityDocumentType.BOLIVIA_CI, country: 'BO' },
    });

    expect(fields.dateOfBirth?.value).toBe('1990-03-14');
    expect(fields.expirationDate?.value).toBe('2030-06-12');
    expect(fields.issueDate?.value).toBe('2025-06-12');
    // Y lo que esto protege: el anverso y la MRZ dicen lo mismo, así que no
    // puede haber marca de documento compuesto.
    expect(warnings).not.toContain('DOCUMENT_MRZ_MISMATCH');
  });

  /*
   * El ordinal volado de `N°` es el glifo más pequeño del anverso y el
   * reconocedor lo devuelve como `N*`, `N”` o `N'`. Sin tolerarlo se perdía el
   * número IMPRESO —el dato más grande de la tarjeta— y con él la única
   * comprobación cruzada contra la MRZ.
   */
  it('lee el número impreso con las grafías que el OCR le da a N°', async () => {
    for (const grafia of ['N* 4521966', 'N” 4521966', "N' 4521966", 'N° 4521966']) {
      const anclas = parser.crossCheckAnchors({
        rawText: `CIÓN ${grafia}`,
        lines: [{ text: `CIÓN ${grafia}`, confidence: 0.5 }],
      });
      expect(anclas.documentNumber).toBe('4521966');
    }
  });
});
