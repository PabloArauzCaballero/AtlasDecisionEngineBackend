/**
 * Entorno de referencia: el membrete con el que se toman las huellas visuales y la evidencia.
 *
 * Existe porque la huella del §46 sólo significa algo si las dos partes que la comparan
 * componen el MISMO documento. El CLI que escribe la referencia y la prueba que la comprueba
 * viven en árboles distintos; sin una constante compartida, basta que una use el membrete por
 * omisión y la otra el de un despliegue para que la comparación falle siempre, por un motivo
 * que no es un cambio de diseño — y una comprobación que falla sin motivo se acaba desactivando.
 *
 * Es también el membrete de `yarn pdf:evidencia`: los datos son ficticios y COMPLETOS a
 * propósito —razón social, NIT, dirección, teléfono, correo, sitio y texto secundario— para que
 * las capturas ejerciten todas las líneas del membrete. Con la mitad de los campos vacíos, la
 * evidencia enseñaría un membrete que ningún despliegue real va a tener.
 */
export const REFERENCE_BRAND_ENV: Readonly<Record<string, string>> = Object.freeze({
  PDF_BRAND_ID: 'atlas',
  PDF_BRAND_NAME: 'ATLAS Decision Engine',
  PDF_ORG_NAME: 'Cooperativa Nuñez & Peñaranda Ltda.',
  PDF_ORG_LEGAL_NAME: 'Cooperativa de Ahorro y Crédito Nuñez y Peñaranda Ltda.',
  PDF_ORG_TAX_ID: 'NIT 1023456789',
  PDF_ORG_ADDRESS: 'Av. Ballivián 1234, piso 7 · La Paz, Bolivia',
  PDF_ORG_PHONE: '+591 2 2771234',
  PDF_ORG_EMAIL: 'documentos@nunezpenaranda.bo',
  PDF_ORG_WEBSITE: 'www.nunezpenaranda.bo',
  PDF_ORG_SECONDARY_TEXT: 'Unidad de Riesgo Crediticio',
  PDF_LETTERHEAD_MODE: 'every-page',
  PDF_DEFAULT_FORMAT: 'A4',
  PDF_DEFAULT_LOCALE: 'es-BO',
  PDF_DEFAULT_TIMEZONE: 'America/La_Paz',
  // Sin almacenamiento: la referencia no debe dejar archivos por el disco de quien la ejecuta.
  PDF_STORAGE_ENABLED: 'false',
});

/**
 * Instante congelado de la referencia.
 *
 * La fecha va impresa en el pie y viaja en los metadatos. Con el reloj real, dos capturas del
 * mismo documento se diferencian en un minuto y la comparación no puede distinguir «cambió el
 * diseño» de «pasó un rato».
 */
export const REFERENCE_INSTANT = new Date('2026-02-11T15:30:00.000Z');
