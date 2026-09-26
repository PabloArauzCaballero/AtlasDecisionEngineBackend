/**
 * Contrato de `generic-result-report@1.0.0` (§42).
 *
 * Es el documento que demuestra la tesis del §43: cualquier algoritmo del ecosistema puede
 * entregar «un título y unas secciones» y recibir un informe maquetado sin saber nada de
 * maquetación. La forma es deliberadamente genérica —secciones con campos y/o una tabla— y
 * deliberadamente ACOTADA.
 *
 * Los topes no son burocracia. Sin ellos, un payload de dos megas produce un PDF de
 * cuatrocientas páginas que ocupa un carril de renderizado durante medio minuto: el generador
 * documental se convierte en la forma más barata de tumbar el motor. Cada límite de aquí es
 * una cota superior del trabajo que una sola petición puede provocar (§24).
 */
import { z } from 'zod';

/** Lo que cabe en una celda. Un objeto anidado aquí sólo puede imprimirse como «[object Object]». */
const CellValue = z.union([z.string().max(2_000), z.number(), z.boolean(), z.null()]);

const FieldSchema = z.strictObject({
  label: z.string().min(1).max(120),
  value: CellValue,
});

const TableSchema = z.strictObject({
  columns: z
    .array(
      z.strictObject({
        key: z.string().min(1).max(80),
        label: z.string().min(1).max(120),
      }),
    )
    .min(1)
    .max(12),
  /**
   * Las filas son mapas de valores planos, no objetos libres.
   *
   * `z.record` con un valor acotado es lo que impide que llegue una estructura anidada que la
   * plantilla no sabe pintar. La alternativa —`z.record(z.unknown())`— haría de la tabla el
   * único punto del contrato donde el §7 no se cumple.
   */
  rows: z.array(z.record(z.string().max(80), CellValue)).max(2_000),
});

const SectionSchema = z.strictObject({
  title: z.string().min(1).max(160),
  description: z.string().max(1_000).optional(),
  /** Empieza en hoja nueva. Es la única decisión de maquetación que un payload puede tomar. */
  pageBreakBefore: z.boolean().optional(),
  fields: z.array(FieldSchema).max(60).optional(),
  table: TableSchema.optional(),
});

export const GenericResultReportSchema = z.strictObject({
  title: z.string().min(1).max(160).describe('Título del informe'),
  subtitle: z.string().max(240).optional().describe('Subtítulo o contexto breve'),
  /** ISO-8601. Ausente: se usa la fecha de generación, que es la que imprime el pie. */
  generatedAt: z.iso.datetime().optional(),
  summary: z
    .array(
      z.strictObject({
        label: z.string().min(1).max(80),
        value: CellValue,
        caption: z.string().max(120).optional(),
      }),
    )
    .max(4)
    .optional()
    .describe('Hasta cuatro cifras destacadas'),
  notices: z
    .array(
      z.strictObject({
        level: z.enum(['positive', 'caution', 'critical']),
        title: z.string().max(120).optional(),
        text: z.string().min(1).max(1_200),
      }),
    )
    .max(8)
    .optional(),
  sections: z.array(SectionSchema).min(1).max(60),
  signatures: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(120),
        role: z.string().max(120).optional(),
      }),
    )
    .max(2)
    .optional(),
});

export type GenericResultReportPayload = z.infer<typeof GenericResultReportSchema>;
