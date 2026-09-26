/**
 * La puerta de documentos: qué se rechaza, qué se pregunta y qué pasa.
 *
 * El defecto que cierra este fichero es el que más gente paraba y el que más
 * cola humana generaba a la vez: TODA imagen que el clasificador no supiera
 * nombrar salía por el mismo sitio. La cédula fotografiada de noche y la foto de
 * un recibo recibían la misma respuesta —«ese tipo de documento no está
 * soportado»— y el mismo desenlace. A quien tenía una cédula válida se le decía
 * que su cédula no era una cédula; a quien subió un recibo no se le decía nunca
 * qué había subido.
 *
 * Se prueba sobre TEXTO y no sobre imágenes a propósito: lo que se está
 * midiendo es la política —dónde están las fronteras y qué se contesta en cada
 * franja—, y una batería que necesitara fotos reales tardaría dos minutos en
 * decir lo mismo. El camino completo con imágenes lo cubre
 * `identity-verification-pipeline.spec.ts`.
 */
import {
  medirEvidenciaDeIdentidad,
  parsearTiposAceptados,
} from '../src/modules/workers/identity-verification/core/engine/identity-evidence';
import {
  DEFAULT_IDENTITY_THRESHOLDS,
  normalizeIdentityThresholds,
  triageIdentityDocument,
} from '../src/modules/workers/identity-verification/core/engine/identity-triage';
import { IdentityDocumentType } from '../src/modules/workers/identity-verification/core/domain/identity-enums';

/** Una cédula boliviana tal como la lee el reconocedor: en mayúsculas y a trozos. */
const CEDULA = [
  'ESTADO PLURINACIONAL DE BOLIVIA',
  'SERVICIO GENERAL DE IDENTIFICACION PERSONAL',
  'CEDULA DE IDENTIDAD',
  'APELLIDOS ARAUZ CABALLERO',
  'NOMBRES PABLO ANDRES',
  'FECHA DE NACIMIENTO 14/03/1994',
  'NUMERO 8291134',
  'FECHA DE VENCIMIENTO 20/07/2031',
].join('\n');

function puerta(
  texto: string,
  opciones: {
    documentType?: IdentityDocumentType;
    acceptedTypes?: readonly IdentityDocumentType[];
    anchoLargo?: number;
    ladoCorto?: number;
  } = {},
) {
  const evidence = medirEvidenciaDeIdentidad({
    texto,
    anchoLargo: opciones.anchoLargo ?? 1080,
    ladoCorto: opciones.ladoCorto ?? 680,
  });
  return {
    evidence,
    outcome: triageIdentityDocument({
      evidence,
      documentType: opciones.documentType ?? IdentityDocumentType.BOLIVIA_CI,
      acceptedTypes: opciones.acceptedTypes ?? [IdentityDocumentType.BOLIVIA_CI],
      thresholds: DEFAULT_IDENTITY_THRESHOLDS,
    }),
  };
}

describe('un carnet pasa', () => {
  it('la cédula completa se acepta sin preguntar a nadie', () => {
    const { outcome, evidence } = puerta(CEDULA);

    expect(outcome.verdict).toBe('ACCEPT');
    expect(evidence.confidence).toBeGreaterThanOrEqual(DEFAULT_IDENTITY_THRESHOLDS.accept);
    expect(evidence.signals).toEqual(
      expect.arrayContaining(['identity-title', 'issuing-authority', 'personal-fields']),
    );
  });

  it('le da igual la caja y las tildes con las que el lector devuelva el texto', () => {
    const { outcome } = puerta(CEDULA.toLowerCase().replace('CEDULA', 'cédula'));

    expect(outcome.verdict).toBe('ACCEPT');
  });

  it('una MRZ basta para sostener el documento aunque el frente se lea mal', () => {
    const mrz = [
      'IDBOL8291134<<<<<<<<<<<<<<<<<<',
      '9403149M3107204BOL<<<<<<<<<<<8',
      'ARAUZ<<PABLO',
    ].join('\n');
    const { evidence } = puerta(mrz);

    expect(evidence.signals).toContain('machine-readable-zone');
  });
});

describe('lo que NO es un carnet se rechaza, y se dice qué era', () => {
  const OTROS_DOCUMENTOS: readonly [string, string][] = [
    ['FACTURA\nNIT: 1023456789\nCODIGO DE CONTROL A1-B2-C3\nTOTAL 350.00', 'TAX_INVOICE'],
    ['EXTRACTO DE CUENTA\nSALDO ANTERIOR 1.200,00\nFECHA DETALLE IMPORTE', 'BANK_STATEMENT'],
    ['RECIBO DE CAJA\nSUBTOTAL 120\nTOTAL A PAGAR 138', 'RECEIPT'],
    ['BOLETA DE PAGO\nHABERES\nDESCUENTOS\nLIQUIDO PAGABLE', 'PAYROLL_SLIP'],
    ['CERTIFICADO DE NACIMIENTO\nOFICIALIA DE REGISTRO CIVIL', 'CIVIL_CERTIFICATE'],
    ['https://mi-banco.com/comprobante/8891', 'SCREENSHOT'],
  ];

  it.each(OTROS_DOCUMENTOS)('«%s» se rechaza como %s', (texto, esperado) => {
    const { evidence, outcome } = puerta(texto);

    expect(evidence.contraindicator).toBe(esperado);
    expect(evidence.confidence).toBe(0);
    expect(outcome.verdict).toBe('REJECT');
    expect(outcome).toMatchObject({ reason: 'NOT_AN_IDENTITY_DOCUMENT' });
  });

  it('un contraindicador gana aunque el papel lleve además campos personales', () => {
    // La factura boliviana imprime nombre y fecha del cliente, así que suma
    // señales legítimas. Si el contraindicador sólo restara, acabaría colándose
    // en la franja de duda y ocupando el tiempo de una persona.
    const { outcome } = puerta(
      'FACTURA\nCODIGO DE CONTROL 9A-8B\nNOMBRES PABLO\nAPELLIDOS ARAUZ\nFECHA DE NACIMIENTO 14/03/1994',
    );

    expect(outcome.verdict).toBe('REJECT');
  });

  it('una foto sin texto no es un documento ilegible: no es un documento', () => {
    const { outcome } = puerta('');

    expect(outcome).toMatchObject({ verdict: 'REJECT', reason: 'NOT_AN_IDENTITY_DOCUMENT' });
  });

  it('la proporción de una tarjeta, sola, no admite nada', () => {
    // Es la trampa que este peso pequeño evita: media Bolivia fotografía cosas
    // rectangulares, y una tarjeta de fidelidad tiene exactamente esta forma.
    const { outcome } = puerta('CLUB DE DESCUENTOS', { anchoLargo: 1080, ladoCorto: 681 });

    expect(outcome.verdict).toBe('REJECT');
  });
});

describe('sólo la duda razonable llega a una persona', () => {
  it('un documento reconocido a medias va a arbitraje, no al rechazo', () => {
    // Se lee el rótulo y nada más: es la cédula fotografiada de noche.
    const { outcome } = puerta('CEDULA DE IDENTIDAD');

    expect(outcome).toMatchObject({ verdict: 'REVIEW', reason: 'DOUBTFUL_DOCUMENT' });
  });

  it('evidencia sobrada sin tipo reconocible es el caso que más pide una persona', () => {
    const { outcome } = puerta(CEDULA, { documentType: IdentityDocumentType.UNKNOWN });

    expect(outcome).toMatchObject({ verdict: 'REVIEW', reason: 'UNRECOGNIZED_DOCUMENT_TYPE' });
  });

  it('sin evidencia, un tipo desconocido se rechaza en vez de preguntarse', () => {
    // Preguntarle a alguien por una imagen en la que no hay nada que confirmar
    // es gastarle el tiempo: la cola sólo se sostiene si todo lo que entra en
    // ella se puede resolver mirando.
    const { outcome } = puerta('...', { documentType: IdentityDocumentType.UNKNOWN });

    expect(outcome.verdict).toBe('REJECT');
  });
});

describe('el tipo admitido es política del despliegue, no del motor', () => {
  it('un pasaporte legítimo se rechaza por SU motivo, no por «no es un documento»', () => {
    // Son dos instrucciones distintas para quien está delante del móvil, y
    // darle la equivocada le hace repetir la misma foto.
    const { outcome } = puerta(
      'PASAPORTE\nESTADO PLURINACIONAL DE BOLIVIA\nAPELLIDOS ARAUZ\nNOMBRES PABLO\nFECHA DE NACIMIENTO 14/03/1994',
      { documentType: IdentityDocumentType.PASSPORT },
    );

    expect(outcome).toMatchObject({ verdict: 'REJECT', reason: 'UNSUPPORTED_DOCUMENT_TYPE' });
  });

  it('habilitarlo es una variable de entorno y nada más', () => {
    const { outcome } = puerta(
      'PASAPORTE\nESTADO PLURINACIONAL DE BOLIVIA\nAPELLIDOS ARAUZ\nNOMBRES PABLO\nFECHA DE NACIMIENTO 14/03/1994',
      {
        documentType: IdentityDocumentType.PASSPORT,
        acceptedTypes: parsearTiposAceptados('BOLIVIA_CI,PASSPORT'),
      },
    );

    expect(outcome.verdict).toBe('ACCEPT');
  });

  it('una lista vacía o ilegible cae al carnet, no abre la puerta a todos', () => {
    expect(parsearTiposAceptados(undefined)).toEqual([IdentityDocumentType.BOLIVIA_CI]);
    expect(parsearTiposAceptados('')).toEqual([IdentityDocumentType.BOLIVIA_CI]);
    expect(parsearTiposAceptados('CARNET, DNI')).toEqual([IdentityDocumentType.BOLIVIA_CI]);
    // `UNKNOWN` no es un tipo admisible: aceptarlo sería aceptar cualquier cosa.
    expect(parsearTiposAceptados('UNKNOWN')).toEqual([IdentityDocumentType.BOLIVIA_CI]);
  });
});

describe('las fronteras no se pueden configurar al revés', () => {
  it('un umbral de revisión por encima del de aceptación se ordena solo', () => {
    // Con la franja invertida, todo documento dudoso se rechazaría en silencio:
    // justo el fallo que la puerta existe para impedir.
    expect(normalizeIdentityThresholds({ accept: 0.4, review: 0.9 })).toEqual({
      accept: 0.4,
      review: 0.4,
    });
  });

  it('un valor imposible se acota en vez de propagarse', () => {
    expect(normalizeIdentityThresholds({ accept: 5, review: -2 })).toEqual({
      accept: 1,
      review: 0,
    });
  });
});
