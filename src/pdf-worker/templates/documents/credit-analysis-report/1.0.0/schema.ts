/**
 * Contrato de `credit-analysis-report@1.0.0`.
 *
 * Existe además del informe genérico para demostrar la otra mitad del §7: un template puede
 * exigir un vocabulario CERRADO. Aquí `decision` no es «un texto», son tres valores, y un
 * cuarto se rechaza con el campo, los valores admitidos y lo que llegó — antes de renderizar.
 *
 * Un documento con vocabulario cerrado puede maquetar según el valor (el color de la insignia,
 * el aviso de revisión) sin adivinar. Con `decision: string` esa lógica se convierte en una
 * cadena de comparaciones que falla en silencio ante «Aprobado» con minúscula.
 */
import { z } from 'zod';

export const CREDIT_DECISIONS = ['APPROVED', 'REJECTED', 'REVIEW'] as const;

export const CreditAnalysisSchemaV1 = z.strictObject({
  customerName: z.string().min(1).max(160).describe('Nombre del solicitante'),
  customerDocument: z.string().max(40).optional(),
  score: z.number().int().min(0).max(1_000).describe('Puntaje del modelo, 0–1000'),
  decision: z.enum(CREDIT_DECISIONS).describe('Veredicto del motor'),
  amount: z.number().min(0).max(1e12).optional().describe('Monto aprobado o solicitado'),
  currency: z.string().length(3).optional().describe('ISO-4217, p. ej. BOB'),
  termMonths: z.number().int().min(1).max(600).optional(),
  evaluatedAt: z.iso.datetime().optional(),
  /** Motivos legibles. Es lo que un solicitante tiene derecho a que se le explique. */
  reasons: z.array(z.string().min(1).max(400)).max(20).optional(),
});

export type CreditAnalysisPayloadV1 = z.infer<typeof CreditAnalysisSchemaV1>;
