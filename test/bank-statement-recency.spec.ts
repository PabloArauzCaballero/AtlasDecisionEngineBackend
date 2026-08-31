/**
 * La compuerta de vigencia: hasta cuándo sirve un extracto.
 *
 * Se prueba sin PDF a propósito. La compuerta no lee bytes: recibe el último día
 * de la ventana observada y lo compara con hoy, así que meterla en la suite que
 * carga `pdfjs-dist` la haría tardar segundos por caso y no demostraría nada más.
 *
 * Todos los casos fijan el reloj. Una prueba de caducidad que lea la hora del
 * proceso demuestra hoy la vigencia y mañana la caducidad, que es la definición
 * de una prueba que no prueba nada.
 */
import {
  assessRecency,
  normalizeRecencyOptions,
  DEFAULT_RECENCY_OPTIONS,
  type RecencyGateOptions,
} from '../src/modules/workers/bank-statement/core/engine/recency/recency-gate';

const HOY = new Date('2026-08-31T15:00:00Z');

function opciones(overrides: Partial<RecencyGateOptions> = {}): RecencyGateOptions {
  return normalizeRecencyOptions({ now: () => HOY, ...overrides });
}

describe('compuerta de vigencia del extracto', () => {
  it('acepta el extracto que cierra hoy', () => {
    const resultado = assessRecency('2026-08-31', opciones());
    expect(resultado.verdict).toBe('CURRENT');
    expect(resultado.disposition).toBe('ACCEPT');
    expect(resultado.ageDays).toBe(0);
    expect(resultado.evaluatedOn).toBe('2026-08-31');
  });

  /*
   * El caso que justifica la tolerancia entera: quien descarga su extracto el
   * lunes por la mañana tiene su último movimiento el viernes. Sin los tres días,
   * la compuerta rechazaría a todo el que no opere en fin de semana.
   */
  it('acepta hasta tres días de desfase, que es el fin de semana', () => {
    for (const dia of ['2026-08-30', '2026-08-29', '2026-08-28']) {
      const resultado = assessRecency(dia, opciones());
      expect(resultado.verdict).toBe('CURRENT');
      expect(resultado.disposition).toBe('ACCEPT');
    }
  });

  it('rechaza el que cierra un día más allá de la tolerancia', () => {
    const resultado = assessRecency('2026-08-27', opciones());
    expect(resultado.verdict).toBe('STALE');
    expect(resultado.disposition).toBe('REJECT');
    expect(resultado.ageDays).toBe(4);
    expect(resultado.reasons).toContain('antiguedad:4d');
  });

  it('rechaza el extracto de hace tres meses aunque cubra doce', () => {
    // Es el documento que la política de meses da por bueno y la vigencia no:
    // cobertura y actualidad son dos preguntas distintas sobre la misma ventana.
    const resultado = assessRecency('2026-05-31', opciones());
    expect(resultado.verdict).toBe('STALE');
    expect(resultado.disposition).toBe('REJECT');
    expect(resultado.ageDays).toBe(92);
  });

  /*
   * En modo de medición el VEREDICTO se conserva y sólo se relaja el desenlace.
   * Guardar el veredicto real es lo que permite responder «¿cuántos rechazaríamos?»
   * sin haber rechazado ninguno todavía.
   */
  it('sin exigir, mide y deja pasar sin perder el veredicto', () => {
    const resultado = assessRecency('2026-01-15', opciones({ enforce: false }));
    expect(resultado.verdict).toBe('STALE');
    expect(resultado.disposition).toBe('ACCEPT');
    expect(resultado.reasons).toContain('compuerta-en-medicion');
  });

  it('manda a revisión —no rechaza— el que termina en el futuro', () => {
    const resultado = assessRecency('2026-09-20', opciones());
    expect(resultado.verdict).toBe('FUTURE_DATED');
    expect(resultado.disposition).toBe('REVIEW');
    expect(resultado.reasons).toContain('posible-orden-de-fecha-invertido');
  });

  it('tolera el adelanto pequeño, que es zona horaria y no fraude', () => {
    expect(assessRecency('2026-09-02', opciones()).verdict).toBe('CURRENT');
  });

  it('manda a revisión el que no tiene fecha que medir', () => {
    const resultado = assessRecency(null, opciones());
    expect(resultado.verdict).toBe('UNDATED');
    expect(resultado.disposition).toBe('REVIEW');
    expect(resultado.ageDays).toBeNull();
  });

  /*
   * El día se toma en UTC en los dos lados. Con el reloj a las 03:00 UTC —que en
   * Bolivia son las 23:00 del día anterior— una comparación en hora local
   * desplazaría la antigüedad un día entero, y una tolerancia de tres no
   * sobrevive a un error de uno.
   */
  it('mide en días UTC completos, no en horas', () => {
    const casiMedianoche = normalizeRecencyOptions({
      now: () => new Date('2026-08-31T23:59:59Z'),
    });
    const recienEmpezado = normalizeRecencyOptions({
      now: () => new Date('2026-08-31T00:00:01Z'),
    });
    expect(assessRecency('2026-08-28', casiMedianoche).ageDays).toBe(3);
    expect(assessRecency('2026-08-28', recienEmpezado).ageDays).toBe(3);
  });

  it('sanea las tolerancias negativas o absurdas contra las de por defecto', () => {
    const saneadas = normalizeRecencyOptions({ toleranceDays: -5, futureToleranceDays: NaN });
    expect(saneadas.toleranceDays).toBe(DEFAULT_RECENCY_OPTIONS.toleranceDays);
    expect(saneadas.futureToleranceDays).toBe(DEFAULT_RECENCY_OPTIONS.futureToleranceDays);
  });
});
