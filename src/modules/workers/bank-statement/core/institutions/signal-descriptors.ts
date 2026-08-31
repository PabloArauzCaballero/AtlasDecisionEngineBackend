/**
 * Descriptores de señales esperadas por entidad: la referencia compilada contra
 * la que se mide el parecido de un documento.
 *
 * ## De dónde salen
 *
 * De los analizadores especializados. Cada uno de los siete reconoce su plantilla
 * con patrones que se midieron contra un extracto real —el del BNB documenta las
 * 102 operaciones sobre las que se ajustó— y esos patrones son, literalmente, «lo
 * que trae un extracto de esta entidad». Reusarlos es escribir el descriptor con
 * la única evidencia que el repositorio tiene, en vez de inventarla.
 *
 * ## Por qué todos son `DECLARED`, y por qué eso importa
 *
 * Porque deducir un descriptor de un analizador no es haberlo medido. `MEASURED`
 * es lo único que autoriza a SOSTENER un documento que otra compuerta dejó en
 * duda, y para eso hace falta un corpus, no una deducción. Mientras sean
 * declarados el parecido se publica y no cambia ningún desenlace — que es
 * exactamente lo que se quiere antes de haber visto un solo PDF real.
 *
 * ## Lo que deliberadamente NO llevan
 *
 * Señales de `PRODUCER`, que son las que más pesan: el generador que declara un
 * archivo hay que producirlo con esa herramienta, no se copia de una carátula.
 * Son justo las que no se pueden deducir de un analizador —hay que abrir PDF
 * reales y leer su diccionario `/Info`— e inventarlas sería peor que no tenerlas:
 * una señal que nunca coincide baja el porcentaje de todos los extractos
 * legítimos de esa entidad. Añadirlas con su muestra es lo que convierte estos
 * descriptores en `MEASURED` y enciende el rescate.
 *
 * ## Por qué viven aquí y no en la siembra
 *
 * Por lo mismo que la nómina de ASFI: son conocimiento compilado que tiene que
 * funcionar aunque no haya base de datos. El padrón administrado los pisa cuando
 * los trae —una entidad calibrada desde el portal manda sobre la deducción— y
 * esta tabla es la red, igual que `BOLIVIA_INSTITUTIONS` lo es del padrón.
 */

import {
  parseSignalDescriptor,
  type InstitutionSignalDescriptor,
} from '../engine/similarity/institution-signals';

/** La forma JSON, que es también la que se guarda en el padrón administrable. */
export const SIGNAL_DESCRIPTOR_SOURCES: Readonly<Record<string, unknown>> = {
  BNB: {
    version: 1,
    institutionCode: 'BNB',
    provenance: 'DECLARED',
    sampleSize: 0,
    dateOrder: 'DMY',
    note: 'Derivado de bnb.parser.ts, ajustado sobre un extracto real de 102 operaciones.',
    signals: [
      {
        id: 'razon-social',
        scope: 'COVER',
        pattern: 'BANCO\\s+NACIONAL\\s+DE\\s+BOLIVIA',
        weight: 10,
      },
      { id: 'tabla-depositos', scope: 'DOCUMENT', pattern: 'Dep[oó]sitos', weight: 20 },
      { id: 'tabla-retiros', scope: 'DOCUMENT', pattern: 'Retiros', weight: 20 },
      { id: 'encabezado', scope: 'COLUMNS', pattern: 'Fecha|Hora|Descripci[oó]n', weight: 25 },
      {
        id: 'totales',
        scope: 'DOCUMENT',
        pattern: 'Total\\s+(?:dep[oó]sitos|retiros)',
        weight: 15,
      },
      { id: 'supervision', scope: 'DOCUMENT', pattern: '\\bASFI\\b', weight: 10 },
    ],
  },
  BME: {
    version: 1,
    institutionCode: 'BME',
    provenance: 'DECLARED',
    sampleSize: 0,
    dateOrder: 'DMY',
    note: 'Derivado de mercantil.parser.ts. Cubre la marca MAKROBANX además de la razón social.',
    signals: [
      {
        id: 'razon-social',
        scope: 'COVER',
        pattern: 'BANCO\\s+MERCANTIL\\s+SANTA\\s+CRUZ|\\bBMSC\\b',
        weight: 15,
      },
      { id: 'marca', scope: 'DOCUMENT', pattern: 'MAKROBANX', weight: 20 },
      { id: 'encabezado', scope: 'COLUMNS', pattern: 'FECHA|HORA|TRANSACCION', weight: 30 },
      { id: 'cod-bca', scope: 'DOCUMENT', pattern: 'COD\\.?\\s*BCA', weight: 25 },
      { id: 'supervision', scope: 'DOCUMENT', pattern: '\\bASFI\\b', weight: 10 },
    ],
  },
  BUN: {
    version: 1,
    institutionCode: 'BUN',
    provenance: 'DECLARED',
    sampleSize: 0,
    dateOrder: 'DMY',
    note: 'Derivado de union.parser.ts. El cuadro de saldos es su rasgo más distintivo.',
    signals: [
      { id: 'razon-social', scope: 'COVER', pattern: 'BANCO\\s+UNI[OÓ]N', weight: 10 },
      { id: 'encabezado', scope: 'COLUMNS', pattern: 'Fecha|Descripci[oó]n|Monto', weight: 30 },
      {
        id: 'cuadro-saldos',
        scope: 'DOCUMENT',
        pattern: 'Tr[aá]nsito\\s+Consultado\\s+Congelado',
        weight: 35,
      },
      { id: 'supervision', scope: 'DOCUMENT', pattern: '\\bASFI\\b', weight: 10 },
    ],
  },
  BGA: {
    version: 1,
    institutionCode: 'BGA',
    provenance: 'DECLARED',
    sampleSize: 0,
    dateOrder: 'DMY',
    note: 'Derivado de ganadero.parser.ts.',
    signals: [
      { id: 'razon-social', scope: 'COVER', pattern: 'BANCO\\s+GANADERO', weight: 15 },
      { id: 'marca', scope: 'DOCUMENT', pattern: 'GANAM[OÓ]VIL', weight: 25 },
      {
        id: 'encabezado',
        scope: 'COLUMNS',
        pattern: 'D[EÉ]BITO|CR[EÉ]DITO|SALDO',
        weight: 30,
      },
      { id: 'supervision', scope: 'DOCUMENT', pattern: '\\bASFI\\b', weight: 10 },
    ],
  },
  BEC: {
    version: 1,
    institutionCode: 'BEC',
    provenance: 'DECLARED',
    sampleSize: 0,
    dateOrder: 'DMY',
    note: 'Derivado de economico.parser.ts.',
    signals: [
      { id: 'dominio', scope: 'DOCUMENT', pattern: 'baneco\\.com\\.bo', weight: 30 },
      {
        id: 'titulo',
        scope: 'DOCUMENT',
        pattern: 'Extracto\\s+de\\s+Caja\\s+de\\s+Ahorros',
        weight: 25,
      },
      { id: 'razon-social', scope: 'COVER', pattern: 'BANCO\\s+ECON[OÓ]MICO', weight: 15 },
      { id: 'supervision', scope: 'DOCUMENT', pattern: '\\bASFI\\b', weight: 10 },
    ],
  },
  BSO: {
    version: 1,
    institutionCode: 'BSO',
    provenance: 'DECLARED',
    sampleSize: 0,
    dateOrder: 'DMY',
    note: 'Derivado de bancosol.parser.ts. Fonosol y el dominio son sus marcas de pie de página.',
    signals: [
      { id: 'dominio', scope: 'DOCUMENT', pattern: 'bancosol\\.com\\.bo', weight: 25 },
      { id: 'fonosol', scope: 'DOCUMENT', pattern: 'Fonosol', weight: 25 },
      {
        id: 'titulo',
        scope: 'DOCUMENT',
        pattern: 'Extracto\\s+de\\s+Caja\\s+de\\s+Ahorros',
        weight: 20,
      },
      {
        id: 'pie-supervision',
        scope: 'DOCUMENT',
        pattern: 'Esta\\s+entidad\\s+es\\s+supervisada',
        weight: 20,
      },
    ],
  },
  BCR: {
    version: 1,
    institutionCode: 'BCR',
    provenance: 'DECLARED',
    sampleSize: 0,
    dateOrder: 'DMY',
    note: 'Derivado de bcp.parser.ts (Banco de Crédito de Bolivia).',
    signals: [
      {
        id: 'titulo',
        scope: 'DOCUMENT',
        pattern: 'Extracto\\s+de\\s+Cuenta\\s+por\\s+Mes',
        weight: 30,
      },
      { id: 'rotulo-cuenta', scope: 'DOCUMENT', pattern: 'Nro\\.?\\s*Cuenta', weight: 15 },
      {
        id: 'medio-atencion',
        scope: 'DOCUMENT',
        pattern: 'Medio\\s+de\\s+Atenci[oó]n',
        weight: 30,
      },
      { id: 'razon-social', scope: 'COVER', pattern: 'BANCO\\s+DE\\s+CR[EÉ]DITO', weight: 15 },
      { id: 'supervision', scope: 'DOCUMENT', pattern: '\\bASFI\\b', weight: 10 },
    ],
  },
};

/**
 * Los mismos descriptores ya compilados, por código de entidad.
 *
 * Se compilan al cargar el módulo y no en cada documento, y con el MISMO
 * validador que usa el portal: un patrón mal escrito aquí revienta al arrancar
 * el proceso, que es donde se quiere que reviente. La alternativa —compilarlos
 * perezosamente— escondería el error hasta el primer extracto de esa entidad.
 */
export const COMPILED_SIGNAL_DESCRIPTORS: ReadonlyMap<string, InstitutionSignalDescriptor> =
  new Map(
    Object.entries(SIGNAL_DESCRIPTOR_SOURCES).map(([code, source]) => [
      code,
      parseSignalDescriptor(source),
    ]),
  );
