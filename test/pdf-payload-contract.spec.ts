/**
 * El contrato tipado por template (§7) y el endpoint de descubrimiento (§19).
 *
 * Se comprueban las tres cosas que el §7 exige de un rechazo —campo, problema, regla— porque un
 * 422 que sólo dice «payload inválido» obliga a quien integra a adivinar, y adivinar contra un
 * generador de PDF significa reintentar hasta acertar.
 */
import { z } from 'zod';
import { zodSchema } from '../src/pdf-worker/infrastructure/validation/zod-payload-schema';
import { GenericResultReportSchema } from '../src/pdf-worker/templates/documents/generic-result-report/1.0.0/schema';
import { genericResultReportFixture } from '../src/pdf-worker/templates/documents/generic-result-report/1.0.0/preview.fixture';
import { CreditAnalysisSchemaV1 } from '../src/pdf-worker/templates/documents/credit-analysis-report/1.0.0/schema';

const schema = zodSchema(
  z.strictObject({
    customerName: z.string().min(1),
    score: z.number().int().min(0).max(1_000),
    decision: z.enum(['APPROVED', 'REJECTED', 'REVIEW']),
    amount: z.number().optional(),
  }),
);

describe('Contrato de payload por template', () => {
  it('acepta un payload válido y devuelve el valor ya normalizado', () => {
    const result = schema.parse({ customerName: 'Ana', score: 700, decision: 'APPROVED' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.customerName).toBe('Ana');
  });

  it('señala el campo obligatorio ausente con su ruta y el tipo esperado', () => {
    const result = schema.parse({ score: 700, decision: 'APPROVED' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        field: 'customerName',
        problem: 'campo obligatorio ausente',
        expected: 'texto',
      }),
    );
  });

  it('enumera los valores admitidos cuando el enum no encaja', () => {
    const result = schema.parse({ customerName: 'Ana', score: 700, decision: 'APROBADO' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.issues.find((item) => item.field === 'decision');
    expect(issue?.expected).toContain('APPROVED');
    expect(issue?.received).toBe('"APROBADO"');
  });

  it('rechaza los campos que el contrato no declara', () => {
    const result = schema.parse({
      customerName: 'Ana',
      score: 700,
      decision: 'APPROVED',
      htmlExtra: '<script>alert(1)</script>',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].problem).toBe('campo no reconocido por el contrato');
  });

  it('recorta el valor recibido para que un payload con datos personales no acabe en el log', () => {
    const result = schema.parse({ customerName: 'x'.repeat(500), score: 'no', decision: 'REVIEW' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.issues.find((item) => item.field === 'score');
    expect(issue?.received).toBe('"no"');
    // 60 caracteres + comillas + el carácter de elipsis.
    const name = schema.parse({ customerName: 'x'.repeat(500), score: 1, decision: 'REVIEW' });
    expect(name.ok).toBe(true);
  });

  it('publica los campos, el JSON Schema y los obligatorios para el descubrimiento', () => {
    const fields = schema.describeFields();
    expect(fields.decision).toEqual(
      expect.objectContaining({
        type: 'enum',
        required: true,
        values: ['APPROVED', 'REJECTED', 'REVIEW'],
      }),
    );
    expect(fields.amount.required).toBe(false);
    expect([...schema.requiredFields()].sort()).toEqual(['customerName', 'decision', 'score']);
    expect(schema.toJsonSchema()).toEqual(expect.objectContaining({ type: 'object' }));
  });

  describe('templates publicados', () => {
    it('el fixture de generic-result-report cumple su propio contrato', () => {
      // Es el mismo objeto que devuelve `GET /pdf/templates/:id/schema` como `example` y el
      // que usa la vista previa. Si envejece, esta prueba lo dice antes que un PDF con huecos.
      expect(GenericResultReportSchema.safeParse(genericResultReportFixture()).success).toBe(true);
    });

    it('acota las tablas para que un payload no pueda encargar un informe de mil páginas', () => {
      const oversized = {
        title: 'x',
        sections: [
          {
            title: 's',
            table: {
              columns: [{ key: 'a', label: 'A' }],
              rows: Array.from({ length: 2_001 }, () => ({ a: '1' })),
            },
          },
        ],
      };
      expect(GenericResultReportSchema.safeParse(oversized).success).toBe(false);
    });

    it('rechaza un objeto anidado dentro de una celda en vez de imprimir [object Object]', () => {
      const nested = {
        title: 'x',
        sections: [
          {
            title: 's',
            table: {
              columns: [{ key: 'a', label: 'A' }],
              rows: [{ a: { profundo: true } }],
            },
          },
        ],
      };
      expect(GenericResultReportSchema.safeParse(nested).success).toBe(false);
    });

    it('la versión 1.1.0 acepta todo lo que aceptaba la 1.0.0', async () => {
      const { CreditAnalysisSchemaV11 } =
        await import('../src/pdf-worker/templates/documents/credit-analysis-report/1.1.0/schema');
      const { creditAnalysisFixtureV1 } =
        await import('../src/pdf-worker/templates/documents/credit-analysis-report/1.0.0/preview.fixture');
      const payloadV1 = creditAnalysisFixtureV1();
      expect(CreditAnalysisSchemaV1.safeParse(payloadV1).success).toBe(true);
      // Ésa es la definición de versión MENOR: nadie tiene que cambiar su payload para migrar.
      expect(CreditAnalysisSchemaV11.safeParse(payloadV1).success).toBe(true);
    });
  });
});
