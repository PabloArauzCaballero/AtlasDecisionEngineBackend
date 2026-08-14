import {
  renderCedula,
  renderCedulaReverso,
  renderCedulaSobreEscritorio,
  renderPaisaje,
  renderPlano,
  renderSelfie,
  type CedulaSintetica,
} from './identity-card';

/**
 * Escenarios de prueba del worker de identidad.
 *
 * Las imágenes se GENERAN, no se versionan: una foto real de un documento real
 * es exactamente el dato que este worker existe para proteger, y meterla en el
 * repositorio la publicaría para siempre en el historial de git.
 *
 * Y llevan **texto de verdad** y **caras de verdad**. Ya no hay ninguna pista de
 * escenario: cada desenlace lo producen las imágenes. El tipo de documento, el
 * número, el nombre y las fechas salen de leer la tarjeta; el parecido sale de
 * comparar el retrato impreso con la selfie. Un escenario recorre exactamente el
 * mismo camino que un archivo subido por una persona, que es lo único que hace
 * que probar con él pruebe algo.
 *
 * Los rostros son DIBUJADOS (`identity-faces.ts`), no fotografías de nadie.
 *
 * Las descripciones ya no prometen una cifra de parecido. Antes decían «parecido
 * 0,97» porque el comparador simulado devolvía exactamente eso; hoy el número
 * sale de medir dos imágenes y depende del corte calibrado del despliegue, así
 * que lo que se promete es el DESENLACE y el motivo, que es lo que el usuario
 * necesita saber antes de ejecutar.
 */

export interface IdentityFixture {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly preview: string;
  readonly expectsFailure: boolean;
  /** Qué imagen de documento se dibuja. */
  readonly documento:
    'cedula' | 'cedula-escritorio' | 'cedula-caducada' | 'cedula-ilegible' | 'plana' | 'paisaje';
  /** Qué persona de la población lleva el retrato del documento. */
  readonly rostroDocumento: number;
  /**
   * Qué persona sale en la selfie. Igual que `rostroDocumento` es la misma
   * persona; distinta es otra, y ahí está la diferencia entre aprobar y
   * rechazar. No hay un tercer mecanismo.
   */
  readonly rostroSelfie: number;
  /** La tarjeta sale sin retrato utilizable: una fotocopia. */
  readonly sinRetrato?: boolean;
}

/*
 * Las personas de la población que salen en los escenarios.
 *
 * `PARECIDA` no está elegida al azar: es la identidad cuyo parecido con
 * `TITULAR` cae, medido, entre los dos umbrales del perfil calibrado. Es la
 * única forma honesta de enseñar la franja ambigua ahora que el parecido se
 * calcula en vez de escribirse — y si alguien recalibra con otros cortes, esta
 * pareja hay que volver a buscarla con `scripts/buscar-pareja-ambigua.mjs`.
 */
const TITULAR = 7;
/**
 * Parecido MEDIDO con el titular por el mismo camino que recorre una
 * verificación —retrato impreso en la tarjeta, remuestreo y recorte—: 0,8203,
 * dentro de la franja [0,7789 · 0,8824) del perfil calibrado. Se eligió la que
 * queda más lejos de los dos bordes entre 70 candidatas: una pareja pegada a un
 * borde se saldría de la franja al recalibrar por poco que se muevan los cortes.
 */
const PARECIDA = 8;
const AJENA = 23;

export const IDENTITY_FIXTURES: readonly IdentityFixture[] = [
  {
    code: 'identidad-aprobada',
    name: 'Verificación limpia',
    description:
      'Documento legible y una selfie de la misma persona, tomada aparte. Es el camino sin incidencias: termina en VERIFICADO si el despliegue tiene umbrales calibrados.',
    preview: 'Cédula boliviana legible + selfie del titular',
    expectsFailure: false,
    documento: 'cedula',
    rostroDocumento: TITULAR,
    rostroSelfie: TITULAR,
  },
  {
    code: 'identidad-revision',
    name: 'Parecido ambiguo',
    description:
      'Dos personas que se parecen lo bastante para que el parecido caiga entre el umbral de revisión y el de coincidencia. Nadie puede afirmar ni negar: va a una persona.',
    preview: 'Cédula legible + selfie de alguien parecido',
    expectsFailure: false,
    documento: 'cedula',
    rostroDocumento: TITULAR,
    rostroSelfie: PARECIDA,
  },
  {
    code: 'identidad-rechazada',
    name: 'Rostro distinto',
    description:
      'La selfie es de otra persona. El parecido queda por debajo del umbral de revisión: es un no-parecido claro y se rechaza.',
    preview: 'Cédula legible + selfie de otra persona',
    expectsFailure: false,
    documento: 'cedula',
    rostroDocumento: TITULAR,
    rostroSelfie: AJENA,
  },
  {
    code: 'identidad-sin-retrato',
    name: 'Documento sin retrato',
    description:
      'Una fotocopia: la cédula se lee entera, pero donde va la foto no hay nada utilizable. Se rechaza ANTES de comparar, y ésa es la comprobación: el motor no se inventa un parecido que no puede medir.',
    preview: 'Cédula legible con el recuadro de la foto vacío · se corta al buscar el rostro',
    expectsFailure: true,
    documento: 'cedula',
    rostroDocumento: TITULAR,
    rostroSelfie: TITULAR,
    sinRetrato: true,
  },
  {
    code: 'identidad-caducada',
    name: 'Documento caducado',
    description:
      'La cédula caducó en 2020, y la fecha se lee de la propia imagen y de su MRZ. Es un rechazo incondicional: se evalúa antes que cualquier otra señal, incluso con el rostro correcto.',
    preview: 'Cédula con validez vencida + selfie del titular',
    expectsFailure: false,
    documento: 'cedula-caducada',
    rostroDocumento: 11,
    rostroSelfie: 11,
  },
  {
    code: 'identidad-ilegible',
    name: 'Campos no legibles',
    description:
      'Se reconoce que es una cédula, pero ni el número ni el nombre se pueden leer. Hay resultado, sin los campos que sostienen una identidad: va a revisión.',
    preview: 'Cédula con el número y el nombre borrosos',
    expectsFailure: false,
    documento: 'cedula-ilegible',
    rostroDocumento: 13,
    rostroSelfie: 13,
  },
  {
    code: 'identidad-sobre-escritorio',
    name: 'Cédula sobre un escritorio',
    description:
      'La foto que manda una persona de verdad: la tarjeta ocupa un tercio del encuadre y el resto es mesa. El motor recorta el fondo antes de leer —sobrevive el 32 % de la foto— y, si el recorte no diera documento, vuelve a leer la imagen entera antes de rechazar. El TEXTO se recupera entero. El RETRATO no del todo: entra con menos píxeles y el parecido cae JUSTO al filo del umbral de aprobación, así que este escenario puede terminar verificado o en revisión según el equipo. No es un defecto, es el coste real de fotografiar el documento de lejos — y por eso aquí no se promete un veredicto.',
    preview:
      'Cédula pequeña dentro de una foto grande · el fondo se recorta, el rostro pierde detalle',
    expectsFailure: false,
    documento: 'cedula-escritorio',
    rostroDocumento: 17,
    rostroSelfie: 17,
  },
  {
    code: 'imagen-cualquiera',
    name: 'No es un documento',
    description:
      'Una foto normal, con buena calidad y sin una sola letra. Se rechaza por no ser un documento de identidad, ANTES de comparar ningún rostro. Es la comprobación que separa «no puedo afirmar quién eres» de «esto no es un documento».',
    preview: 'Fotografía cualquiera, nítida y sin texto · se corta al clasificar',
    expectsFailure: true,
    documento: 'paisaje',
    rostroDocumento: 1,
    rostroSelfie: 1,
  },
  {
    code: 'identidad-foto-mala',
    name: 'Foto inservible',
    description:
      'Imagen plana, sin contraste ni detalle. Se rechaza ANTES de mirar ningún rostro: gastar el análisis en una foto así sólo retrasa el aviso.',
    preview: 'Documento sin foco ni contraste · se corta en la primera etapa',
    expectsFailure: true,
    documento: 'plana',
    rostroDocumento: 1,
    rostroSelfie: 1,
  },
];

export function findIdentityFixture(code: string): IdentityFixture | undefined {
  return IDENTITY_FIXTURES.find((fixture) => fixture.code === code);
}

/**
 * Construye las tres imágenes del escenario.
 *
 * Deterministas y DISTINTAS por escenario: la idempotencia del worker se apoya
 * en la huella del contenido, así que dos escenarios que generaran los mismos
 * píxeles se fundirían en una sola ejecución y el segundo devolvería el
 * resultado del primero. Por eso el número de cédula cambia con el escenario.
 */
export async function buildIdentityFixtureImages(
  fixture: IdentityFixture,
): Promise<{ document: Buffer; documentBack: Buffer | null; selfie: Buffer }> {
  const cached = CACHE.get(fixture.code);
  if (cached) return cached;

  const built = {
    document: await documentoDe(fixture),
    /*
     * El reverso sólo acompaña a los escenarios que tienen una cédula de
     * verdad: es donde vive la MRZ, y mandarlo con una foto de un paisaje sería
     * pedirle al motor que contraste dos caras de documentos distintos.
     */
    documentBack: llevaReverso(fixture) ? await renderCedulaReverso(datosDe(fixture)) : null,
    selfie: await renderSelfie(fixture.rostroSelfie, varianteDe(fixture)),
  };
  CACHE.set(fixture.code, built);
  return built;
}

const CACHE = new Map<string, { document: Buffer; documentBack: Buffer | null; selfie: Buffer }>();

/**
 * Cada escenario usa una TOMA distinta de su persona.
 *
 * Dos escenarios que compartieran persona y toma producirían la misma selfie, y
 * la huella de contenido los fundiría en una sola ejecución: el segundo
 * devolvería el resultado del primero sin volver a mirar nada.
 */
function varianteDe(fixture: IdentityFixture): number {
  return 1 + (IDENTITY_FIXTURES.findIndex((f) => f.code === fixture.code) % 5);
}

/*
 * `cedula-ilegible` NO lleva reverso, y ésa es la mitad del escenario.
 *
 * La MRZ es legible por construcción: si se adjuntara, el motor leería de ahí
 * el número, las fechas y hasta el nombre, y el escenario «campos no legibles»
 * terminaría VERIFICADO — que es exactamente lo que pasó la primera vez. Una
 * tarjeta cuyo anverso no se puede leer y cuyo reverso se lee perfecto no es un
 * caso coherente; lo coherente es que sólo se fotografiara el anverso.
 */
function llevaReverso(fixture: IdentityFixture): boolean {
  return (
    fixture.documento !== 'plana' &&
    fixture.documento !== 'paisaje' &&
    fixture.documento !== 'cedula-ilegible'
  );
}

/** Números distintos por escenario: es lo que separa una huella de otra. */
const NUMERO: Record<string, string> = {
  'identidad-aprobada': '1234567',
  'identidad-revision': '7654321',
  'identidad-rechazada': '1111111',
  'identidad-sin-retrato': '2223334',
  'identidad-caducada': '4445556',
  'identidad-ilegible': '9998887',
  'identidad-sobre-escritorio': '3334445',
};

/**
 * Los datos de la tarjeta de un escenario.
 *
 * Anverso y reverso se dibujan con ESTOS mismos datos: la MRZ del reverso se
 * calcula a partir de ellos, así que el contraste entre caras que hace el
 * analizador compara dos representaciones del mismo documento — que es lo que
 * hace significativo el aviso cuando no coinciden.
 */
function datosDe(fixture: IdentityFixture): CedulaSintetica {
  const caducada = fixture.documento === 'cedula-caducada';
  return {
    numero: NUMERO[fixture.code] ?? '1234567',
    serie: '21333',
    seccion: '11222',
    nombres: 'MARIA RENEE',
    apellidos: 'RODRIGUEZ GONZALEZ',
    nacimiento: '05/04/2003',
    nacimientoIso: '2003-04-05',
    emision: caducada ? '01/11/2015' : '01/11/2023',
    expiracion: caducada ? '01/11/2020' : '01/11/2028',
    expiracionIso: caducada ? '2020-11-01' : '2028-11-01',
    sexo: 'F',
    lugarNacimiento: 'SANTA CRUZ-ANDRES IBANEZ-SANTA CRUZ DE LA SIERRA',
    domicilio: 'C. SANCHEZ LIMA NO.2520 Z. SOPOCACHI',
    profesion: 'ESTUDIANTE',
    estadoCivil: 'SOLTERA',
    grupoSanguineo: 'A RH +',
    rostro: fixture.rostroDocumento,
    ...(fixture.documento === 'cedula-ilegible' ? { ilegible: true } : {}),
    ...(fixture.sinRetrato ? { sinRetrato: true } : {}),
  };
}

async function documentoDe(fixture: IdentityFixture): Promise<Buffer> {
  if (fixture.documento === 'plana') return renderPlano(720, 540);
  if (fixture.documento === 'paisaje') return renderPaisaje(fixture.code);
  const dibujar =
    fixture.documento === 'cedula-escritorio' ? renderCedulaSobreEscritorio : renderCedula;
  return dibujar(datosDe(fixture));
}
