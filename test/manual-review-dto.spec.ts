import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AuditEventKeysetQueryDto,
  AuditEventSearchQueryDto,
} from '../src/modules/audit-query/audit-query.dto';
import {
  ManualReviewListQueryDto,
  ResolveManualReviewDto,
} from '../src/modules/manual-review/manual-review.dto';

/**
 * El Motor valida con `ValidationPipe({ whitelist, forbidNonWhitelisted })`: un valor o un
 * parámetro que el DTO no declara es un 400. Estas pruebas son el contrato que el portal copia:
 * si cambian, hay que tocar `resolution-options.ts` y `resource.config*.ts` del portal a la vez.
 */
async function errores<T extends object>(clase: new () => T, plano: Record<string, unknown>) {
  const instancia = plainToInstance(clase, plano);
  const fallos = await validate(instancia, { whitelist: true, forbidNonWhitelisted: true });
  return fallos.map((fallo) => fallo.property);
}

describe('ResolveManualReviewDto', () => {
  it.each(['APPROVE', 'DECLINE', 'CANCEL'])('acepta %s', async (decision) => {
    expect(await errores(ResolveManualReviewDto, { decision, reason: 'motivo' })).toEqual([]);
  });

  it.each(['REJECT', 'ESCALATE', 'approve', ''])(
    'rechaza %s con 400: no es una salida de la revisión',
    async (decision) => {
      expect(await errores(ResolveManualReviewDto, { decision, reason: 'motivo' })).toEqual([
        'decision',
      ]);
    },
  );
});

describe('parámetros de búsqueda declarados', () => {
  it('la cola de revisión declara `search` (sin declararlo sería un 400 por forbidNonWhitelisted)', async () => {
    expect(await errores(ManualReviewListQueryDto, { search: 'MR-2026' })).toEqual([]);
    expect(await errores(ManualReviewListQueryDto, { buscar: 'MR-2026' })).toEqual(['buscar']);
  });

  it('la bitácora declara `search` en la vista por página y en la de cursor', async () => {
    expect(await errores(AuditEventSearchQueryDto, { search: 'DEPLOY' })).toEqual([]);
    expect(await errores(AuditEventKeysetQueryDto, { search: 'DEPLOY' })).toEqual([]);
  });

  it('`search` tiene tope de longitud', async () => {
    expect(await errores(ManualReviewListQueryDto, { search: 'x'.repeat(121) })).toEqual([
      'search',
    ]);
    expect(await errores(AuditEventSearchQueryDto, { search: 'x'.repeat(121) })).toEqual([
      'search',
    ]);
  });
});
