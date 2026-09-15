/**
 * Contrato de `blank-form@1.0.0`: un formulario EN BLANCO para rellenar a mano.
 *
 * Es el reverso de `generic-result-report`: aquél imprime valores, éste imprime el HUECO donde
 * una persona va a escribirlos con bolígrafo. Lo pide el ERP para la gente que no va a usar la
 * pantalla —sin cuenta, sin conexión, sin práctica— y que entrega el papel para que alguien lo
 * transcriba después. Por eso el contrato exige lo que hace transcribible un papel:
 *
 *  - `formCode` + `formVersion`: qué pantalla corresponde y si el papel es de una versión vieja.
 *  - `kind` por campo: decide el dibujo (casillas de fecha, lista de opciones, renglones).
 *  - `annexes`: los catálogos del backend impresos como «código — nombre», porque los `select`
 *    de pantalla guardan UUID y un UUID no se copia a mano sin equivocarse.
 *
 * Los topes acotan el trabajo de Chromium por petición, como en el resto de contratos (§24).
 */
import { z } from 'zod';

const CellValue = z.union([z.string().max(2_000), z.number(), z.boolean(), z.null()]);

/** Cómo se dibuja el hueco. Es lo único que el ERP tiene que decidir por campo. */
export const BLANK_FORM_FIELD_KINDS = [
  'text',
  'number',
  'date',
  'datetime',
  'textarea',
  'select',
  'multiselect',
  'chips',
  'countryCity',
  'address',
  'boolean',
  'file',
  'email',
  'url',
  'phone',
] as const;

const OptionSchema = z.strictObject({
  code: z.string().max(40).optional(),
  label: z.string().min(1).max(120),
});

const FieldSchema = z.strictObject({
  label: z.string().min(1).max(120),
  kind: z.enum(BLANK_FORM_FIELD_KINDS),
  required: z.boolean().optional(),
  /** Instrucción corta bajo la etiqueta («en bolivianos», «una letra por casilla»). */
  hint: z.string().max(240).optional(),
  /**
   * Opciones cortas, impresas como casillas para marcar. Más de doce no caben con dignidad en
   * una fila de formulario: para esos casos se usa `catalogRef` y el catálogo va en un anexo.
   */
  options: z.array(OptionSchema).max(12).optional(),
  /** Título del anexo (en `annexes`) donde está el catálogo completo de este campo. */
  catalogRef: z.string().max(120).optional(),
  /** Columnas que ocupa en la rejilla de tres. */
  width: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  /** Renglones de un `textarea` o de una dirección. */
  lines: z.number().int().min(1).max(8).optional(),
  /** Valor pre-impreso (papel para UN cliente concreto): se imprime en vez del hueco. */
  prefilled: CellValue.optional(),
});

const TableSchema = z.strictObject({
  columns: z
    .array(
      z.strictObject({
        label: z.string().min(1).max(80),
        /** Peso relativo del ancho; ausente = 1. */
        width: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
        /** Alineación a la derecha para importes. */
        numeric: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(8),
  /** Renglones vacíos que se imprimen, numerados. */
  rows: z.number().int().min(1).max(60),
  /** Fila «Total» al pie, para que quien rellena sume y quien transcribe cuadre. */
  totalRow: z.boolean().optional(),
});

const SectionSchema = z
  .strictObject({
    title: z.string().min(1).max(160),
    description: z.string().max(1_000).optional(),
    pageBreakBefore: z.boolean().optional(),
    fields: z.array(FieldSchema).max(80).optional(),
    table: TableSchema.optional(),
  })
  .refine((section) => (section.fields?.length ?? 0) > 0 || section.table !== undefined, {
    message: 'Una sección de un formulario en blanco tiene campos, una tabla o las dos cosas.',
  });

export const BlankFormSchema = z
  .strictObject({
    /** Identificador estable de la pantalla, imprimible: `ERP-CRM-CUENTA-CREAR`. */
    formCode: z
      .string()
      .regex(/^[A-Z0-9][A-Z0-9-]{2,63}$/, 'Mayúsculas, dígitos y guiones; 3 a 64 caracteres.'),
    /** Huella corta de la definición: cambia cuando cambian los campos. */
    formVersion: z.string().min(1).max(16),
    title: z.string().min(1).max(160),
    subtitle: z.string().max(240).optional(),
    /** Frases cortas al principio: cómo rellenar, qué adjuntar, a quién entregar. */
    instructions: z.array(z.string().min(1).max(300)).max(8).optional(),
    /** Datos ya conocidos cuando el papel es para alguien concreto (comercio, sucursal, fecha). */
    context: z
      .array(z.strictObject({ label: z.string().min(1).max(80), value: CellValue }))
      .max(12)
      .optional(),
    sections: z.array(SectionSchema).min(1).max(40),
    /** Catálogos «código — nombre» a los que apuntan los `catalogRef`. */
    annexes: z
      .array(
        z.strictObject({
          title: z.string().min(1).max(120),
          entries: z
            .array(
              z.strictObject({
                code: z.string().min(1).max(40),
                label: z.string().min(1).max(160),
              }),
            )
            .min(1)
            .max(400),
        }),
      )
      .max(12)
      .optional(),
    /** Texto legal o de consentimiento que va justo antes de las firmas. */
    declarations: z.array(z.string().min(1).max(600)).max(6).optional(),
    signatures: z
      .array(
        z.strictObject({ name: z.string().min(1).max(120), role: z.string().max(120).optional() }),
      )
      .max(3)
      .optional(),
  })
  .superRefine((form, ctx) => {
    const fields = form.sections.reduce(
      (total, section) => total + (section.fields?.length ?? 0),
      0,
    );
    if (fields > 200) {
      ctx.addIssue({
        code: 'custom',
        message: `Un formulario admite hasta 200 campos; llegaron ${fields}.`,
        path: ['sections'],
      });
    }
    const rows = form.sections.reduce((total, section) => total + (section.table?.rows ?? 0), 0);
    if (rows > 200) {
      ctx.addIssue({
        code: 'custom',
        message: `Un formulario admite hasta 200 renglones de tabla; llegaron ${rows}.`,
        path: ['sections'],
      });
    }
    const anexos = new Set((form.annexes ?? []).map((annex) => annex.title));
    for (const [sectionIndex, section] of form.sections.entries()) {
      for (const [fieldIndex, field] of (section.fields ?? []).entries()) {
        if (field.catalogRef && !anexos.has(field.catalogRef)) {
          ctx.addIssue({
            code: 'custom',
            message: `El campo «${field.label}» apunta al anexo «${field.catalogRef}», que no existe.`,
            path: ['sections', sectionIndex, 'fields', fieldIndex, 'catalogRef'],
          });
        }
      }
    }
  });

export type BlankFormPayload = z.infer<typeof BlankFormSchema>;
export type BlankFormField = z.infer<typeof FieldSchema>;
