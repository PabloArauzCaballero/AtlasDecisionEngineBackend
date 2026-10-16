import type { Prisma } from '@prisma/client';

/** Nombre del módulo en las reglas de routing y en las etiquetas de métrica. */
export const AUDIT_QUERY_MODULE = 'audit-query';

/**
 * Lo que sirve `GET /v1/audit/executions/:id`. Es el CONTRATO que lee el detalle de
 * ejecución del portal (pasos con su nodo, variables con su definición…), así que vive
 * en una constante con su tipo derivado: `test/audit-execution-contract.spec.ts` fija con
 * él los campos que el portal consume. Quitar una relación de aquí o renombrar una de esas
 * columnas deja de compilar en vez de vaciar la pantalla en silencio, que es lo que pasó.
 */
export const EXECUTION_DETAIL_INCLUDE = {
  deployment: { include: { environment: true, compiledArtifact: true } },
  artifactVersion: { include: { artifact: true } },
  variables: { include: { variableVersion: { include: { definition: true } } } },
  steps: { include: { node: true }, orderBy: { stepOrder: 'asc' } },
  reasons: {
    include: { reasonCode: true, sourceAction: true },
    orderBy: { priority: 'asc' },
  },
  errors: true,
  manualReview: true,
} as const satisfies Prisma.DecisionExecutionInclude;

/** Fila del detalle de ejecución tal como la devuelve Prisma (antes de serializar). */
export type ExecutionDetailRow = Prisma.DecisionExecutionGetPayload<{
  include: typeof EXECUTION_DETAIL_INCLUDE;
}>;
