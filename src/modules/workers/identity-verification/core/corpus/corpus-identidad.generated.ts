/*
 * ARCHIVO GENERADO — no editar a mano.
 *
 * Derivado de `corpus/corpus-identidad-bo.json` v1.0.0
 * SHA-256 del corpus: 434d2f7fcaefa05ba00c69a0003674b364be9eadb3cfc827e1921abb763af925
 *
 * Regenerar:  yarn corpus:generar
 * Comprobar:  yarn corpus:check
 */

/** El hash del corpus del que salió este archivo. Lo comprueba una prueba. */
export const HASH_DEL_CORPUS_IDENTIDAD =
  '434d2f7fcaefa05ba00c69a0003674b364be9eadb3cfc827e1921abb763af925';

/**
 * Lo que el corpus de identidad dice DE SÍ MISMO.
 *
 * Las tres banderas de arriba son el motivo por el que este worker no aprueba
 * solo: no es un modelo entrenado, no es una certificación y no es una
 * calibración de producción. Lo declara su propio manifiesto, y el código lo
 * respeta negándose a convertir cualquiera de sus números en un rechazo
 * automático.
 */
export const PROCEDENCIA_CORPUS_IDENTIDAD = {
  titulo: 'Corpus de verificación de identidad, cotejo facial y PAD — Bolivia',
  version: '1.0.0',
  generadoEl: '2026-09-10',
  noEsModeloEntrenado: true,
  noEsCertificacion: true,
  noEsCalibracionDeProduccion: true,
  imagenesRealesEnElPaquete: 0,
  semanticaDeNulos: 'No verificado, no medido o no disponible; ver status y reason de la sección.',
  limitaciones: [
    'Se utilizó el encargo adjunto y consulta pública complementaria. No se recibió el informe de la sesión de Investigación profunda.',
    'El corpus de 23 cédulas permanece fuera del paquete; no fue visto ni medido por este trabajo.',
    'Licencias y especificaciones pendientes se representan como null y bloquean su uso automático; no significan permiso ni fraude.',
    'Los números de resultados publicados corresponden a sus poblaciones originales. Ninguno sustituye una medición del worker.',
  ],
} as const;

/**
 * Lo que el encargo pidió NO volver a introducir.
 *
 * Cada una de estas cinco cosas estuvo en el worker y cada una producía la misma
 * clase de error: una afirmación fuerte sobre una persona apoyada en una medida
 * que no la sostiene.
 */
export const NO_REINTRODUCIR: readonly string[] = [
  'Regla dura de vigencia fija 5/10 años',
  'Recorte por color de píxel',
  'Umbral biométrico de dibujos',
  'Arbitraje automático no implementado',
  'Ausencia de metadatos interpretada como fraude',
];

/**
 * La política de producción del corpus. Es el contrato de este worker.
 *
 * `SHADOW_REVIEW` con las dos automatizaciones apagadas, y cada umbral en
 * `null` porque ninguno está calibrado. La lista de lo que exige CUALQUIER
 * umbral antes de encenderse es la parte que se salta todo el mundo, y por eso
 * viaja al código.
 */
export const POLITICA_DE_PRODUCCION = {
  modo: 'SHADOW_REVIEW',
  aceptacionAutomatica: false,
  rechazoAutomaticoPorFraude: false,
  cotejo: {
    umbralDeAceptacion: null,
    umbralDeRechazo: null,
    huellaDelModelo: null,
    idDeCalibracion: null,
  },
  pad: {
    umbralDeAceptacion: null,
    umbralDeRechazo: null,
    fusion: 'UNSET_PENDING_COMPARISON',
    idDeCalibracion: null,
  },
  forense: {
    rechazoDuro: false,
    senalesSinCalibrar: 'LOG_ONLY',
  },
  senalAusente: 'UNKNOWN_NOT_FAILURE_NOT_FRAUD',
  tipoDeDocumentoNoAdmitido: 'UNSUPPORTED_OR_RECAPTURE',
  documentoIlegible: 'RECAPTURE_OR_REVIEW',
  mismosBytesEnDosPapeles: 'RECAPTURE_OR_REVIEW',
  parecidoPorEncimaDe097: 'NO_AUTOMATIC_FRAUD',
  controlDeMrzFallido: 'REVIEW_OR_RECAPTURE',
  qrNoDecodificable: 'NOT_EVALUABLE',
  todoUmbralExige: [
    'población y manifiesto de particiones',
    'hash del modelo',
    'dominio de captura',
    'prueba con umbral congelado',
    'FMR/FNMR/APCER/BPCER según componente',
    'CI y clustering',
    'evaluación por subgrupos',
    'responsable de aprobación y fecha',
  ],
} as const;

/**
 * Los rótulos LEGALES de la cédula del rediseño (DS 4924).
 *
 * Fechas que no hay que confundir, y el corpus las separa en dos campos por la
 * contradicción C01: el decreto es del 2023-04-26 y la emisión empieza el
 * 2023-11-01.
 *
 * `accionSiFalta` dice lo mismo en los veinte: **NO ACUSAR**. Un rótulo que el
 * reconocedor no leyó se registra como ilegible o ausente, no como indicio de
 * falsificación — y eso vale aunque falten varios, porque lo que suele faltar no
 * es el rótulo sino la resolución.
 */
export interface RotuloLegal {
  readonly orden: number;
  readonly id: string;
  readonly literal: string;
  readonly posicion: string;
  readonly cara: 'ANVERSO' | 'REVERSO';
  readonly accionSiFalta: string;
}

export const ROTULOS_DS4924: readonly RotuloLegal[] = [
  {
    orden: 1,
    id: 'country_header',
    literal: 'ESTADO PLURINACIONAL DE BOLIVIA',
    posicion: 'superior izquierda',
    cara: 'ANVERSO',
    accionSiFalta: 'NO_ACUSAR; registrar ilegible/ausente',
  },
  {
    orden: 2,
    id: 'issuer_header',
    literal: 'SERVICIO GENERAL DE IDENTIFICACIÓN PERSONAL',
    posicion: 'superior izquierda',
    cara: 'ANVERSO',
    accionSiFalta: 'NO_ACUSAR; registrar ilegible/ausente',
  },
  {
    orden: 3,
    id: 'document_title',
    literal: 'CÉDULA DE IDENTIDAD',
    posicion: 'superior derecha',
    cara: 'ANVERSO',
    accionSiFalta: 'NO_ACUSAR; registrar ilegible/ausente',
  },
  {
    orden: 4,
    id: 'series',
    literal: 'SERIE:',
    posicion: 'centro',
    cara: 'ANVERSO',
    accionSiFalta: 'NO_ACUSAR; registrar ilegible/ausente',
  },
  {
    orden: 5,
    id: 'section',
    literal: 'SECCIÓN:',
    posicion: 'centro',
    cara: 'ANVERSO',
    accionSiFalta: 'NO_ACUSAR; registrar ilegible/ausente',
  },
  {
    orden: 6,
    id: 'given_names',
    literal: 'NOMBRES:',
    posicion: 'centro',
    cara: 'ANVERSO',
    accionSiFalta: 'NO_ACUSAR; registrar ilegible/ausente',
  },
  {
    orden: 7,
    id: 'surnames',
    literal: 'APELLIDOS:',
    posicion: 'centro',
    cara: 'ANVERSO',
    accionSiFalta: 'NO_ACUSAR; registrar ilegible/ausente',
  },
  {
    orden: 8,
    id: 'birth_date',
    literal: 'FECHA DE NACIMIENTO:',
    posicion: 'centro',
    cara: 'ANVERSO',
    accionSiFalta: 'NO_ACUSAR; registrar ilegible/ausente',
  },
  {
    orden: 9,
    id: 'issue_date',
    literal: 'FECHA DE EMISIÓN:',
    posicion: 'centro',
    cara: 'ANVERSO',
    accionSiFalta: 'NO_ACUSAR; registrar ilegible/ausente',
  },
  {
    orden: 10,
    id: 'expiry_date',
    literal: 'FECHA DE EXPIRACIÓN:',
    posicion: 'centro',
    cara: 'ANVERSO',
    accionSiFalta: 'NO_ACUSAR; registrar ilegible/ausente',
  },
  {
    orden: 11,
    id: 'holder_signature',
    literal: 'FIRMA DEL TITULAR',
    posicion: 'inferior centro',
    cara: 'ANVERSO',
    accionSiFalta: 'NO_ACUSAR; registrar ilegible/ausente',
  },
  {
    orden: 1,
    id: 'birth_place',
    literal: 'LUGAR DE NACIMIENTO:',
    posicion: 'centro',
    cara: 'REVERSO',
    accionSiFalta: 'NO_ACUSAR; registrar ilegible/ausente',
  },
  {
    orden: 2,
    id: 'address',
    literal: 'DOMICILIO:',
    posicion: 'centro',
    cara: 'REVERSO',
    accionSiFalta: 'NO_ACUSAR; registrar ilegible/ausente',
  },
  {
    orden: 3,
    id: 'occupation',
    literal: 'PROFESIÓN U OCUPACIÓN:',
    posicion: 'centro',
    cara: 'REVERSO',
    accionSiFalta: 'NO_ACUSAR; registrar ilegible/ausente',
  },
  {
    orden: 4,
    id: 'civil_status',
    literal: 'ESTADO CIVIL:',
    posicion: 'centro',
    cara: 'REVERSO',
    accionSiFalta: 'NO_ACUSAR; registrar ilegible/ausente',
  },
  {
    orden: 5,
    id: 'blood_group',
    literal: 'GRUPO SANGUÍNEO:',
    posicion: 'centro',
    cara: 'REVERSO',
    accionSiFalta: 'NO_ACUSAR; registrar ilegible/ausente',
  },
  {
    orden: 6,
    id: 'indigenous_affiliation',
    literal: 'NPIOC:',
    posicion: 'centro',
    cara: 'REVERSO',
    accionSiFalta: 'NO_ACUSAR; registrar ilegible/ausente',
  },
  {
    orden: 7,
    id: 'father',
    literal: 'PADRE:',
    posicion: 'centro, menores',
    cara: 'REVERSO',
    accionSiFalta: 'NO_ACUSAR; registrar ilegible/ausente',
  },
  {
    orden: 8,
    id: 'mother',
    literal: 'MADRE:',
    posicion: 'centro, menores',
    cara: 'REVERSO',
    accionSiFalta: 'NO_ACUSAR; registrar ilegible/ausente',
  },
  {
    orden: 9,
    id: 'guardian',
    literal: 'TUTOR:',
    posicion: 'centro, menores',
    cara: 'REVERSO',
    accionSiFalta: 'NO_ACUSAR; registrar ilegible/ausente',
  },
];

/** Límites que la propia norma pone a esa lista. */
export const LIMITES_DE_LOS_ROTULOS: readonly string[] = [
  'El orden es el de enumeración legal; no equivale a orden exacto de lectura de cada píxel.',
  'La norma desarrolla NPIOC en palabras; no se afirma que toda la expansión esté impresa.',
  'Los campos padre/madre/tutor son condicionales; grupo sanguíneo y NPIOC no son requisitos de identidad.',
];

/**
 * Las dos variantes dimensionales, que son DOS y no una (contradicción C04).
 *
 * El DS 4924 fija 85×55 mm y la variante ED-10 del DS 5364 fija
 * 85×54 mm. Por eso `pruebaEstrictaDeProporcion` es `false`: rechazar por la
 * relación de aspecto de una FOTO —que además depende del encuadre— acusaría a
 * una variante legítima.
 */
export const DIMENSIONES = {
  ds4924: { anchoMm: 85, altoMm: 55 },
  ed10: { anchoMm: 85, altoMm: 54, alcance: 'emisión automatizada ED-10; no todas las cédulas' },
  pruebaEstrictaDeProporcion: false,
  mapaPuedeSerHolograma: true,
} as const;

/**
 * La generación anterior, que el corpus deja DELIBERADAMENTE sin rótulos.
 *
 * «El encargo declara un catálogo existente, pero no contiene su transcripción. No se reconstruye inventando rótulos, orden o posiciones del legado.»
 *
 * Su política de vigencia es lo que sí está fijado: «No invalidar por ser legado; el DS4924 mantiene vigencia hasta caducidad y permite agotar material anterior.»
 */
export const GENERACION_LEGADA = {
  politicaDeVigencia:
    'No invalidar por ser legado; el DS4924 mantiene vigencia hasta caducidad y permite agotar material anterior.',
  rotulosOficiales: null,
  exigeMrz: false,
  exigeQr: false,
  catalogoCompleto: false,
  razon:
    'El encargo declara un catálogo existente, pero no contiene su transcripción. No se reconstruye inventando rótulos, orden o posiciones del legado.',
} as const;

/** Rasgos de seguridad y qué puede decir de ellos UNA fotografía. */
export interface RasgoDeSeguridad {
  readonly id: string;
  readonly cara: string;
  readonly visibleEnFotoAmbiente: boolean | string;
  readonly loQuePuedeComprobarUnaFoto: string;
  readonly limitaciones: string;
  readonly resolucionMinimaPublicada: number | null;
}

export const RASGOS_DE_SEGURIDAD: readonly RasgoDeSeguridad[] = [
  {
    id: 'guilloche',
    cara: 'both',
    visibleEnFotoAmbiente: true,
    loQuePuedeComprobarUnaFoto:
      'Presencia y distribución aproximada de líneas y gradiente; señal débil de conformidad.',
    limitaciones:
      'Una reproducción también contiene el patrón; compresión y desenfoque lo destruyen.',
    resolucionMinimaPublicada: null,
  },
  {
    id: 'microtext_department_anthems',
    cara: 'front',
    visibleEnFotoAmbiente: 'CONDICIONAL',
    loQuePuedeComprobarUnaFoto:
      'Localizar zonas y estimar si hay textura fina; lectura literal sólo con resolución suficiente.',
    limitaciones:
      'Texto literal completo y tamaño no publicados en la norma consultada; ausencia en JPEG no demuestra falsedad.',
    resolucionMinimaPublicada: null,
  },
  {
    id: 'microtext_maritime',
    cara: 'front',
    visibleEnFotoAmbiente: 'CONDICIONAL',
    loQuePuedeComprobarUnaFoto: 'Presencia estructural, no autenticación por OCR.',
    limitaciones: 'No se dispone del literal íntegro ni altura de letra.',
    resolucionMinimaPublicada: null,
  },
  {
    id: 'microtext_union',
    cara: 'back',
    visibleEnFotoAmbiente: 'CONDICIONAL',
    loQuePuedeComprobarUnaFoto:
      'Referencia semántica a LA UNIÓN ES LA FUERZA en tres idiomas indígenas.',
    limitaciones: 'Traducciones literales no especificadas en el texto consultado.',
    resolucionMinimaPublicada: null,
  },
  {
    id: 'textile_iconography',
    cara: 'front',
    visibleEnFotoAmbiente: true,
    loQuePuedeComprobarUnaFoto: 'Coincidencia aproximada de organización del diseño.',
    limitaciones: 'No usar identidad cultural representada para deducir etnia de la persona.',
    resolucionMinimaPublicada: null,
  },
  {
    id: 'coat_of_arms',
    cara: 'front',
    visibleEnFotoAmbiente: true,
    loQuePuedeComprobarUnaFoto: 'Presencia visual.',
    limitaciones: 'Una copia puede reproducirlo; no prueba autenticidad.',
    resolucionMinimaPublicada: null,
  },
  {
    id: 'map_cutout_or_hologram',
    cara: 'front',
    visibleEnFotoAmbiente: 'CONDICIONAL',
    loQuePuedeComprobarUnaFoto:
      'Admitir troquelado o holograma según variante; registrar visible/no evaluable.',
    limitaciones:
      'Cambio óptico de holograma no se valida con una sola vista. Mapa ausente por reflejo no significa fraude.',
    resolucionMinimaPublicada: null,
  },
  {
    id: 'unique_security_code',
    cara: 'back',
    visibleEnFotoAmbiente: 'CONDICIONAL',
    loQuePuedeComprobarUnaFoto:
      'Intentar decodificación QR/código cuando sea visible; comparar datos sólo con especificación de payload verificada.',
    limitaciones:
      'Decodificar no autentica; no se halló especificación pública completa de firma, claves y payload.',
    resolucionMinimaPublicada: null,
  },
  {
    id: 'fingerprint_print',
    cara: 'back',
    visibleEnFotoAmbiente: true,
    loQuePuedeComprobarUnaFoto: 'Localización del bloque; no comparación biométrica dactilar.',
    limitaciones: 'Impresión digital visible no demuestra que sea del titular.',
    resolucionMinimaPublicada: null,
  },
  {
    id: 'mrz',
    cara: 'back',
    visibleEnFotoAmbiente: 'CONDICIONAL',
    loQuePuedeComprobarUnaFoto: 'Estructura TD1, alfabeto y dígitos; coherencia con OCR visual.',
    limitaciones: 'Checksum no es firma digital. Campo no leído es NO_EVALUABLE, no FALSO.',
    resolucionMinimaPublicada: null,
  },
  {
    id: 'cultural_art_floral',
    cara: 'both',
    visibleEnFotoAmbiente: true,
    loQuePuedeComprobarUnaFoto: 'Anclas débiles de diseño.',
    limitaciones: 'Variantes o degradación pueden afectar clasificación.',
    resolucionMinimaPublicada: null,
  },
];

/**
 * Lo que NO se puede comprobar con una fotografía, y por tanto NO SE EXIGE.
 *
 * Los siete llegan con `existeEnLaVarianteBoliviana: null` — ni siquiera se
 * estableció que la cédula los tenga. Exigir un rasgo que quizá no existe, sobre
 * un medio que no puede mostrarlo, es la receta exacta de una acusación falsa.
 */
export const NO_VERIFICABLE_EN_FOTO: readonly {
  readonly id: string;
  readonly existeEnLaVarianteBoliviana: boolean | null;
  readonly accion: string;
  readonly razon: string;
}[] = [
  {
    id: 'UV_fluorescence',
    existeEnLaVarianteBoliviana: null,
    accion: 'NO_EXIGIR',
    razon: 'No hay captura UV; ni siquiera se estableció la característica por variante.',
  },
  {
    id: 'NFC_chip',
    existeEnLaVarianteBoliviana: null,
    accion: 'NO_EXIGIR',
    razon: 'No hay lector ni especificación de chip nacional verificada.',
  },
  {
    id: 'OVI_angle_change',
    existeEnLaVarianteBoliviana: null,
    accion: 'NO_EXIGIR',
    razon: 'Una imagen fija no demuestra cambio óptico angular; existencia concreta pendiente.',
  },
  {
    id: 'kinegram',
    existeEnLaVarianteBoliviana: null,
    accion: 'NO_EXIGIR',
    razon: 'No se halló especificación pública de kinegrama para las variantes.',
  },
  {
    id: 'laser_perforation',
    existeEnLaVarianteBoliviana: null,
    accion: 'NO_EXIGIR',
    razon:
      'Troquelado legal no equivale a perforación láser; no se puede renombrar la característica.',
  },
  {
    id: 'ghost_portrait',
    existeEnLaVarianteBoliviana: null,
    accion: 'NO_EXIGIR',
    razon: 'No confirmado por la norma consultada.',
  },
  {
    id: 'tactile_relief',
    existeEnLaVarianteBoliviana: null,
    accion: 'NO_EXIGIR',
    razon: 'No medible en fotografía 2D de luz ambiente.',
  },
];

/**
 * La gramática del número de cédula, que es MÁS CORTA de lo que todo el mundo
 * cree.
 *
 * Tres correcciones, y las tres van contra reglas que parecían obvias:
 *
 * 1. **El complemento NO son dos letras.** El encargo lo describía así; el
 *    Servicio de Impuestos Nacionales lo publica como alfanumérico. Validar
 *    `[A-Z]{2}` rechazaría complementos legítimos (contradicción C02).
 * 2. **La extensión departamental no es oficial.** Son nueve candidatos
 *    reconstruidos, no la tabla del emisor, y por eso no pueden ser motivo de
 *    rechazo (hueco G05).
 * 3. **El número es una CADENA.** Convertirlo a número borra los ceros
 *    iniciales, y no se verificó ninguna longitud mínima ni máxima que permita
 *    rechazar por tamaño (hueco G04).
 */
export const NUMERO_DE_CEDULA = {
  raiz: {
    almacenamiento: 'string',
    longitudMinima: null,
    longitudMaxima: null,
    normalizacion:
      'Conservar ceros; nunca convertir a Number. No rechazar con una longitud no verificada.',
  },
  complemento: {
    obligatorio: false,
    claseDeCaracteres: 'alfanumérico',
    expresionExacta: null,
    reglaDeDosLetras: false,
    separador: '-',
    razon:
      'El encargo lo describe como dos letras; fuentes públicas consultadas dicen alfanumérico. No imponer [A-Z]{2}.',
  },
  extensionDepartamental: {
    exigidaParaAutenticidad: false,
    listaOficialVerificada: false,
    candidatos: [
      { nombre: 'Chuquisaca', candidato: 'CH', verificado: false },
      { nombre: 'La Paz', candidato: 'LP', verificado: false },
      { nombre: 'Cochabamba', candidato: 'CB', verificado: false },
      { nombre: 'Oruro', candidato: 'OR', verificado: false },
      { nombre: 'Potosí', candidato: 'PT', verificado: false },
      { nombre: 'Tarija', candidato: 'TJ', verificado: false },
      { nombre: 'Santa Cruz', candidato: 'SC', verificado: false },
      { nombre: 'Beni', candidato: 'BE', verificado: false },
      { nombre: 'Pando', candidato: 'PD', verificado: false },
    ],
    razon:
      'Tabla RPT038 no obtenida del regulador; candidatos para revisión, no lista oficial ni regla de rechazo.',
  },
  caducidadIndefinida: {
    existeLegalmente: true,
    literalImpresoVerificado: null,
    centinela2049EsNormativo: false,
    razon:
      'DS4861 reconoce vigencia indefinida; no se verificó un literal de impresión ni un centinela ICAO 2049.',
  },
} as const;

/**
 * La especificación TD1 del ICAO Doc 9303 parte 5, transcrita campo a campo.
 *
 * Lo que esta tabla contesta y una implementación de memoria no: qué campos
 * están PROTEGIDOS por un dígito de control y cuáles no. El código del
 * documento, el emisor, el sexo, la nacionalidad y los nombres **no lo están**,
 * así que una discrepancia en ellos es una lectura dudosa del reconocedor, no
 * una incoherencia del documento.
 *
 * `alcance`: Validación estructural y de checksums; no certifica autenticidad ni perfil nacional de emisión.
 */
export interface CampoMrz {
  readonly linea: 1 | 2 | 3;
  readonly desde: number;
  readonly hasta: number;
  readonly longitud: number;
  readonly nombre: string;
  readonly patron: string;
}

export const CAMPOS_MRZ_TD1: readonly CampoMrz[] = [
  { linea: 1, desde: 1, hasta: 2, longitud: 2, nombre: 'document_code', patron: '[ACI][A-Z<]' },
  { linea: 1, desde: 3, hasta: 5, longitud: 3, nombre: 'issuer', patron: '[A-Z<]{3}' },
  { linea: 1, desde: 6, hasta: 14, longitud: 9, nombre: 'document_number', patron: '[A-Z0-9<]{9}' },
  {
    linea: 1,
    desde: 15,
    hasta: 15,
    longitud: 1,
    nombre: 'document_number_check',
    patron: '[0-9<]',
  },
  { linea: 1, desde: 16, hasta: 30, longitud: 15, nombre: 'optional_1', patron: '[A-Z0-9<]{15}' },
  { linea: 2, desde: 1, hasta: 6, longitud: 6, nombre: 'birth_date', patron: '[0-9<]{6}' },
  { linea: 2, desde: 7, hasta: 7, longitud: 1, nombre: 'birth_check', patron: '[0-9]' },
  { linea: 2, desde: 8, hasta: 8, longitud: 1, nombre: 'sex', patron: '[FM<]' },
  { linea: 2, desde: 9, hasta: 14, longitud: 6, nombre: 'expiry_date', patron: '[0-9]{6}' },
  { linea: 2, desde: 15, hasta: 15, longitud: 1, nombre: 'expiry_check', patron: '[0-9]' },
  { linea: 2, desde: 16, hasta: 18, longitud: 3, nombre: 'nationality', patron: '[A-Z<]{3}' },
  { linea: 2, desde: 19, hasta: 29, longitud: 11, nombre: 'optional_2', patron: '[A-Z0-9<]{11}' },
  { linea: 2, desde: 30, hasta: 30, longitud: 1, nombre: 'composite_check', patron: '[0-9]' },
  { linea: 3, desde: 1, hasta: 30, longitud: 30, nombre: 'name', patron: '[A-Z<]{30}' },
];

export const MRZ_TD1 = {
  lineas: 3,
  caracteresPorLinea: 30,
  alfabeto: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
  relleno: '<',
  /** Campos que NINGÚN dígito de control protege. */
  noProtegidos: ['document code', 'issuer', 'sex', 'nationality', 'names'],
  control: {
    modulo: 10,
    pesos: [7, 3, 1],
    algoritmo: 'sum(value(c[i])*weights[i%3]) % 10',
    reinicioDePesos:
      'Desde 7 al comenzar cada cadena de checksum, no en cada segmento del compuesto.',
    compuesto: 'line1.slice(5,30) + line2.slice(0,7) + line2.slice(8,15) + line2.slice(18,29)',
    ejemplos: [
      { input: '520727', check: '3' },
      { input: 'AB2134<<<', check: '5' },
    ],
  },
  desbordeDelNumero: {
    disparador: 'L1 posición15 = <',
    significado: 'Número documental >9 caracteres, no checksum cero ni automáticamente inválido.',
    algoritmo:
      'Primeros9 caracteres L1[6:14]; continuación al principio del opcional L1[16:30], seguida por dígito de control del número completo y <. Conservar resto de opcional si lo hay.',
    siNoSePuedeInterpretar: 'REVISIÓN; conservar raw',
  },
  codigoDeDocumento: {
    primerCaracter: ['A', 'C', 'I'],
    segundoCaracterProhibido: 'V',
    parProhibido: 'AI',
    parReservado: 'AC',
    alcanceDelParReservado: 'Sólo certificado de miembro de tripulación; no cédula nacional',
    parBolivianoVerificado: null,
  },
  fechas: {
    codificacion: 'YYMMDD',
    siglo:
      'No está en MRZ; resolver sólo con datos visuales y contexto del emisor, no asumir siempre20YY.',
    elementosDesconocidos: 'Preservar < en posiciones desconocidas; no fabricar fecha completa.',
    caducidad2049: {
      value: null,
      status: 'NO_ENCONTRADO',
      action: 'Nunca convertir 49xxxx a indefinido por defecto.',
    },
    caducidadDesconocida:
      'REVISIÓN; ninguna fecha con < se transforma en indefinida sin perfil del emisor.',
  },
  nacionalidad: {
    emisorBolivia: 'BOL',
    nacionalidadBolivia: 'BOL',
    unExtranjeroPuedeTenerOtra: true,
  },
  reparacionOcr: {
    sustitucionesGlobalesAutomaticas: false,
    metodo:
      'Proponer hipótesis por campo y comprobar dígitos; registrar original, cambio y ambigüedad.',
    pasarElControlNoDemuestraAutenticidad: false,
    variasHipotesisValidas: 'REVISIÓN',
  },
  separadorDeNombres: '<<',
  particulasDelNombre:
    'No eliminar DE/DEL/DE<LA automáticamente; conservar estructura según emisor.',
} as const;

/** Transliteración ICAO: de una letra acentuada a lo que puede aparecer en la MRZ. */
export const TRANSLITERACION_MRZ: readonly (readonly [string, readonly string[]])[] = [
  ['Ñ', ['N', 'NXX']],
  ['Á', ['A']],
  ['À', ['A']],
  ['Â', ['A']],
  ['Ã', ['A']],
  ['É', ['E']],
  ['È', ['E']],
  ['Ê', ['E']],
  ['Ë', ['E']],
  ['Í', ['I']],
  ['Ì', ['I']],
  ['Î', ['I']],
  ['Ï', ['I']],
  ['Ó', ['O']],
  ['Ò', ['O']],
  ['Ô', ['O']],
  ['Õ', ['O']],
  ['Ú', ['U']],
  ['Ù', ['U']],
  ['Û', ['U']],
  ['Ü', ['UE', 'UXX', 'U']],
  ['Ä', ['AE', 'A']],
  ['Å', ['AA', 'A']],
  ['Æ', ['AE']],
  ['Ç', ['C']],
  ['Ö', ['OE', 'O']],
  ['Ø', ['OE']],
  ['Ý', ['Y']],
  ['Þ', ['TH']],
];

/**
 * Confusiones candidatas del reconocedor, SIN frecuencias.
 *
 * El corpus es tajante: no existe matriz de confusión medida para esta versión
 * de Tesseract, este idioma, este canal y este documento (hueco G09). Son
 * hipótesis de ENSAYO —cada una se propone y se comprueba contra el dígito de
 * control— y jamás sustituciones globales automáticas.
 */
export const CONFUSIONES_OCR_CANDIDATAS: readonly (readonly [string, string])[] = [
  ['0', 'O'],
  ['O', '0'],
  ['1', 'I'],
  ['I', '1'],
  ['1', 'L'],
  ['2', 'Z'],
  ['5', 'S'],
  ['8', 'B'],
  ['<', 'K'],
  ['<', ' '],
  ['Ñ', 'N'],
  ['rn', 'm'],
];

/** Preprocesados propuestos, todos con el mismo estado: ensayar, no aplicar a ciegas. */
export const PREPROCESADOS_PROPUESTOS = [
  {
    operacion: 'orientation_search',
    proposito: 'Buscar0/90/180/270 y conservar hipótesis; comparación de cobertura por generación.',
    estado: 'ENSAYAR_NO_APLICAR_CIEGAMENTE',
    efectoPublicado: null,
  },
  {
    operacion: 'perspective_rectification',
    proposito:
      'Rectificar cuadrilátero, conservar original para forense; sharp requiere que la transformación sea implementada por módulo adecuado.',
    estado: 'ENSAYAR_NO_APLICAR_CIEGAMENTE',
    efectoPublicado: null,
  },
  {
    operacion: 'deskew',
    proposito: 'Alinear líneas; no confundir inclinación con perspectiva.',
    estado: 'ENSAYAR_NO_APLICAR_CIEGAMENTE',
    efectoPublicado: null,
  },
  {
    operacion: 'adaptive_binarization',
    proposito: 'Comparar gris, Otsu y Sauvola sobre ROIs de texto, no borrar imagen forense.',
    estado: 'ENSAYAR_NO_APLICAR_CIEGAMENTE',
    efectoPublicado: null,
  },
  {
    operacion: 'glare_quality_mask',
    proposito:
      'Marcar saturación/reflejo y solicitar nueva captura, no alucinar texto eliminado por brillo.',
    estado: 'ENSAYAR_NO_APLICAR_CIEGAMENTE',
    efectoPublicado: null,
  },
  {
    operacion: 'rescale',
    proposito: 'Reescalar puede mejorar segmentación; no recupera detalle perdido.',
    estado: 'ENSAYAR_NO_APLICAR_CIEGAMENTE',
    efectoPublicado: null,
  },
  {
    operacion: 'page_dewarping',
    proposito: 'No aplicar a tarjeta plana sin evidencia de curvatura.',
    estado: 'ENSAYAR_NO_APLICAR_CIEGAMENTE',
    efectoPublicado: null,
  },
  {
    operacion: 'segmentation_mode',
    proposito:
      'Separar líneas MRZ y bloques impresos; configurar PSM específico y alfabeto permitido.',
    estado: 'ENSAYAR_NO_APLICAR_CIEGAMENTE',
    efectoPublicado: null,
  },
] as const;

/** Resolución: la recomendación general de Tesseract y su conversión a píxeles. */
export const RESOLUCION = {
  dpiRecomendado: 300,
  alcance:
    'Recomendación general Tesseract para documentos; no umbral biométrico ni garantía sobre mensajería.',
  ladoLargoPara85mmA300dpi: 1003.9370078740159,
  ladoLargoMinimoParaMrz: null,
  ampliarNoCreaEvidencia: true,
} as const;

/**
 * Los otros documentos con foto que llegan a un flujo de identidad.
 *
 * Los seis con la MISMA acción: clasificar como otro o mandar a revisión, y
 * **NO FRAUDE**. Una licencia de conducir boliviana es un documento excelente
 * que este flujo no admite; decirle a quien la subió que su documento es falso
 * es mentir sobre el motivo, y el motivo es lo único que le dice qué hacer.
 */
export interface OtroDocumento {
  readonly id: string;
  readonly nombre: string;
  readonly anclajes: readonly string[];
  readonly anclajeExclusivoVerificado: boolean;
  readonly accion: string;
  readonly notas: string;
}

export const OTROS_DOCUMENTOS: readonly OtroDocumento[] = [
  {
    id: 'BO_DL',
    nombre: 'Licencia de conducir boliviana',
    anclajes: ['LICENCIA PARA CONDUCIR', 'LICENCIA DE CONDUCIR'],
    anclajeExclusivoVerificado: false,
    accion: 'CLASIFICAR_OTRO_O_REVISION; NO_FRAUDE',
    notas: 'Candidato discriminante: licencia/categoría. Ancla SEGIP no exclusiva.',
  },
  {
    id: 'BO_PASSPORT',
    nombre: 'Pasaporte boliviano',
    anclajes: ['PASAPORTE', 'PASSPORT'],
    anclajeExclusivoVerificado: false,
    accion: 'CLASIFICAR_OTRO_O_REVISION; NO_FRAUDE',
    notas: 'Prefijo P de TD3 es pista de familia documental, no de nacionalidad ni autenticidad.',
  },
  {
    id: 'BO_FOREIGN_CI',
    nombre: 'Cédula de identidad de extranjero',
    anclajes: ['CÉDULA DE IDENTIDAD DE EXTRANJERO'],
    anclajeExclusivoVerificado: false,
    accion: 'CLASIFICAR_OTRO_O_REVISION; NO_FRAUDE',
    notas: 'Reconocer EXTRANJERO; no confundir nacionalidad del titular con emisor BOL.',
  },
  {
    id: 'BO_FOREIGN_CARD',
    nombre: 'Carnet de extranjería / constancia migratoria',
    anclajes: ['EXTRANJERÍA', 'MIGRACIÓN'],
    anclajeExclusivoVerificado: false,
    accion: 'CLASIFICAR_OTRO_O_REVISION; NO_FRAUDE',
    notas: 'No se estableció equivalencia normativa con CIE ni una sola generación.',
  },
  {
    id: 'BO_BIRTH_CERT',
    nombre: 'Certificado de nacimiento',
    anclajes: ['CERTIFICADO DE NACIMIENTO', 'SERECI'],
    anclajeExclusivoVerificado: false,
    accion: 'CLASIFICAR_OTRO_O_REVISION; NO_FRAUDE',
    notas: 'Foto y número no bastan; certificado de nacimiento no acredita prueba de vida.',
  },
  {
    id: 'BO_OTHER_PHOTO',
    nombre: 'Credenciales y documentos con foto/número',
    anclajes: [],
    anclajeExclusivoVerificado: false,
    accion: 'CLASIFICAR_OTRO_O_REVISION; NO_FRAUDE',
    notas: 'Mantener clase OTRO/NO_SOPORTADO; no fraude.',
  },
];

/**
 * Las señales estáticas de prueba de vida que caben en UNA fotografía.
 *
 * Las catorce llegan con la misma `accionEnProduccion`: evidencia auxiliar o
 * revisión, **nunca rechazo duro**. Y con el mismo `estadoDeLaEvidencia`: no se
 * encontró tasa transferible al dominio de este worker. Sus
 * `falsosPositivos` son lo que explica por qué: piel grasa, gafas, un flash
 * legítimo, el laminado auténtico de la propia cédula.
 */
export interface SenalPad {
  readonly id: string;
  readonly mide: string;
  readonly implementacion: string;
  readonly falsosPositivos: readonly string[];
  readonly tasaDeDeteccionPublicada: number | null;
  readonly bpcerPublicado: number | null;
  readonly estadoDeLaEvidencia: string;
  readonly accionEnProduccion: string;
}

export const SENALES_PAD: readonly SenalPad[] = [
  {
    id: 'moire_fft',
    mide: 'Periodicidad espacial y picos direccionales',
    implementacion:
      'ROI de rostro y contexto; gris; ventana; FFT2D; quitar DC; guardar picos/energías sin corte heredado.',
    falsosPositivos: [
      'Patrones de ropa',
      'cabello',
      'guilloché del documento auténtico',
      'submuestreo y reescalado',
    ],
    tasaDeDeteccionPublicada: null,
    bpcerPublicado: null,
    estadoDeLaEvidencia: 'NO_TASA_TRANSFERIBLE_ENCONTRADA',
    accionEnProduccion: 'EVIDENCIA_AUXILIAR_O_REVISION; no rechazo duro',
  },
  {
    id: 'specular_distribution',
    mide: 'Regiones saturadas y distribución de reflejos',
    implementacion:
      'Máscara de saturación y estadísticas espaciales; diferenciar calidad de etiqueta de ataque.',
    falsosPositivos: ['piel húmeda/grasa', 'gafas', 'flash legítimo', 'laminado auténtico'],
    tasaDeDeteccionPublicada: null,
    bpcerPublicado: null,
    estadoDeLaEvidencia: 'NO_TASA_TRANSFERIBLE_ENCONTRADA',
    accionEnProduccion: 'EVIDENCIA_AUXILIAR_O_REVISION; no rechazo duro',
  },
  {
    id: 'screen_banding',
    mide: 'Periodicidad entre filas/columnas de luminancia',
    implementacion: 'Perfil de intensidad, autocorrelación y FFT1D; conservar contexto.',
    falsosPositivos: ['luz LED', 'persianas', 'rolling shutter legítimo', 'compresión'],
    tasaDeDeteccionPublicada: null,
    bpcerPublicado: null,
    estadoDeLaEvidencia: 'NO_TASA_TRANSFERIBLE_ENCONTRADA',
    accionEnProduccion: 'EVIDENCIA_AUXILIAR_O_REVISION; no rechazo duro',
  },
  {
    id: 'frame_hands_device',
    mide: 'Contornos y posible objeto que contiene el rostro',
    implementacion:
      'Detectores/segmentación o contornos; registrar confianza y oclusión; no penalizar una mano aislada.',
    falsosPositivos: [
      'gafas',
      'marcos de puertas',
      'usuario sosteniendo documento',
      'funda del propio teléfono',
    ],
    tasaDeDeteccionPublicada: null,
    bpcerPublicado: null,
    estadoDeLaEvidencia: 'NO_TASA_TRANSFERIBLE_ENCONTRADA',
    accionEnProduccion: 'EVIDENCIA_AUXILIAR_O_REVISION; no rechazo duro',
  },
  {
    id: 'skin_lbp_texture',
    mide: 'Histogramas de comparación local de intensidad',
    implementacion:
      'LBP uniforme por bloques/ROI normalizada; requiere clasificador calibrado, no distancia a un dibujo.',
    falsosPositivos: [
      'reducción de resolución',
      'edad/textura de piel',
      'barba',
      'maquillaje',
      'enfoque',
      'mensajería',
    ],
    tasaDeDeteccionPublicada: null,
    bpcerPublicado: null,
    estadoDeLaEvidencia: 'NO_TASA_TRANSFERIBLE_ENCONTRADA',
    accionEnProduccion: 'EVIDENCIA_AUXILIAR_O_REVISION; no rechazo duro',
  },
  {
    id: 'color_chrominance',
    mide: 'Distribución y textura cromática HSV/YCbCr',
    implementacion:
      'Color-LBP o estadísticas de crominancia en ROI; validar por cámara e iluminación.',
    falsosPositivos: ['balance de blancos', 'tonos de piel', 'luz de color', 'cámaras distintas'],
    tasaDeDeteccionPublicada: null,
    bpcerPublicado: null,
    estadoDeLaEvidencia: 'NO_TASA_TRANSFERIBLE_ENCONTRADA',
    accionEnProduccion: 'EVIDENCIA_AUXILIAR_O_REVISION; no rechazo duro',
  },
  {
    id: 'jpeg_recompression_ela',
    mide: 'Inconsistencias de compresión, no vida biológica',
    implementacion:
      'Comparar bloque/ruido o recomprimir sólo una copia de análisis; conservar original y parámetros.',
    falsosPositivos: [
      'reenvío legítimo',
      'edición de exposición',
      'capturas de mensajería',
      'diferencias naturales textura',
    ],
    tasaDeDeteccionPublicada: null,
    bpcerPublicado: null,
    estadoDeLaEvidencia: 'NO_TASA_TRANSFERIBLE_ENCONTRADA',
    accionEnProduccion: 'EVIDENCIA_AUXILIAR_O_REVISION; no rechazo duro',
  },
  {
    id: 'metadata',
    mide: 'Declaraciones editables del contenedor',
    implementacion:
      'Parsear de forma segura; registrar presencia; jamás exigir EXIF tras mensajería.',
    falsosPositivos: [
      'metadatos eliminados por canal',
      'apps sin EXIF',
      'fechas de dispositivo erróneas',
    ],
    tasaDeDeteccionPublicada: null,
    bpcerPublicado: null,
    estadoDeLaEvidencia: 'NO_TASA_TRANSFERIBLE_ENCONTRADA',
    accionEnProduccion: 'EVIDENCIA_AUXILIAR_O_REVISION; no rechazo duro',
  },
  {
    id: 'monocular_depth_estimate',
    mide: 'Prior aprendido de forma 3D desde imagen2D, no profundidad medida',
    implementacion: 'Modelo monocular o pseudo-depth entrenado PAD; no presentarlo como sensor3D.',
    falsosPositivos: [
      'cara impresa verosímil',
      'máscara3D',
      'pose/iluminación fuera del entrenamiento',
    ],
    tasaDeDeteccionPublicada: null,
    bpcerPublicado: null,
    estadoDeLaEvidencia: 'NO_TASA_TRANSFERIBLE_ENCONTRADA',
    accionEnProduccion: 'EVIDENCIA_AUXILIAR_O_REVISION; no rechazo duro',
  },
  {
    id: 'generated_face_detection',
    mide: 'Artefactos estadísticos de una familia de generadores',
    implementacion:
      'Modelo forense evaluado contra generadores no vistos y recomprensión; status desconocido si dominio nuevo.',
    falsosPositivos: [
      'retoque legítimo',
      'filtros belleza',
      'compresión',
      'cámara fuera de dominio',
    ],
    tasaDeDeteccionPublicada: null,
    bpcerPublicado: null,
    estadoDeLaEvidencia: 'NO_TASA_TRANSFERIBLE_ENCONTRADA',
    accionEnProduccion: 'EVIDENCIA_AUXILIAR_O_REVISION; no rechazo duro',
  },
  {
    id: 'copy_move_blocks',
    mide: 'Bloques o regiones duplicadas dentro de imagen',
    implementacion:
      'Descriptores/búsqueda de vecinos; descartar repeticiones de fondo y textura esperables.',
    falsosPositivos: [
      'guilloché repetitivo',
      'texto repetido',
      'áreas uniformes',
      'simetría facial',
    ],
    tasaDeDeteccionPublicada: null,
    bpcerPublicado: null,
    estadoDeLaEvidencia: 'NO_TASA_TRANSFERIBLE_ENCONTRADA',
    accionEnProduccion: 'EVIDENCIA_AUXILIAR_O_REVISION; no rechazo duro',
  },
  {
    id: 'typography_layout',
    mide: 'Geometría de rótulos y consistencia tipográfica',
    implementacion:
      'Medir sólo campos con OCR fiable y comparación por generación; calibrar variaciones genuinas.',
    falsosPositivos: ['perspectiva', 'fuentes/versiones legítimas', 'blur', 'aliasing'],
    tasaDeDeteccionPublicada: null,
    bpcerPublicado: null,
    estadoDeLaEvidencia: 'NO_TASA_TRANSFERIBLE_ENCONTRADA',
    accionEnProduccion: 'EVIDENCIA_AUXILIAR_O_REVISION; no rechazo duro',
  },
  {
    id: 'byte_identity',
    mide: 'Reutilización exacta del mismo archivo',
    implementacion:
      'SHA-256 de entrada/bytes; distinguir fallo de envío o asignación de campos de fraude.',
    falsosPositivos: [
      'usuario adjunta mismo archivo por error',
      'error del cliente al asignar roles',
    ],
    tasaDeDeteccionPublicada: null,
    bpcerPublicado: null,
    estadoDeLaEvidencia: 'NO_TASA_TRANSFERIBLE_ENCONTRADA',
    accionEnProduccion: 'EVIDENCIA_AUXILIAR_O_REVISION; no rechazo duro',
  },
  {
    id: 'extreme_face_similarity',
    mide: 'Score alto del matcher',
    implementacion:
      'Registrar score sin afirmar vida/fraude; diferenciar misma imagen de capturas muy similares.',
    falsosPositivos: [
      'misma sesión/captura legítima',
      'escala saturada',
      'modelo que mapea muchas muestras al techo',
    ],
    tasaDeDeteccionPublicada: null,
    bpcerPublicado: null,
    estadoDeLaEvidencia: 'NO_TASA_TRANSFERIBLE_ENCONTRADA',
    accionEnProduccion: 'EVIDENCIA_AUXILIAR_O_REVISION; no rechazo duro',
  },
];

/**
 * Lo que UNA SOLA IMAGEN no puede demostrar, se mire como se mire.
 *
 * No es una limitación del worker: es una propiedad del medio. Un fotograma no
 * contiene tiempo, así que no contiene pulso, ni parpadeo, ni paralaje, ni la
 * respuesta a un reto.
 */
export const IMPOSIBLE_CON_UN_SOLO_FOTOGRAMA: readonly string[] = [
  'medir pulso temporal',
  'observar parpadeo como evento',
  'probar micromovimiento',
  'observar paralaje',
  'verificar secuencia reto-respuesta',
  'demostrar sincronización con iluminación activa',
];

/** Los cortes de vida que traía el motor, con su estado real. */
export const CORTES_DE_VIDA_ACTUALES = {
  aceptar: 0.55,
  rechazar: 0.35,
  poblacion: 'ninguna calibración real declarada',
  estado: 'NO_USAR_COMO_RECHAZO_AUTOMATICO',
  direccionDelScore:
    'Confirmar mayor=vida para CADA red antes de combinar; score no es necesariamente probabilidad.',
  fusionMinima: 'L=min(L1, L2); bona fide sólo si ambas >=t',
  independenciaVerificada: false,
} as const;

/**
 * El umbral de similitud biométrica: **bloqueado**.
 *
 * «Un par genuino con puntuación 0.693 no determina la cola impostora ni el FNMR poblacional.»
 *
 * Un par genuino medido y cero pares impostores no determinan nada. Los
 * resultados publicados que el corpus recoge —DocFace, DocFace+, CHIYA— vienen
 * con `transferable_to_worker: false` y por un motivo concreto: su referencia
 * es un retrato extraído del CHIP, no una fotografía de una tarjeta plastificada
 * bajo un reflejo.
 */
export const UMBRAL_BIOMETRICO = {
  valor: null,
  estado: 'BLOQUEADO_SIN_CALIBRACION',
  paresGenuinosMedidos: 1,
  paresImpostoresMedidos: 0,
  razon:
    'Un par genuino con puntuación 0.693 no determina la cola impostora ni el FNMR poblacional.',
} as const;

/** Los ocho pasos que convierten una medición en un umbral. Ninguno es saltable. */
export const PROCEDIMIENTO_DE_CALIBRACION: readonly {
  readonly paso: number;
  readonly accion: string;
  readonly salida: string;
}[] = [
  {
    paso: 1,
    accion:
      'Congelar versión de biblioteca, hash de pesos, detector/crop/alineación, dimensión de embedding, normalización, fórmula/dirección de score y backend.',
    salida: 'model_fingerprint',
  },
  {
    paso: 2,
    accion:
      'Registrar consentimiento y procedencia; capturar documentos propios y selfies del mismo titular en sesiones del canal real. No usar dibujos para colas operativas.',
    salida: 'corpus manifest',
  },
  {
    paso: 3,
    accion:
      'Separar titulares entre train/development/test ANTES de hacer pares y degradaciones. Ni una imagen o variante del mismo titular cruza splits.',
    salida: 'subject split',
  },
  {
    paso: 4,
    accion:
      'Construir genuinos y no-coincidentes dentro de cada split, etiquetados con identidad conocida, sin inferir ground truth del score.',
    salida: 'pairs.jsonl',
  },
  {
    paso: 5,
    accion:
      'Escoger presupuesto de FMR y de perjuicio a legítimos como decisión de riesgo. Barrer umbrales en development; elegir el menor corte que satisface riesgo impostor y revisar FNMR.',
    salida: 'candidate_threshold, no producción',
  },
  {
    paso: 6,
    accion:
      'Congelar corte y evaluar UNA VEZ en test representativo independiente; reportar CI, exclusiones, fallos de adquisición y tasas por estrato. Si se retoca tras test, reservar test nuevo.',
    salida: 'held_out_evaluation',
  },
  {
    paso: 7,
    accion:
      'No habilitar aceptación global sólo por matcher: se requieren gates de documento, PAD calibrado y captura/procedencia acordes al riesgo; humano ante discrepancias.',
    salida: 'approval record',
  },
  {
    paso: 8,
    accion:
      'Despliegue en sombra, muestreo auditado de aceptaciones y revisión, versionado y reversión; recalibrar tras cambio del pipeline.',
    salida: 'audit ledger',
  },
];

/** Fórmulas de intervalo binomial exacto, tal y como las publica el NIST. */
export const INTERVALOS_BINOMIALES = {
  unidad: 'un intento/pair independiente, no fotograma ni recomprensión',
  superiorUnilateral: 'U = BetaInv(1-alpha; k+1, n-k), k<n; U=1 si k=n; n=0 => no estimable',
  inferiorUnilateral: 'L=BetaInv(alpha; k, n-k+1), k>0; L=0 si k=0',
  bilateral: '[BetaInv(alpha/2; k, n-k+1), BetaInv(1-alpha/2; k+1, n-k)], con extremos 0/1.',
  sinErroresSuperior: '1-alpha^(1/n)',
  sinErroresTamano: 'ceil(log(alpha)/log(1-p_target))',
  reglaDeTres: 'Aproximación unilateral al 95%: 2.995732/n, no una garantía ni tasa observada.',
} as const;

/** Cuántos ensayos hacen falta para poder AFIRMAR una tasa. */
export const TAMANOS_SIN_ERRORES: readonly {
  readonly confianza: number;
  readonly tasaObjetivo: number;
  readonly ensayos: number;
  readonly cotaSuperior: number;
}[] = [
  { confianza: 0.9, tasaObjetivo: 0.05, ensayos: 45, cotaSuperior: 0.04988149268185629 },
  { confianza: 0.9, tasaObjetivo: 0.01, ensayos: 230, cotaSuperior: 0.009961293887814408 },
  { confianza: 0.9, tasaObjetivo: 0.001, ensayos: 2302, cotaSuperior: 0.0009997540797958247 },
  { confianza: 0.9, tasaObjetivo: 0.0001, ensayos: 23025, cotaSuperior: 0.00009999869547545792 },
  { confianza: 0.9, tasaObjetivo: 0.00001, ensayos: 230258, cotaSuperior: 0.00000999997211858651 },
  { confianza: 0.95, tasaObjetivo: 0.05, ensayos: 59, cotaSuperior: 0.04950760988822693 },
  { confianza: 0.95, tasaObjetivo: 0.01, ensayos: 299, cotaSuperior: 0.009969146792899269 },
  { confianza: 0.95, tasaObjetivo: 0.001, ensayos: 2995, cotaSuperior: 0.000999744420901142 },
  { confianza: 0.95, tasaObjetivo: 0.0001, ensayos: 29956, cotaSuperior: 0.00009999941531978722 },
  {
    confianza: 0.95,
    tasaObjetivo: 0.00001,
    ensayos: 299572,
    cotaSuperior: 0.000009999990970054556,
  },
  { confianza: 0.99, tasaObjetivo: 0.05, ensayos: 90, cotaSuperior: 0.04988149268185627 },
  { confianza: 0.99, tasaObjetivo: 0.01, ensayos: 459, cotaSuperior: 0.009982887366129078 },
  { confianza: 0.99, tasaObjetivo: 0.001, ensayos: 4603, cotaSuperior: 0.0009999711673583896 },
  { confianza: 0.99, tasaObjetivo: 0.0001, ensayos: 46050, cotaSuperior: 0.00009999869547545789 },
  {
    confianza: 0.99,
    tasaObjetivo: 0.00001,
    ensayos: 460515,
    cotaSuperior: 0.000009999993833236666,
  },
];

/**
 * Las observaciones del encargo, con su estado.
 *
 * Las dos que importan llevan `RETIRADO_NO_REUTILIZAR`: los umbrales 0,8824 y
 * 0,7789 salieron de rostros DIBUJADOS y cero pares genuinos reales. Están aquí
 * para que el código pueda reconocerlos y negarse a usarlos, no para usarlos.
 */
export const OBSERVACIONES_DEL_ENCARGO: readonly {
  readonly id: string;
  readonly valor: number | readonly number[] | null;
  readonly estado: string;
  readonly autorizadoComoUmbral: boolean;
}[] = [
  {
    id: 'catalogue_coverage_600',
    valor: 0.216,
    estado: 'OBSERVADO_POR_USUARIO',
    autorizadoComoUmbral: false,
  },
  {
    id: 'catalogue_coverage_900',
    valor: 0.463,
    estado: 'OBSERVADO_POR_USUARIO',
    autorizadoComoUmbral: false,
  },
  {
    id: 'catalogue_coverage_1200',
    valor: 0.515,
    estado: 'OBSERVADO_POR_USUARIO',
    autorizadoComoUmbral: false,
  },
  {
    id: 'catalogue_coverage_1600',
    valor: 0.664,
    estado: 'OBSERVADO_POR_USUARIO',
    autorizadoComoUmbral: false,
  },
  {
    id: 'wrong_rotations_coverage',
    valor: 0,
    estado: 'OBSERVADO_POR_USUARIO',
    autorizadoComoUmbral: false,
  },
  {
    id: 'driving_license_ci_coverage',
    valor: 0.558,
    estado: 'OBSERVADO_POR_USUARIO',
    autorizadoComoUmbral: false,
  },
  {
    id: 'genuine_similarity_range',
    valor: [0.66, 0.92],
    estado: 'OBSERVADO_POR_USUARIO',
    autorizadoComoUmbral: false,
  },
  {
    id: 'only_documented_genuine_pair',
    valor: 0.693,
    estado: 'OBSERVADO_POR_USUARIO',
    autorizadoComoUmbral: false,
  },
  {
    id: 'self_similarity_approx',
    valor: 1,
    estado: 'OBSERVADO_POR_USUARIO',
    autorizadoComoUmbral: false,
  },
  {
    id: 'historical_match_accept',
    valor: 0.8824,
    estado: 'RETIRADO_NO_REUTILIZAR',
    autorizadoComoUmbral: false,
  },
  {
    id: 'historical_match_reject',
    valor: 0.7789,
    estado: 'RETIRADO_NO_REUTILIZAR',
    autorizadoComoUmbral: false,
  },
  { id: 'pad_live_accept', valor: 0.55, estado: 'NO_CALIBRADO', autorizadoComoUmbral: false },
  { id: 'pad_live_reject', valor: 0.35, estado: 'NO_CALIBRADO', autorizadoComoUmbral: false },
  { id: 'too_similar_suspect', valor: 0.97, estado: 'NO_CALIBRADO', autorizadoComoUmbral: false },
  { id: 'grid_periodicity', valor: 0.28, estado: 'NO_CALIBRADO', autorizadoComoUmbral: false },
  { id: 'dark_frame', valor: 0.7, estado: 'NO_CALIBRADO', autorizadoComoUmbral: false },
  { id: 'grain_discontinuity', valor: 1.6, estado: 'NO_CALIBRADO', autorizadoComoUmbral: false },
  { id: 'document_fraud_low', valor: 0.3, estado: 'NO_CALIBRADO', autorizadoComoUmbral: false },
  { id: 'document_fraud_high', valor: 0.6, estado: 'NO_CALIBRADO', autorizadoComoUmbral: false },
  {
    id: 'document_naming_coverage',
    valor: 0.25,
    estado: 'OBSERVADO_POR_USUARIO',
    autorizadoComoUmbral: false,
  },
  {
    id: 'document_conformity_coverage',
    valor: 0.4,
    estado: 'OBSERVADO_POR_USUARIO',
    autorizadoComoUmbral: false,
  },
  {
    id: 'outdated_document_conformity_coverage',
    valor: 0.55,
    estado: 'OBSERVADO_POR_USUARIO',
    autorizadoComoUmbral: false,
  },
  {
    id: 'bank_statement_coverage',
    valor: 0.195,
    estado: 'OBSERVADO_POR_USUARIO',
    autorizadoComoUmbral: false,
  },
  {
    id: 'receipt_coverage',
    valor: 0.182,
    estado: 'OBSERVADO_POR_USUARIO',
    autorizadoComoUmbral: false,
  },
];

/** Contradicciones que el corpus resuelve, con la acción que impone cada una. */
export const CONTRADICCIONES_IDENTIDAD: readonly {
  readonly id: string;
  readonly afirmacion: string;
  readonly resuelto: string;
  readonly accion: string;
}[] = [
  {
    id: 'C01',
    afirmacion: 'DS4924 del 1 de noviembre de 2023',
    resuelto: 'DS4924 es del 26 de abril de 2023; inicio emisión2023-11-01.',
    accion: 'Conservar ambas fechas en campos diferentes.',
  },
  {
    id: 'C02',
    afirmacion: 'Complemento de dos letras',
    resuelto: 'SIN lo publica como alfanumérico; no gramática de dos letras verificada.',
    accion: 'No validar [A-Z]{2} como regla normativa.',
  },
  {
    id: 'C03',
    afirmacion: 'Todos los documentos rediseñados deben estar troquelados',
    resuelto: 'DS5364 acepta troquelado O holograma.',
    accion: 'Familias de conformidad; mejor variante gana, no acusación por alternativa legítima.',
  },
  {
    id: 'C04',
    afirmacion: 'Una única dimensión rediseñada',
    resuelto:
      'DS4924:85×55; variante ED-10 del DS 5364:85×54. No confundir con las dimensiones exactas de ISO ID-1.',
    accion: 'No aplicar rechazo automático por la relación de aspecto de una foto.',
  },
  {
    id: 'C05',
    afirmacion: 'PAD Level 2 requiere siempre0% ataques',
    resuelto: 'La metodología actual de iBeta permite1%; algunos productos reportaron0% observado.',
    accion: 'Separar criterio, resultado y versión.',
  },
  {
    id: 'C06',
    afirmacion: 'DocFace+ es un benchmark de tarjeta física fotografiada',
    resuelto:
      'El conjunto privado usa retrato dechip; el conjunto público IvS simula un documento.',
    accion: 'No transferir corte ni prometer su TAR en Bolivia.',
  },
  {
    id: 'C07',
    afirmacion: 'ISO30107-1:2016 vigente',
    resuelto: 'La edición 2023 sustituye a la de 2016.',
    accion: 'Fijar la edición 2023.',
  },
  {
    id: 'C08',
    afirmacion: 'ROSE con 25sujetos y 4225 vídeos disponibles para cualquiera',
    resuelto: 'Público20/3350, resto no es la porción pública; uso académico no comercial.',
    accion: 'Contadorespublic/total y control de licencia.',
  },
  {
    id: 'C09',
    afirmacion: 'HiFiMask: siete sensores en el artículo frente a índices de la web hasta ocho',
    resuelto:
      'Distintos recuentos y el dispositivo SpO2; no se estableció la reconciliación exacta.',
    accion: 'Conservar siete según el artículo; no afirmar ocho como el mismo indicador.',
  },
  {
    id: 'C10',
    afirmacion: 'Similitud>0.97 o falta demetadatos demuestra fraude',
    resuelto: 'No se publicó una tasa BPCER que respalde la afirmación; existen causas legítimas.',
    accion: 'Eliminar el rechazo automático basado en esas señales.',
  },
  {
    id: 'C11',
    afirmacion: 'Ninguna señal de píxel detecta ninguna inyección',
    resuelto:
      'Los píxeles pueden sugerir un medio forjado, pero no prueban el origen ni detectan todas las inyecciones con píxeles idénticos.',
    accion: 'Separar el análisis forense de medios de la integridad y frescura del canal.',
  },
];
