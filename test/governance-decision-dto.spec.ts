import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  APPROVAL_COMMENT_MAX_LENGTH,
  APPROVAL_COMMENT_MIN_LENGTH,
  RecordApprovalDecisionDto,
} from '../src/modules/governance/governance.dto';

/**
 * MOT-09 (ISO 27002 8.32): la justificación de una firma de gobierno es obligatoria en la API,
 * no sólo en el portal. Sin esto, una llamada directa aprobaba una versión sin dejar ni una palabra
 * en la bitácora.
 */
async function errores(plano: Record<string, unknown>) {
  const instancia = plainToInstance(RecordApprovalDecisionDto, plano);
  const fallos = await validate(instancia, { whitelist: true, forbidNonWhitelisted: true });
  return { propiedades: fallos.map((fallo) => fallo.property), instancia };
}

const COMENTARIO = 'Revisé cobertura, umbrales y la prueba de regresión.';

describe('RecordApprovalDecisionDto — comentario obligatorio', () => {
  it.each(['APPROVE', 'REQUEST_CHANGES', 'REJECT'])(
    'acepta %s con comentario',
    async (decision) => {
      const { propiedades } = await errores({ decision, comments: COMENTARIO, evidence: [] });
      expect(propiedades).toEqual([]);
    },
  );

  it.each(['APPROVE', 'REQUEST_CHANGES', 'REJECT'])(
    'rechaza %s sin comentario',
    async (decision) => {
      const { propiedades } = await errores({ decision, evidence: [] });
      expect(propiedades).toEqual(['comments']);
    },
  );

  it.each([
    ['vacío', ''],
    ['sólo espacios', '      \n\t      '],
    ['demasiado corto', 'ok'],
    ['corto tras recortar', `   ${'x'.repeat(APPROVAL_COMMENT_MIN_LENGTH - 1)}   `],
    ['no es texto', 12345678901],
    ['nulo', null],
  ])('rechaza un comentario %s', async (_caso, comments) => {
    const { propiedades } = await errores({ decision: 'APPROVE', comments, evidence: [] });
    expect(propiedades).toEqual(['comments']);
  });

  it('acepta exactamente el mínimo y recorta los espacios de los extremos', async () => {
    const justo = 'x'.repeat(APPROVAL_COMMENT_MIN_LENGTH);
    const { propiedades, instancia } = await errores({
      decision: 'APPROVE',
      comments: `  ${justo}  `,
      evidence: [],
    });
    expect(propiedades).toEqual([]);
    expect(instancia.comments).toBe(justo);
  });

  it('rechaza un comentario por encima del máximo', async () => {
    const { propiedades } = await errores({
      decision: 'APPROVE',
      comments: 'x'.repeat(APPROVAL_COMMENT_MAX_LENGTH + 1),
      evidence: [],
    });
    expect(propiedades).toEqual(['comments']);
  });
});
