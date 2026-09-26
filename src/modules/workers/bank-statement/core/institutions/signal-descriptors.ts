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
 * ## Medidos el 2026-09-01, y qué cambió al medirlos
 *
 * Hasta esa fecha eran los siete `DECLARED`: deducidos de los analizadores, sin
 * un solo PDF real detrás. Se midieron contra diez extractos auténticos —dos del
 * BNB, del BSO y del BUN; uno de las otras cuatro— y la medición encontró que un
 * descriptor deducido falla de DOS formas opuestas, ninguna visible leyéndolo.
 *
 * **Señales muertas.** Patrones que no coinciden ni con su propio banco:
 * `encabezado` en cuatro entidades, las razones sociales del Mercantil, el Unión
 * y el BCP. No describen nada y hunden el porcentaje de todos los extractos
 * legítimos de esa entidad —el del Unión sacaba 41 % con su propio descriptor—.
 *
 * **Señales genéricas.** Patrones que coinciden MÁS en documentos ajenos que en
 * los propios. `\bASFI\b` es el ejemplo puro: la supervisión es obligatoria, así
 * que la lleva impresa todo extracto boliviano y no separa a nadie. La razón
 * social del Banco Económico coincidía en tres ajenos y en ninguno propio,
 * porque otros bancos la imprimen en la glosa de una transferencia recibida.
 *
 * Las veinte señales que fallaban en una de las dos formas se retiraron. La mención
 * a ASFI se retiró de las SIETE, incluida aquella en la que parecía discriminar:
 * una señal que en seis entidades es ruido no puede ser evidencia en la séptima.
 *
 * ## Las señales de `PRODUCER`, que antes no existían
 *
 * Son las que más pesan: el generador que declara un archivo hay que producirlo
 * con esa herramienta, no se copia de una carátula. No se pueden deducir de un
 * analizador —hay que abrir PDF reales y leer su diccionario `/Info`—, y por eso
 * faltaban por completo. Medidas, resultaron ser el rasgo más estable de todos:
 * los dos documentos del BNB declaran el mismo `wkhtmltopdf 0.12.2.1`, los dos
 * del BSO el mismo `PDFsharp 6.1.1`, y el Ganadero y el Unión usan el mismo
 * Reporting Services con versiones distintas —10.0 y 12.0—, que es justo lo que
 * los separa. El Banco Económico no declara ninguno: su `/Info` viene vacío.
 *
 * ## Qué sigue faltando para que el parecido RESCATE
 *
 * Corroborar exige `MEASURED` **y** una muestra de tres documentos
 * (`minimumSampleSize`), y aquí el máximo es dos. Eso no es un defecto: con uno
 * o dos no se sabe qué parte de lo observado es la plantilla del banco y qué
 * parte es ese cliente. Hasta llegar a tres, el parecido se mide y se publica
 * sin cambiar ningún desenlace.
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
    provenance: 'MEASURED',
    sampleSize: 2,
    dateOrder: 'DMY',
    note: 'Derivado de bnb.parser.ts, ajustado sobre un extracto real de 102 operaciones. Medido el 2026-09-01 sobre 2 PDF(s) real(es): wkhtmltopdf/Qt: los dos documentos medidos lo declaran identico.',
    signals: [
      {
        id: 'razon-social',
        scope: 'COVER',
        pattern: 'BANCO\\s+NACIONAL\\s+DE\\s+BOLIVIA',
        weight: 10,
      },
      { id: 'tabla-depositos', scope: 'DOCUMENT', pattern: 'Dep[oó]sitos', weight: 20 },
      { id: 'tabla-retiros', scope: 'DOCUMENT', pattern: 'Retiros', weight: 20 },
      {
        id: 'totales',
        scope: 'DOCUMENT',
        pattern: 'Total\\s+(?:dep[oó]sitos|retiros)',
        weight: 15,
      },
      {
        id: 'generador-institucional',
        scope: 'PRODUCER',
        pattern: 'wkhtmltopdf|Qt\\s+4\\.8',
        weight: 30,
      },
    ],
  },
  BME: {
    version: 1,
    institutionCode: 'BME',
    provenance: 'MEASURED',
    sampleSize: 1,
    dateOrder: 'DMY',
    note: 'Derivado de mercantil.parser.ts. Cubre la marca MAKROBANX además de la razón social. Medido el 2026-09-01 sobre 1 PDF(s) real(es): JasperReports sobre OpenPDF.',
    signals: [
      { id: 'marca', scope: 'DOCUMENT', pattern: 'MAKROBANX', weight: 20 },
      { id: 'cod-bca', scope: 'DOCUMENT', pattern: 'COD\\.?\\s*BCA', weight: 25 },
      {
        id: 'generador-institucional',
        scope: 'PRODUCER',
        pattern: 'JasperReports|OpenPDF',
        weight: 30,
      },
    ],
  },
  BUN: {
    version: 1,
    institutionCode: 'BUN',
    provenance: 'MEASURED',
    sampleSize: 2,
    dateOrder: 'DMY',
    note: 'Derivado de union.parser.ts. El cuadro de saldos es su rasgo más distintivo. Medido el 2026-09-01 sobre 2 PDF(s) real(es): Reporting Services 12.0. La VERSION lo separa del Ganadero, que usa la 10.0.',
    signals: [
      {
        id: 'cuadro-saldos',
        scope: 'DOCUMENT',
        pattern: 'Tr[aá]nsito\\s+Consultado\\s+Congelado',
        weight: 35,
      },
      {
        id: 'generador-institucional',
        scope: 'PRODUCER',
        pattern: 'Microsoft\\s+Reporting\\s+Services.*\\b12\\.0',
        weight: 30,
      },
    ],
  },
  BGA: {
    version: 1,
    institutionCode: 'BGA',
    provenance: 'MEASURED',
    sampleSize: 1,
    dateOrder: 'DMY',
    note: 'Derivado de ganadero.parser.ts. Medido el 2026-09-01 sobre 1 PDF(s) real(es): Reporting Services 10.0. La VERSION lo separa del Union, que usa la 12.0.',
    signals: [
      { id: 'razon-social', scope: 'COVER', pattern: 'BANCO\\s+GANADERO', weight: 15 },
      { id: 'marca', scope: 'DOCUMENT', pattern: 'GANAM[OÓ]VIL', weight: 25 },
      {
        id: 'generador-institucional',
        scope: 'PRODUCER',
        pattern: 'Microsoft\\s+Reporting\\s+Services.*\\b10\\.0',
        weight: 30,
      },
    ],
  },
  BEC: {
    version: 1,
    institutionCode: 'BEC',
    provenance: 'MEASURED',
    sampleSize: 1,
    dateOrder: 'DMY',
    note: 'Derivado de economico.parser.ts. Medido el 2026-09-01 sobre 1 PDF(s) real(es): Su plantilla NO declara productor ni creador: el diccionario /Info viene vacio, asi que no hay senal de contenedor que anadir. La ausencia ya la penaliza la compuerta de autenticidad (SIN_METADATOS_DE_ORIGEN).',
    signals: [
      { id: 'dominio', scope: 'DOCUMENT', pattern: 'baneco\\.com\\.bo', weight: 30 },
      {
        id: 'titulo',
        scope: 'DOCUMENT',
        pattern: 'Extracto\\s+de\\s+Caja\\s+de\\s+Ahorros',
        weight: 25,
      },
    ],
  },
  BSO: {
    version: 1,
    institutionCode: 'BSO',
    provenance: 'MEASURED',
    sampleSize: 2,
    dateOrder: 'DMY',
    note: 'Derivado de bancosol.parser.ts. Fonosol y el dominio son sus marcas de pie de página. Medido el 2026-09-01 sobre 2 PDF(s) real(es): PDFsharp 6: los dos documentos medidos lo declaran identico.',
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
        id: 'generador-institucional',
        scope: 'PRODUCER',
        pattern: 'PDFsharp\\s+6\\.',
        weight: 30,
      },
    ],
  },
  BCR: {
    version: 1,
    institutionCode: 'BCR',
    provenance: 'MEASURED',
    sampleSize: 1,
    dateOrder: 'DMY',
    note: 'Derivado de bcp.parser.ts (Banco de Crédito de Bolivia). Medido el 2026-09-01 sobre 1 PDF(s) real(es): iText Core 9 con pdfHTML.',
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
      {
        id: 'generador-institucional',
        scope: 'PRODUCER',
        pattern: 'iText.*Core\\s+9\\.|pdfHTML',
        weight: 30,
      },
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
