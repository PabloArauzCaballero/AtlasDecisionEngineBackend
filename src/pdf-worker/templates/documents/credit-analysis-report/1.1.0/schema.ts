/**
 * Contrato de `credit-analysis-report@1.1.0`.
 *
 * Añade `factors` —el desglose de qué pesó en el puntaje— de forma OPCIONAL. Por eso es una
 * versión menor: todo payload que valía para la 1.0.0 sigue valiendo aquí, y un consumidor
 * puede migrar sin tocar su código y añadir el desglose cuando pueda.
 *
 * Extiende el esquema de la 1.0.0 en lugar de copiarlo. La dependencia va de lo nuevo a lo
 * viejo, que es la dirección segura: la 1.0.0 está congelada —esa es la regla del §9— así que
 * nada de lo que se haga aquí puede cambiarla.
 */
import { z } from 'zod';
import { CreditAnalysisSchemaV1 } from '../1.0.0/schema';

export const CreditAnalysisSchemaV11 = CreditAnalysisSchemaV1.extend({
  factors: z
    .array(
      z.strictObject({
        code: z.string().min(1).max(80),
        label: z.string().min(1).max(160),
        /** Contribución al puntaje; negativa cuando resta. */
        contribution: z.number().min(-1_000).max(1_000),
        value: z.union([z.string().max(200), z.number(), z.boolean()]).optional(),
      }),
    )
    .max(40)
    .optional()
    .describe('Desglose del puntaje por factor'),
});

export type CreditAnalysisPayloadV11 = z.infer<typeof CreditAnalysisSchemaV11>;
