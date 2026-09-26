import { ConfigService } from '@nestjs/config';
import { UnresolvedReevaluationService } from '../src/modules/workers/semantic-analysis/unresolved-reevaluation.service';

/**
 * Qué se cierra solo y qué se queda esperando a una persona.
 *
 * Son tres reglas y las tres tienen una razón medida detrás:
 *
 * - El modelo con confianza ALTA cierra. El listón nació de un caso real: con el
 *   umbral normal, «POS LIBROS LIBRERIA TEST SABER» se cerró como transporte
 *   público con 0,79, y la duda quedó archivada como hecho.
 * - La REGLA de instrumento cierra con menos. No es una similitud: el mismo
 *   texto da el mismo resultado siempre. Pedirle 0,9 dejó una bandeja de 81
 *   pendientes que el motor ya sabía resolver, pidiendo trabajo humano inútil.
 * - El CAJÓN «Otros» no cierra nunca. Significa «el concepto no consta», que es
 *   exactamente el caso que necesita a alguien; sacarlo de la bandeja lo
 *   enterraría y además enseñaría un alias hacia el cajón.
 */

/** El método es privado a propósito; la prueba mide la POLÍTICA, no la API. */
function decide(
  servicio: UnresolvedReevaluationService,
  veredicto: { confidence: number | null; categoryCode: string | null },
): boolean {
  return (
    servicio as unknown as {
      bastante(v: { confidence: number | null; categoryCode: string | null }): boolean;
    }
  ).bastante(veredicto);
}

function servicio(extra: Record<string, unknown> = {}): UnresolvedReevaluationService {
  return new UnresolvedReevaluationService(
    {} as never,
    {} as never,
    new ConfigService({
      UNRESOLVED_HIGH_CONFIDENCE: 0.9,
      UNRESOLVED_AUTO_CLOSE_FLOOR: 0.75,
      ...extra,
    }),
  );
}

describe('qué cierra la reevaluación sin que nadie mire', () => {
  const bajo = servicio();

  it('cierra lo que el modelo decidió con confianza alta', () => {
    expect(decide(bajo, { confidence: 0.94, categoryCode: 'GASTOS.SALUD.FARMACIA' })).toBe(true);
  });

  it('cierra una decisión por regla, que es determinista', () => {
    expect(decide(bajo, { confidence: 0.75, categoryCode: 'GASTOS.TRANSFERENCIAS' })).toBe(true);
  });

  it('NO cierra el cajón «Otros», por muy alta que fuera la confianza', () => {
    expect(decide(bajo, { confidence: 0.99, categoryCode: 'GASTOS.OTROS' })).toBe(false);
    expect(decide(bajo, { confidence: 0.99, categoryCode: 'INGRESOS.OTROS' })).toBe(false);
  });

  it('NO cierra por debajo del suelo', () => {
    expect(decide(bajo, { confidence: 0.4, categoryCode: 'GASTOS.COMPRAS.QR' })).toBe(false);
  });

  it('sin confianza no cierra: la ausencia de dato no es un dato', () => {
    expect(decide(bajo, { confidence: null, categoryCode: 'GASTOS.COMPRAS.QR' })).toBe(false);
  });

  /*
   * El suelo es configurable y puede subirse por encima del listón alto. En ese
   * caso manda el más EXIGENTE de los dos: quien endurece uno no espera que el
   * otro le abra la puerta por detrás.
   */
  it('un suelo más exigente que el listón alto manda sobre él', () => {
    const estricto = servicio({ UNRESOLVED_AUTO_CLOSE_FLOOR: 0.99 });
    expect(decide(estricto, { confidence: 0.94, categoryCode: 'GASTOS.SALUD.FARMACIA' })).toBe(
      true,
    );
    const alRevés = servicio({ UNRESOLVED_HIGH_CONFIDENCE: 0.5 });
    expect(decide(alRevés, { confidence: 0.6, categoryCode: 'GASTOS.SALUD.FARMACIA' })).toBe(true);
  });
});
