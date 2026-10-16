import { Prisma } from '@prisma/client';
import { outcomeWindowsFor, windowDueAt } from './outcome-windows';
import type { WriteExecutionInput } from './execution-write.types';

/**
 * Materializa las ventanas de observación de una decisión que origina crédito.
 *
 * Se hace aquí, en la misma transacción que la ejecución, y no en un barrido posterior: un
 * barrido que deja de correr produce exactamente el silencio que todo esto viene a eliminar
 * —cero ventanas pendientes leído como «todo observado»—, mientras que una ventana escrita
 * junto a su decisión existe siempre que la decisión exista.
 *
 * Sólo se programan con sujeto. Sin él no hay a quién atribuir el desenlace, así que la
 * ventana nacería imposible de cerrar y llenaría la cola de trabajo que nadie puede hacer.
 */
export async function scheduleOutcomeWindows(
  tx: Prisma.TransactionClient,
  input: WriteExecutionInput,
  executionId: bigint,
  windowDaysSetting: string | undefined,
): Promise<void> {
  const windows = outcomeWindowsFor(input.deployment.riskDomain, windowDaysSetting);
  if (!windows.length) return;
  const decidedAt = input.decidedAt ?? new Date();
  await tx.outcomeWindowSchedule.createMany({
    data: windows.map((windowDays) => ({
      tenantId: input.tenantId,
      executionId,
      windowDays,
      dueAt: windowDueAt(decidedAt, windowDays),
    })),
    skipDuplicates: true,
  });
}
