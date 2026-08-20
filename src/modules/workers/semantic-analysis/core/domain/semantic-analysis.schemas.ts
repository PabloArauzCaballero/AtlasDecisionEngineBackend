import { z } from 'zod';

export const semanticAnalysisRequestSchema = z.object({
  requestId: z.string().uuid(),
  /*
   * 200, que es lo que promete `CreateSemanticAnalysisRunDto`. Aquí ponía 160, y
   * ese desajuste no rechazaba nada: la API aceptaba la clave, encolaba, y el
   * worker reventaba con UNEXPECTED_ANALYSIS_ERROR tres veces seguidas. Al
   * cliente le llegaba «error inesperado» por una clave que le habían admitido.
   * Lo medido: las glosas largas del BNB —las que llevan cuenta destino, nombre
   * y banco— pasan de 137 caracteres y el portal, que mete la glosa en la clave,
   * caía justo ahí.
   */
  idempotencyKey: z.string().trim().min(8).max(200),
  text: z.string().trim().min(1).max(20_000),
  tenantId: z.string().trim().min(1).max(100).optional(),
  requestedBy: z.string().trim().min(1).max(160).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const modelClassificationSchema = z.object({
  assessments: z.array(
    z.object({
      categoryCode: z.string().trim().min(1).max(100),
      confidence: z.number().min(0).max(1),
      supported: z.boolean(),
      contradicted: z.boolean(),
      evidence: z.array(z.string().max(500)).max(10),
      rationale: z.string().max(1_000),
    }),
  ),
  model: z.string().min(1),
  modelVersion: z.string().min(1),
});
