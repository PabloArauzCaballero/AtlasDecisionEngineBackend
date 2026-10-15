import { Prisma, WorkerRunStatus } from '@prisma/client';
import type { NormalizedBankStatement } from './core/engine/normalized/normalized-model';
import type { StatementOutcome } from './statement-outcome';

/**
 * Traduce un desenlace a las columnas que lo describen, con dos reglas que no
 * pueden quedar a criterio de quien escriba la próxima llamada:
 *
 * - **`finishedAt` sólo cuando el caso TERMINA.** Un pendiente no ha terminado;
 *   marcarlo cerrado haría que el «tiempo pendiente» de la cola contara desde
 *   un final que no ocurrió, y que las métricas de latencia del worker
 *   promediaran esperas humanas con tiempos de máquina.
 * - **Una ejecución que TERMINA deja el progreso al 100.** El motor lo dejaba
 *   donde estuviera al decidir el desenlace —25 % en un PDF rechazado, que es
 *   lo que había avanzado al leer la carátula— y la consola pintaba esa barra
 *   a un cuarto, quieta, bajo la insignia del rechazo: se leía como un worker
 *   colgado cuando lo que hubo fue un fallo rápido y deliberado. Un pendiente
 *   NO lo toca: ahí todavía queda trabajo, sólo que lo hace una persona.
 * - **El documento se conserva mientras alguien tenga que mirarlo.** La regla
 *   de privacidad del módulo es borrar el PDF en la misma transacción que
 *   cierra la ejecución, y sigue intacta: un caso en revisión no está cerrado.
 *   Sin esto, la cola ofrecería «reprocesar» y «ver el documento» sobre una
 *   fila que ya no tiene documento, que es peor que no ofrecerlo.
 */
export function outcomeFields(outcome: StatementOutcome): Prisma.BankStatementRunUpdateInput {
  const enRevision = outcome.status === WorkerRunStatus.PENDING_REVIEW;
  return {
    status: outcome.status,
    reviewReason: outcome.reviewReason,
    rejectionReason: outcome.rejectionReason,
    reviewPriority: outcome.reviewPriority,
    reviewOpenedAt: enRevision ? new Date() : null,
    finishedAt: enRevision ? null : new Date(),
    progress: enRevision ? undefined : 100,
    fileBytes: enRevision ? undefined : null,
  };
}

/**
 * Las columnas de capacidad de pago que acompañan al resultado.
 *
 * Se escriben con la MISMA sentencia que el resultado, y no en un segundo
 * `update`: dos escrituras dejarían un instante en el que la ejecución publica
 * movimientos sin la evaluación que los interpreta, y una pantalla que lea justo
 * ahí enseñaría un extracto aceptado con capacidad cero — que se lee como un
 * rechazo y no lo es.
 *
 * `affordabilityJson` guarda la evaluación entera y las demás columnas repiten
 * lo que se filtra y se ordena. La duplicación es deliberada; ver el modelo.
 */
export function affordabilityColumns(
  normalized: NormalizedBankStatement,
): Prisma.BankStatementRunUpdateInput {
  const affordability = normalized.affordability;
  return {
    affordabilityJson: affordability as unknown as Prisma.InputJsonValue,
    monthsComplete: affordability.coverage.monthsComplete,
    /*
     * Puntaje y banda sólo cuando la evaluación es ELEGIBLE. Un extracto que no
     * llega a los meses mínimos no tiene capacidad de pago «cero»: no tiene
     * capacidad de pago medida, y escribir 0 en la columna por la que después se
     * ordena convertiría una ausencia de dato en la peor calificación posible.
     */
    affordabilityScore: affordability.eligible ? affordability.score : null,
    affordabilityBand: affordability.eligible ? affordability.band : null,
    monthlyIncome: affordability.eligible ? affordability.income.monthlyRecognized : null,
    monthlyObligations: affordability.eligible ? affordability.obligations.monthly : null,
    maxAffordableInstallment: affordability.eligible
      ? affordability.capacity.maxAffordableInstallment
      : null,
    authenticityVerdict: normalized.authenticity.verdict,
    authenticityScore: normalized.authenticity.suspicionScore,
  };
}
