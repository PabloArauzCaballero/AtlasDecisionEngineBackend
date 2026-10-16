export interface SondaDeCatalogo {
  readonly id: string;
  readonly texto: string;
  /** `true` describe una cédula boliviana legítima; `false`, algo que no lo es. */
  readonly positiva: boolean;
}

export const SONDAS_BOLIVIA_CI: readonly SondaDeCatalogo[] = [
  {
    id: 'ci-2023-anverso',
    positiva: true,
    texto:
      'Estado Plurinacional de Bolivia. Servicio General de Identificación Personal. Cédula de identidad con nombres, apellidos, fecha de nacimiento, fecha de emisión y fecha de expiración, con serie y sección, número de cédula y fotografía del titular.',
  },
  {
    id: 'ci-2023-reverso',
    positiva: true,
    texto:
      'Reverso de la cédula de identidad boliviana con lugar de nacimiento por departamento, provincia y localidad, domicilio, profesión u ocupación, estado civil, grupo sanguíneo, nación o pueblo indígena originario campesino, firma del titular y zona de lectura mecánica.',
  },
  {
    id: 'ci-antigua',
    positiva: true,
    texto:
      'Cédula de identidad boliviana del formato anterior expedida por el SEGIP, válida hasta una fecha, con el nombre del titular, nacido el día indicado, en una localidad de Bolivia, con serie y sección y el número de cédula seguido de la sigla del departamento de expedición.',
  },
  {
    id: 'ci-mrz',
    positiva: true,
    texto:
      'Documento de identidad boliviano con zona de lectura mecánica de tres renglones en formato TD1, código de emisor BOL, número de documento con dígito de control, fecha de nacimiento, sexo, fecha de expiración y apellidos separados de los nombres por dobles chevrones.',
  },
  {
    id: 'no-factura',
    positiva: false,
    texto:
      'Factura electrónica con número de autorización, código de control, NIT del emisor, detalle de productos, subtotal, importe total y la leyenda de que contribuye al desarrollo del país.',
  },
  {
    id: 'no-extracto',
    positiva: false,
    texto:
      'Extracto de cuenta bancaria con saldo anterior, movimientos por fecha, débitos, créditos y saldo final del período.',
  },
  {
    id: 'no-licencia',
    positiva: false,
    texto:
      'Licencia para conducir con categoría del vehículo, restricciones médicas, número de licencia, fecha de emisión y autoridad de tránsito.',
  },
  {
    id: 'no-pasaporte',
    positiva: false,
    texto:
      'Pasaporte con tipo P, código de país, número de pasaporte, autoridad de expedición, lugar de nacimiento y zona de lectura mecánica de dos renglones de cuarenta y cuatro caracteres.',
  },
  {
    id: 'no-documento-extranjero',
    positiva: false,
    texto:
      'Documento nacional de identidad de otro país sudamericano con número de registro civil, nombre completo, fecha de nacimiento y sello del registro nacional de identificación de ese país.',
  },
  {
    id: 'no-plantilla',
    positiva: false,
    texto:
      'Plantilla de muestra descargada de internet con campos de ejemplo, texto lorem ipsum, la palabra SPECIMEN o MUESTRA sobreimpresa y marcas de agua del sitio que la distribuye.',
  },
  {
    id: 'no-certificado',
    positiva: false,
    texto:
      'Certificado de nacimiento o partida de nacimiento emitida por el registro civil, con número de partida, libro, folio y firma del oficial de registro.',
  },
  {
    id: 'no-carnet-privado',
    positiva: false,
    texto:
      'Credencial de una empresa o universidad con el nombre de la institución, el cargo o la carrera del portador, un número de legajo y la fecha de validez del gafete.',
  },
];

/**
 * Marcas que un documento LEGÍTIMO nunca imprime y que delatan una plantilla,
 * una muestra o un montaje.
 *
 * Van aparte de los contraindicadores de `identity-evidence.ts` —que reconocen
 * OTRO documento— porque éstas no dicen «esto es una factura»: dicen «esto es
 * una cédula, y es falsa». La consecuencia también es distinta: allí el caso se
 * cierra, aquí el caso ESCALA con una marca de fraude, porque afirmar que un
 * documento está falsificado es una acusación y no la debe firmar una heurística
 * a solas.
 */
export const MARCAS_DE_FALSIFICACION: ReadonlyArray<{
  readonly codigo: string;
  readonly patron: RegExp;
  readonly descripcion: string;
}> = [
  {
    codigo: 'SPECIMEN_WATERMARK',
    patron: /\bSPECIMEN\b|\bMUESTRA\b|\bSAMPLE\b|\bVOID\b|\bDUMMY\b/u,
    descripcion: 'La tarjeta lleva sobreimpresa la marca de un ejemplar de muestra.',
  },
  {
    codigo: 'TEMPLATE_PLACEHOLDER',
    patron:
      /LOREM\s+IPSUM|\bXXXX+\b|\bNOMBRE\s+APELLIDO\b|\bJOHN\s+DOE\b|\bYOUR\s+NAME\b|\bTU\s+NOMBRE\b/u,
    descripcion: 'Quedan textos de relleno de una plantilla sin completar.',
  },
  {
    codigo: 'STOCK_IMAGE_MARK',
    patron: /SHUTTERSTOCK|GETTY\s*IMAGES|ALAMY|DREAMSTIME|123RF|FREEPIK|ISTOCKPHOTO/u,
    descripcion: 'La imagen lleva la marca de agua de un banco de imágenes.',
  },
  {
    codigo: 'EDITOR_ARTIFACT',
    patron: /PHOTOSHOP|\bPSD\b|CANVA\.COM|EDITABLE\s+TEMPLATE|PLANTILLA\s+EDITABLE/u,
    descripcion: 'Hay rastros del editor con el que se compuso la imagen.',
  },
  {
    codigo: 'DOCUMENT_NOT_VALID_MARK',
    patron: /NO\s+VALIDO\s+COMO\s+DOCUMENTO|SIN\s+VALOR\s+LEGAL|NOT\s+FOR\s+OFFICIAL\s+USE/u,
    descripcion: 'El propio documento declara por escrito que no tiene validez.',
  },
];
