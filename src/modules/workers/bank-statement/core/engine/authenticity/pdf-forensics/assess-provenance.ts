import {
  AUTHORING_TOOLS,
  BROWSER_PRINT,
  MOD_DATE_GRACE_MS,
  REPORTING_TOOLS,
} from './tool-signatures';
import { ForensicAxis, ForensicReport, ForensicSignal, PdfProvenance } from './types';

/**
 * Pondera lo encontrado y devuelve las señales con su puntaje.
 *
 * @param textPageRatio Proporción de páginas con capa de texto. Se pasa desde
 * fuera —lo sabe la extracción, no los bytes— porque un documento SIN texto
 * cambia el significado de casi todo lo demás: en una imagen no hay fuentes que
 * incrustar ni anotaciones que superponer, así que las ausencias dejan de ser
 * información y penalizarlas sería castigar dos veces al escaneado.
 */
export function assessProvenance(provenance: PdfProvenance, textPageRatio: number): ForensicReport {
  const signals: ForensicSignal[] = [];
  const toolText = `${provenance.producer ?? ''} ${provenance.creator ?? ''}`.trim();

  if (provenance.hasActiveContent) {
    signals.push({
      code: 'CONTENIDO_ACTIVO',
      weight: 100,
      severity: 'CRITICAL',
      axis: 'SECURITY',
      detail:
        'El PDF lleva JavaScript o una acción de lanzamiento incrustada. Un extracto bancario no ejecuta nada.',
    });
  }

  if (provenance.embeddedFileCount > 0) {
    signals.push({
      code: 'ARCHIVOS_INCRUSTADOS',
      weight: 100,
      severity: 'CRITICAL',
      axis: 'SECURITY',
      detail: `El PDF transporta ${String(provenance.embeddedFileCount)} archivo(s) incrustado(s).`,
    });
  }

  const authoring = AUTHORING_TOOLS.find((tool) => tool.pattern.test(toolText));
  if (authoring) {
    signals.push({
      code: 'HERRAMIENTA_DE_AUTORIA',
      weight: 85,
      severity: 'CRITICAL',
      axis: 'PROVENANCE',
      detail: `El archivo declara haber sido producido con ${authoring.label}, que es una herramienta de composición y edición, no un emisor de extractos.`,
    });
  }

  if (provenance.annotationSubtypes.length > 0) {
    signals.push({
      code: 'ANOTACIONES_SUPERPUESTAS',
      weight: 70,
      severity: 'HIGH',
      axis: 'PROVENANCE',
      detail: `Hay contenido superpuesto al documento (${provenance.annotationSubtypes.join(', ')}). Es el equivalente digital de una tachadura sobre el papel.`,
    });
  }

  if (provenance.incrementalUpdates > 0) {
    /*
     * Una revisión puede ser del propio emisor; tres ya es un archivo que se
     * abrió y se guardó varias veces. El peso sube con el número en vez de ser
     * fijo, porque lo que distingue los dos casos es la cantidad.
     */
    const weight = provenance.incrementalUpdates >= 2 ? 55 : 30;
    signals.push({
      code: 'REVISIONES_INCREMENTALES',
      weight,
      severity: provenance.incrementalUpdates >= 2 ? 'HIGH' : 'MEDIUM',
      axis: 'PROVENANCE',
      detail: `El archivo se reescribió ${String(provenance.incrementalUpdates)} vez/veces por encima de su versión original.`,
    });
  }

  if (provenance.hasAcroForm) {
    signals.push({
      code: 'FORMULARIO_EDITABLE',
      weight: 35,
      severity: 'MEDIUM',
      axis: 'PROVENANCE',
      detail:
        'El PDF contiene campos de formulario rellenables. Un extracto emitido no se rellena.',
    });
  }

  const created = provenance.creationDate?.getTime();
  const modified = provenance.modificationDate?.getTime();
  if (created !== undefined && modified !== undefined && modified - created > MOD_DATE_GRACE_MS) {
    const days = Math.round((modified - created) / 86_400_000);
    signals.push({
      code: 'MODIFICADO_TRAS_LA_EMISION',
      weight: days >= 1 ? 45 : 25,
      severity: days >= 1 ? 'HIGH' : 'MEDIUM',
      axis: 'PROVENANCE',
      detail: `El archivo se modificó ${days >= 1 ? `${String(days)} día(s)` : 'minutos'} después de haberse creado.`,
    });
  }

  if (!provenance.producer && !provenance.creator) {
    /*
     * Peso bajo a propósito. La ausencia del diccionario `/Info` es lo que hace
     * un limpiador de metadatos —señal de que alguien quiso borrar el rastro—
     * pero también lo que hacen algunos generadores minimalistas y lo que ocurre
     * cuando el diccionario viaja dentro de un flujo comprimido que aquí no se
     * lee. Acusar por una ausencia es exactamente lo que este módulo no hace.
     */
    signals.push({
      code: 'SIN_METADATOS_DE_ORIGEN',
      weight: 20,
      severity: 'LOW',
      axis: 'PROVENANCE',
      detail:
        'El archivo no declara con qué se produjo. Puede ser un generador parco o un borrado de metadatos.',
    });
  }

  const isBrowserPrint = BROWSER_PRINT.some((pattern) => pattern.test(toolText));
  if (isBrowserPrint) {
    signals.push({
      code: 'IMPRESION_DESDE_NAVEGADOR',
      weight: 15,
      severity: 'LOW',
      axis: 'PROVENANCE',
      detail:
        'El PDF lo generó un navegador al imprimir. El contenido lo pintó el banco, pero el archivo no es el que el banco emitió.',
    });
  }

  /*
   * Fuentes sin incrustar: sólo se mira cuando el documento TIENE texto, y sólo
   * cuando declara fuentes. Un PDF cuyo texto se pinta con las fuentes del
   * sistema del lector es lo que produce un editor de escritorio que reusa las
   * que tiene instaladas; un generador de informes incrusta las suyas para que
   * el documento se vea igual en cualquier equipo, que es justamente lo que un
   * banco necesita.
   */
  if (textPageRatio > 0 && provenance.nonStandardFonts > 0 && provenance.fontsEmbedded === 0) {
    signals.push({
      code: 'FUENTES_SIN_INCRUSTAR',
      weight: 25,
      severity: 'MEDIUM',
      axis: 'PROVENANCE',
      detail:
        `El documento declara ${String(provenance.nonStandardFonts)} fuente(s) no estándar sin incrustarlas; ` +
        'el texto se pinta con las del equipo que lo abra, que es lo que ocurre al componerlo en un editor.',
    });
  }

  if (!authoring && REPORTING_TOOLS.some((pattern) => pattern.test(toolText))) {
    /*
     * No es una señal: es la retirada de una. Se representa con peso NEGATIVO
     * para que aparezca en la traza —quien audita un documento aceptado quiere
     * ver por qué se aceptó, no sólo la ausencia de motivos— y para que compense
     * las señales débiles que un generador institucional dispara por su forma de
     * escribir el archivo.
     */
    signals.push({
      code: 'GENERADOR_INSTITUCIONAL',
      weight: -25,
      severity: 'LOW',
      axis: 'PROVENANCE',
      detail: `El archivo lo produjo un motor de informes (${toolText.trim()}), compatible con una emisión institucional.`,
    });
  }

  const critical = signals.some((signal) => signal.severity === 'CRITICAL');
  const additive = signals.reduce((total, signal) => total + signal.weight, 0);
  const suspicionScore = critical ? 100 : Math.max(0, Math.min(100, additive));

  /*
   * Los dos ejes se puntúan por separado, y el de seguridad IGNORA los créditos.
   *
   * `Math.max(0, weight)` en el eje de seguridad no es una precaución teórica:
   * es lo que garantiza que añadir mañana una señal favorable —un productor
   * reconocido, una firma que valida— no pueda restar de un archivo que ejecuta
   * código. El corpus lo fija como caso de regresión (`SECURITY_AXIS`).
   */
  const axisScore = (axis: ForensicAxis, allowCredits: boolean): number => {
    const ofAxis = signals.filter((signal) => signal.axis === axis);
    if (ofAxis.some((signal) => signal.severity === 'CRITICAL')) return 100;
    const total = ofAxis.reduce(
      (sum, signal) => sum + (allowCredits ? signal.weight : Math.max(0, signal.weight)),
      0,
    );
    return Math.max(0, Math.min(100, total));
  };

  return {
    provenance,
    signals,
    suspicionScore,
    securityScore: axisScore('SECURITY', false),
    provenanceScore: axisScore('PROVENANCE', true),
    calibration: 'UNCALIBRATED_WEIGHTS_DECLARED_IN_BRIEF',
  };
}
