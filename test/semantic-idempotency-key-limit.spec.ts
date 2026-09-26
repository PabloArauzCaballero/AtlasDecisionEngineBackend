import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { CreateSemanticAnalysisRunDto } from '../src/modules/workers/workers.dto';
import { semanticAnalysisRequestSchema } from '../src/modules/workers/semantic-analysis/core/domain/semantic-analysis.schemas';

/**
 * La API y el dominio tienen que aceptar la MISMA clave de idempotencia.
 *
 * Estaban en 200 y 160. El desajuste no rechazaba la petición: la API la
 * admitía, la encolaba, y el worker fallaba con UNEXPECTED_ANALYSIS_ERROR en los
 * tres intentos. Quien lo veía era el portal clasificando un extracto del BNB,
 * cuyas glosas largas —cuenta destino, nombre y banco— empujan la clave por
 * encima de 160 y dejaban esos movimientos «sin determinar» con cara de fallo
 * del motor.
 */
const LIMITE = 200;

function claveDe(longitud: number): string {
  return 'k'.repeat(longitud);
}

async function laApiAcepta(idempotencyKey: string): Promise<boolean> {
  const dto = plainToInstance(CreateSemanticAnalysisRunDto, {
    text: 'DEBITO EN CUENTA POR TRANS. INTERBANC.',
    idempotencyKey,
  });
  return (await validate(dto)).length === 0;
}

function elDominioAcepta(idempotencyKey: string): boolean {
  return semanticAnalysisRequestSchema.safeParse({
    requestId: '00000000-0000-4000-8000-000000000000',
    idempotencyKey,
    text: 'DEBITO EN CUENTA POR TRANS. INTERBANC.',
  }).success;
}

describe('clave de idempotencia del análisis semántico', () => {
  it('la API y el dominio aceptan la misma longitud máxima', async () => {
    await expect(laApiAcepta(claveDe(LIMITE))).resolves.toBe(true);
    expect(elDominioAcepta(claveDe(LIMITE))).toBe(true);
  });

  it('ninguna clave que la API admita puede reventar después en el worker', async () => {
    for (const longitud of [8, 100, 161, 199, LIMITE]) {
      const clave = claveDe(longitud);
      expect([longitud, elDominioAcepta(clave)]).toEqual([longitud, await laApiAcepta(clave)]);
    }
  });

  it('las dos rechazan lo que se pasa del tope', async () => {
    await expect(laApiAcepta(claveDe(LIMITE + 1))).resolves.toBe(false);
    expect(elDominioAcepta(claveDe(LIMITE + 1))).toBe(false);
  });
});
