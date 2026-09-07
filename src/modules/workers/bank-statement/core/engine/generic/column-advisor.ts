import type { ExtractedPdf } from '../../domain/models';
import { reconcileRunningBalance } from '../../parsers/parser-helpers';
import { detectTables } from './column-detector';
import { normalizeHeaderText, type CanonicalField, type ExtraAliases } from './header-lexicon';
import { TableAnalyzer, type TableAnalysis } from './table-analyzer';

/**
 * Un modelo que propone qué papel juega cada columna que el diccionario no supo
 * nombrar, **con el saldo corriente como juez**.
 *
 * ## Por qué aquí y no en otro sitio del extracto
 *
 * Éste es el mejor lugar de todo el motor para un modelo de lenguaje, y la
 * razón es que aquí hay un verificador barato, exacto y ajeno a él: en un
 * extracto, cada saldo tiene que ser el anterior más el movimiento. Si la
 * asignación de columnas es correcta, la cadena cuadra fila a fila; si el modelo
 * confundió el débito con el saldo, no cuadra ninguna. No hace falta creerle:
 * se comprueba.
 *
 * Compárese con lo que NO se le pide —clasificar la glosa, juzgar si el
 * documento es auténtico—: ahí no hay aritmética que contradiga una respuesta
 * plausible y equivocada.
 *
 * ## Las tres puertas, y por qué cada una ahorra dinero o evita daño
 *
 * 1. **No se llama si el extracto ya cuadra Y trajo movimientos.** Un documento
 *    cuyo saldo concilia está bien leído por definición; preguntarle a un
 *    modelo sólo puede estropearlo, y cuesta una llamada por documento. Las dos
 *    condiciones son necesarias: **cero movimientos también da cero descuadres**
 *    —no hay nada que descuadrar—, y ése es justo el caso que más necesita
 *    ayuda, el de la columna de importe que el diccionario no supo nombrar.
 * 2. **No se llama si no hay columnas desconocidas.** Sin rótulos huérfanos no
 *    hay nada que mapear: el problema es otro y el modelo no lo va a ver.
 * 3. **La propuesta se acepta sólo si el saldo pasa a cuadrar ENTERO y la
 *    lectura mejora.** No «mejora», no «cuadra casi»: cero descuadres. Una
 *    lectura a medias de un extracto es peor que no leerlo, porque produce un
 *    documento plausible cuya capacidad de pago alguien va a firmar. Y «mejora»
 *    se mide primero en movimientos y después en descuadres, porque una
 *    asignación que se deje media tabla fuera cuadra trivialmente con lo que
 *    queda.
 *
 * ## Lo que sale de la máquina
 *
 * **Sólo los RÓTULOS de la cabecera.** Ni una fila, ni un importe, ni un nombre.
 * «¿Qué es la columna que pone SALDO DISPONIBLE?» se contesta con el rótulo, y
 * mandar los datos para eso sería sacar el extracto de una persona de la
 * infraestructura a cambio de nada.
 */

export interface ColumnAdviceRequest {
  /** Rótulos que el diccionario no supo nombrar, tal como están impresos. */
  readonly unknownLabels: readonly string[];
  /** Los que sí se reconocieron, como contexto: dicen de qué tabla se trata. */
  readonly knownLabels: readonly string[];
}

/** Rótulo → papel canónico. Lo que el modelo no sepa, lo deja fuera. */
export type ColumnAdvice = ReadonlyMap<string, CanonicalField>;

export interface StatementColumnAdvisorPort {
  readonly provider: string;
  /** `null` si no se pudo consultar. No leer no es un fallo del documento. */
  advise(request: ColumnAdviceRequest): Promise<ColumnAdvice | null>;
}

export interface AdvisedAnalysis {
  readonly analysis: TableAnalysis;
  readonly advice: ColumnAdvice;
  /** Descuadres antes de aplicar la propuesta. Después son cero, o no se aplica. */
  readonly mismatchesBefore: number;
}

export async function adviseColumns(
  advisor: StatementColumnAdvisorPort,
  pdf: ExtractedPdf,
  baseline: TableAnalysis,
): Promise<AdvisedAnalysis | null> {
  const mismatchesBefore = mismatchesOf(baseline);
  if (mismatchesBefore === 0 && baseline.movements.length > 0) return null;

  const { unknownLabels, knownLabels } = labelsOf(pdf);
  if (unknownLabels.length === 0) return null;

  const advice = await advisor.advise({ unknownLabels, knownLabels });
  if (advice === null || advice.size === 0) return null;

  const analysis = new TableAnalyzer({ extraAliases: toExtraAliases(advice) }).analyze(pdf);

  /*
   * El juez. `reconcileRunningBalance` cuenta cuántas veces un saldo no
   * continúa al anterior; cero significa que la cadena entera cuadra con los
   * importes leídos, y eso no se consigue por casualidad con las columnas mal
   * asignadas.
   *
   * Se exige además que no se hayan PERDIDO movimientos: una asignación que
   * deje fuera media tabla puede cuadrar trivialmente con las cuatro filas que
   * quedan, y sería el peor de los resultados —un extracto corto y coherente—.
   */
  const mismatchesAfter = mismatchesOf(analysis);
  if (mismatchesAfter !== 0 || analysis.movements.length === 0) return null;

  const mejora =
    analysis.movements.length > baseline.movements.length ||
    (analysis.movements.length === baseline.movements.length && mismatchesAfter < mismatchesBefore);
  if (!mejora) return null;

  return { analysis, advice, mismatchesBefore };
}

function mismatchesOf(analysis: TableAnalysis): number {
  return reconcileRunningBalance(analysis.movements.map((movement) => movement.transaction));
}

function labelsOf(pdf: ExtractedPdf): {
  unknownLabels: string[];
  knownLabels: string[];
} {
  const unknown = new Set<string>();
  const known = new Set<string>();
  for (const region of detectTables(pdf)) {
    for (const column of region.layout.columns) {
      const label = column.label.trim();
      if (label.length === 0) continue;
      if (column.field === 'unknown') unknown.add(label);
      else known.add(label);
    }
  }
  return { unknownLabels: [...unknown], knownLabels: [...known] };
}

/**
 * La propuesta, como los alias de un perfil.
 *
 * Se ancla el rótulo ENTERO (`^…$`) y se escapa: un alias suelto se aplicaría a
 * cualquier cabecera que contenga esas letras, y lo que el modelo dijo fue de
 * este rótulo y no de una familia de rótulos. Los alias de perfil se prueban
 * antes que el diccionario, así que un ancla floja aquí pisaría el catálogo
 * común en documentos que no tienen nada que ver.
 */
function toExtraAliases(advice: ColumnAdvice): ExtraAliases {
  const porCampo = new Map<CanonicalField, RegExp[]>();
  for (const [label, field] of advice) {
    const normalizado = normalizeHeaderText(label);
    if (normalizado.length === 0) continue;
    const patrones = porCampo.get(field) ?? [];
    patrones.push(new RegExp(`^${escapeRegExp(normalizado)}$`, 'u'));
    porCampo.set(field, patrones);
  }
  return porCampo;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
