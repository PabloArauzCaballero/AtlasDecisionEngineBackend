/**
 * Contrato de `propuesta-comercial@1.0.0`: la propuesta que un comercio recibe de ATLAS.
 *
 * Los textos llegan ya redactados por el ERP (`proposal-pdf.service.ts`): la plantilla no decide
 * qué se promete, sólo cómo se ve. Topes acotados por la misma razón que el resto de plantillas:
 * una petición no puede provocar un documento de cien hojas.
 */
import { z } from 'zod';

const Texto = (max: number) => z.string().trim().min(1).max(max);

export const PropuestaComercialSchema = z.strictObject({
  propuesta: z.strictObject({
    numero: Texto(40),
    /** Ya legible: «30 de octubre de 2026». */
    validaHasta: Texto(60),
    fecha: Texto(60),
  }),
  comercio: z.strictObject({
    nombre: Texto(180),
    razonSocial: Texto(180).optional(),
    nit: Texto(40).optional(),
    ciudad: Texto(120).optional(),
  }),
  saludo: Texto(200),
  introduccion: z.array(Texto(1_200)).min(1).max(4),
  nota: z.strictObject({ autor: Texto(120), texto: Texto(1_500) }).optional(),
  beneficios: z.array(z.strictObject({ titulo: Texto(60), texto: Texto(300) })).max(6),
  condiciones: z
    .array(
      z.strictObject({
        concepto: Texto(80),
        detalle: Texto(200).optional(),
        condicion: Texto(80),
        cobro: Texto(60),
      }),
    )
    .max(30),
  condicionesNota: Texto(400).optional(),
  pasos: z.array(z.strictObject({ titulo: Texto(60), texto: Texto(300) })).max(6),
  proximosPasos: z.array(z.strictObject({ titulo: Texto(60), texto: Texto(300) })).max(6),
  cierre: Texto(800),
  firma: z.strictObject({ nombre: Texto(120), cargo: Texto(120), correo: Texto(254).optional() }),
});

export type PropuestaComercialPayload = z.infer<typeof PropuestaComercialSchema>;
