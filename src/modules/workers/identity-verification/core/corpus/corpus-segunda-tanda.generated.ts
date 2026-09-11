/*
 * ARCHIVO GENERADO — no editar a mano.
 *
 * Derivado de `corpus/corpus-identidad-bo-v2.json` v2.0.0
 * SHA-256 del corpus: 8de7fe6c75115dcdb768e01b85a886ffb56640e9ef8cd48f745b79010584b750
 *
 * Regenerar:  yarn corpus:generar
 * Comprobar:  yarn corpus:check
 */

/** Los hashes de los DOS paquetes de la segunda tanda. Los comprueba una prueba. */
export const HASH_CORPUS_IDENTIDAD_V2 =
  '8de7fe6c75115dcdb768e01b85a886ffb56640e9ef8cd48f745b79010584b750';
export const HASH_CORPUS_EXTRACTOS_V2 =
  'a8099d6875f8eceb5da943d7044caf1bddb81385682231612c2157af8eaf4376';

/**
 * Rótulos de la generación 2023, verificados contra el DS 4924 y con su zona.
 *
 * El catálogo del worker ya llevaba casi todos, escritos a mano. Lo que añade esto es PROCEDENCIA
 * —ahora cada uno se puede citar— y los cuatro que faltaban.
 */
export const ROTULOS_POST_2023: readonly {
  readonly literal: string;
  readonly zona: string;
}[] = [
  { literal: 'ESTADO PLURINACIONAL DE BOLIVIA', zona: 'ANVERSO_SUPERIOR_IZQUIERDA' },
  { literal: 'SERVICIO GENERAL DE IDENTIFICACIÓN PERSONAL', zona: 'ANVERSO_SUPERIOR_IZQUIERDA' },
  { literal: 'CÉDULA DE IDENTIDAD', zona: 'ANVERSO_SUPERIOR_DERECHA' },
  { literal: 'SERIE:', zona: 'ANVERSO_CENTRAL' },
  { literal: 'SECCIÓN:', zona: 'ANVERSO_CENTRAL' },
  { literal: 'NOMBRES:', zona: 'ANVERSO_CENTRAL' },
  { literal: 'APELLIDOS:', zona: 'ANVERSO_CENTRAL' },
  { literal: 'FECHA DE NACIMIENTO:', zona: 'ANVERSO_CENTRAL' },
  { literal: 'FECHA DE EMISIÓN:', zona: 'ANVERSO_CENTRAL' },
  { literal: 'FECHA DE EXPIRACIÓN:', zona: 'ANVERSO_CENTRAL' },
  { literal: 'FIRMA DEL TITULAR', zona: 'ANVERSO_INFERIOR_CENTRAL' },
  { literal: 'LUGAR DE NACIMIENTO:', zona: 'REVERSO_CENTRAL' },
  { literal: 'DOMICILIO:', zona: 'REVERSO_CENTRAL' },
  { literal: 'PROFESIÓN U OCUPACIÓN:', zona: 'REVERSO_CENTRAL' },
  { literal: 'ESTADO CIVIL:', zona: 'REVERSO_CENTRAL' },
  { literal: 'GRUPO SANGUÍNEO:', zona: 'REVERSO_CENTRAL' },
  { literal: 'PADRE:', zona: 'REVERSO_CENTRAL' },
  { literal: 'MADRE:', zona: 'REVERSO_CENTRAL' },
  { literal: 'TUTOR:', zona: 'REVERSO_CENTRAL' },
];

/**
 * La vigencia INDEFINIDA existe, y es la razón por la que una fecha vencida no basta para rechazar.
 *
 * `expiracionImpresa` en `null` significa NO VERIFICADO: no se sabe qué fecha imprimen esas
 * tarjetas. Con ese hueco abierto, un rechazo por caducidad sobre alguien que podría tener una
 * cédula indefinida no se puede defender — y por eso el motor escala en vez de rechazar.
 */
export const VIGENCIA_INDEFINIDA = {
  existe: true,
  aQuien:
    'En ambos formatos: bolivianas y bolivianos desde los 58 años; personas con discapacidad grave y muy grave, según DS 4861, art. 6.IV.',
  expiracionImpresa: null,
  fechasCentinela: [],
  procedencia: 'VERIFICADO',
} as const;

/** La edad desde la que la cédula puede ser indefinida, según el DS 4861 art. 6.IV. */
export const EDAD_DE_VIGENCIA_INDEFINIDA = 58;

/**
 * El QR de la cédula: existe, y su contenido NO está verificado.
 *
 * Era el único hueco capaz de cambiar la arquitectura —con firma verificable, la autenticidad
 * dejaría de depender de umbrales—. La respuesta es que existe en la generación 2023 y que su
 * esquema, su firma y sus claves siguen sin publicarse. Queda escrito para no volver a encargarlo
 * esperando otra cosa.
 */
export const QR_DE_LA_CEDULA = {
  existe: true,
  generaciones: ['POST_2023'],
  codificacion: null,
  firmado: null,
  clavesPublicadas: null,
  verificableSinRed: null,
} as const;

/** Geografía verificada contra el INE. Es una MUESTRA, no el padrón completo. */
export const GEOGRAFIA_VERIFICADA: readonly {
  readonly departamento: string;
  readonly provincia: string | null;
  readonly municipio: string | null;
}[] = [
  { departamento: 'Santa Cruz', provincia: 'Andrés Ibañez', municipio: 'Santa Cruz de la Sierra' },
  { departamento: 'Santa Cruz', provincia: 'Andrés Ibañez', municipio: 'Cotoca' },
  { departamento: 'Santa Cruz', provincia: 'Andrés Ibañez', municipio: 'Porongo' },
  { departamento: 'Santa Cruz', provincia: 'Andrés Ibañez', municipio: 'La Guardia' },
  { departamento: 'Santa Cruz', provincia: 'Andrés Ibañez', municipio: 'El Torno' },
];

/**
 * Historia del ITF con sus vigencias.
 *
 * Toda `INFERIDO`: la abrogación de 2026 está verificada, las alícuotas históricas se reconstruyen
 * de normas secundarias. Sirve para LEER un extracto viejo, nunca para afirmar que una fila es falsa.
 */
export const IMPUESTOS_HISTORICOS: readonly {
  readonly impuesto: string;
  readonly alicuota: number | null;
  /** `null` cuando la vigencia no se pudo fijar. No se sustituye por una fecha plausible. */
  readonly desde: string | null;
  readonly hasta: string | null;
  readonly norma: string;
  readonly procedencia: string;
}[] = [
  {
    impuesto: 'ITF',
    alicuota: 0.003,
    desde: '2004-07-01',
    hasta: '2005-06-30',
    norma: 'Ley 2646, art. 6; DS 27566, art. 1',
    procedencia: 'INFERIDO',
  },
  {
    impuesto: 'ITF',
    alicuota: 0.0025,
    desde: '2005-07-01',
    hasta: '2006-06-30',
    norma: 'Ley 2646, art. 6; DS 27566',
    procedencia: 'INFERIDO',
  },
  {
    impuesto: 'ITF',
    alicuota: 0.0015,
    desde: '2006-07-24',
    hasta: '2009-07-23',
    norma: 'Ley 3446, arts. 1 y 6; DS 28815, art. 2; DS 0199',
    procedencia: 'INFERIDO',
  },
  {
    impuesto: 'ITF',
    alicuota: 0.0015,
    desde: '2009-07-24',
    hasta: '2012-07-23',
    norma: 'PGN 2009, art. 53, referido en DS 0199; Ley 3446, art. 6',
    procedencia: 'INFERIDO',
  },
  {
    impuesto: 'ITF',
    alicuota: 0.0015,
    desde: '2012-07-24',
    hasta: '2014-12-31',
    norma: 'Ley 234, artículo único; Ley 3446, art. 6; Ley 713, art. 2',
    procedencia: 'INFERIDO',
  },
  {
    impuesto: 'ITF',
    alicuota: 0.0015,
    desde: '2015-01-01',
    hasta: '2015-12-31',
    norma: 'Ley 713, arts. 1–2',
    procedencia: 'VERIFICADO',
  },
  {
    impuesto: 'ITF',
    alicuota: 0.002,
    desde: '2016-01-01',
    hasta: '2016-12-31',
    norma: 'Ley 713, arts. 1–2',
    procedencia: 'VERIFICADO',
  },
  {
    impuesto: 'ITF',
    alicuota: 0.0025,
    desde: '2017-01-01',
    hasta: '2017-12-31',
    norma: 'Ley 713, arts. 1–2',
    procedencia: 'VERIFICADO',
  },
  {
    impuesto: 'ITF',
    alicuota: 0.003,
    desde: '2018-01-01',
    hasta: '2018-12-31',
    norma: 'Ley 713, arts. 1–2',
    procedencia: 'VERIFICADO',
  },
  {
    impuesto: 'ITF',
    alicuota: 0.003,
    desde: '2019-01-01',
    hasta: '2023-12-31',
    norma: 'Ley 1135, disposición adicional cuarta.I–III',
    procedencia: 'VERIFICADO',
  },
  {
    impuesto: 'ITF',
    alicuota: 0.003,
    desde: '2024-01-01',
    hasta: '2026-04-09',
    norma: 'Ley 1135; Ley 1546, art. 9.I; abrogación posterior ya versionada en v1',
    procedencia: 'INFERIDO',
  },
  {
    impuesto: 'RC-IVA',
    alicuota: 0.13,
    desde: null,
    hasta: null,
    norma:
      'Ley 843, arts. 19 y 30, según referencias del SIN; reglamentación de retención pendiente de consolidación para cada supuesto.',
    procedencia: 'INFERIDO',
  },
  {
    impuesto: 'IUE',
    alicuota: null,
    desde: null,
    hasta: null,
    norma: 'Ley 843 y reglamentación del IUE: consolidación y supuestos de exención pendientes.',
    procedencia: 'NO_VERIFICADO',
  },
];

/**
 * Lo que la segunda tanda NO pudo resolver, con su motivo.
 *
 * Está aquí y no en un documento porque es la respuesta a la pregunta «¿por qué el worker sigue sin
 * reconocer las glosas del BNB?». La respuesta es que nadie las publica, y ahora se puede citar.
 */
export const HUECOS_SEGUNDA_TANDA: readonly {
  readonly id: string;
  readonly dominio: string;
  readonly requisito: string;
  readonly motivo: string;
}[] = [
  {
    id: 'ID-G04-B',
    dominio: 'identidad',
    requisito:
      'Periodo general de gracia y tratamiento de tarjetas preexistentes al cumplir 58 años',
    motivo:
      'La norma de renovación anticipada no determina gracia. No se verificó la regla operativa que resuelve una fecha finita antigua frente a elegibilidad posterior para vigencia indefinida.',
  },
  {
    id: 'ID-G05-A',
    dominio: 'identidad',
    requisito: 'Gramática formal del número, complemento y dígito de control',
    motivo:
      'La existencia de número y complemento no especifica longitudes, caracteres admitidos, separador ni dígito de control del SEGIP.',
  },
  {
    id: 'ID-G06',
    dominio: 'identidad',
    requisito: 'Matriz de confusiones y delta de precisión de preprocesamientos',
    motivo:
      'La documentación oficial no proporciona una matriz cuantificada para Tesseract 5.x spa sobre texto boliviano de 1–2 mm. Los nueve registros son condiciones experimentales propuestas, no resultados.',
  },
  {
    id: 'ID-G-INGESTA',
    dominio: 'identidad',
    requisito: 'Ingesta de estos JSON mediante yarn corpus:generar y corpus:check',
    motivo:
      'El generador consultado consume nombres y módulos v1; no se implementó adaptador v2 ni se ejecutaron los comandos del repositorio.',
  },
  {
    id: 'EX-G01-01',
    dominio: 'extractos',
    requisito: 'Glosas literales oficiales de Banco Nacional de Bolivia S.A.',
    motivo:
      'Portal y ficha de app; no catálogo literal de transacciones publicado recuperado. No encontrar un glosario en esta consulta no acredita que no exista.',
  },
  {
    id: 'EX-G01-02',
    dominio: 'extractos',
    requisito: 'Glosas literales oficiales de Banco Mercantil Santa Cruz S.A.',
    motivo:
      'Se localizaron canales de banca; apertura web falló con 502. Manuales copiados en sitios de terceros excluidos. No encontrar un glosario en esta consulta no acredita que no exista.',
  },
  {
    id: 'EX-G01-03',
    dominio: 'extractos',
    requisito: 'Glosas literales oficiales de Banco Unión S.A.',
    motivo:
      'El manual describe consultas y campos de glosa introducidos por quien transfiere. No se confirmó un diccionario de glosas emitidas. No encontrar un glosario en esta consulta no acredita que no exista.',
  },
  {
    id: 'EX-G01-04',
    dominio: 'extractos',
    requisito: 'Glosas literales oficiales de Banco Ganadero S.A.',
    motivo:
      'Instructivo y descarga PDF localizados. Los conceptos en requisitos de tarjetas describen extractos presentados, no un glosario del emisor. No encontrar un glosario en esta consulta no acredita que no exista.',
  },
  {
    id: 'EX-G01-05',
    dominio: 'extractos',
    requisito: 'Glosas literales oficiales de Banco Económico S.A.',
    motivo:
      'Información de banca móvil; no diccionario de los literales impresos recuperado. No encontrar un glosario en esta consulta no acredita que no exista.',
  },
  {
    id: 'EX-G01-06',
    dominio: 'extractos',
    requisito: 'Glosas literales oficiales de Banco Solidario S.A.',
    motivo:
      'Solnet permite consultar/descargar; la descripción del servicio no documenta glosas exactas. No encontrar un glosario en esta consulta no acredita que no exista.',
  },
  {
    id: 'EX-G01-07',
    dominio: 'extractos',
    requisito: 'Glosas literales oficiales de Banco Fortaleza S.A.',
    motivo:
      'Canales con consultas y extractos; no diccionario literal recuperado. No encontrar un glosario en esta consulta no acredita que no exista.',
  },
  {
    id: 'EX-G01-08',
    dominio: 'extractos',
    requisito: 'Glosas literales oficiales de Banco Prodem S.A.',
    motivo:
      'Portal respondió 403; publicación de guía localizada, pero descarga enlazada no recuperada. No encontrar un glosario en esta consulta no acredita que no exista.',
  },
  {
    id: 'EX-G01-09',
    dominio: 'extractos',
    requisito: 'Glosas literales oficiales de Banco para el Fomento a Iniciativas Económicas S.A.',
    motivo:
      'Página de cuenta corriente describe disponibilidad de extractos; no catálogo literal. No encontrar un glosario en esta consulta no acredita que no exista.',
  },
  {
    id: 'EX-G01-10',
    dominio: 'extractos',
    requisito: 'Glosas literales oficiales de Tigo Money (operado por E-FECTIVO ESPM)',
    motivo:
      'Ayuda oficial de obtención de extractos, no glosario. El operador se conserva según el encargo; no se inventa sigla de padrón. No encontrar un glosario en esta consulta no acredita que no exista.',
  },
  {
    id: 'EX-G01-11',
    dominio: 'extractos',
    requisito: 'Glosas literales oficiales de Yolo Pago',
    motivo:
      'Marca resuelta a Banco Ganadero; no se transfieren automáticamente las glosas de otra marca o canal. No encontrar un glosario en esta consulta no acredita que no exista.',
  },
  {
    id: 'EX-G01-12',
    dominio: 'extractos',
    requisito: 'Glosas literales oficiales de Billetera Móvil',
    motivo:
      'Denominación genérica sin emisor, marca ni app inequívocos. No se la equipara a BNB ni a otra billetera. No encontrar un glosario en esta consulta no acredita que no exista.',
  },
  {
    id: 'EX-G07-C',
    dominio: 'extractos',
    requisito: 'Tope ASFI vigente de tasa de crédito de consumo',
    motivo:
      'Se recuperó la portada oficial, no el texto consolidado que permitiría identificar un límite, sus productos y vigencia.',
  },
  {
    id: 'EX-G07-D',
    dominio: 'extractos',
    requisito: 'Piso de subsistencia 2026 por hogar y ciudad',
    motivo:
      'Sólo se recuperó metodología; faltan monto actual, periodo, dominio geográfico y hogar de referencia.',
  },
  {
    id: 'EX-G08',
    dominio: 'extractos',
    requisito: 'Cadenas legítimas Producer/Creator por emisor',
    motivo:
      'No se inspeccionaron PDF originales de estados de cuenta por emisor. No hay cadenas Producer/Creator verificadas para añadir.',
  },
  {
    id: 'EX-G-INGESTA',
    dominio: 'extractos',
    requisito: 'Ingesta de estos JSON mediante yarn corpus:generar y corpus:check',
    motivo:
      'El generador consultado consume nombres y módulos v1; no se implementó adaptador v2 ni se ejecutaron los comandos del repositorio.',
  },
];
