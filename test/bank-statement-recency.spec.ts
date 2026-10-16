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
  stalenessMessage,
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

  it('rechaza el que cierra antes del último mes completo y de la tolerancia', () => {
    // Hoy 31/08: el último mes completo es julio (cierra el 31/07); con tres días, desde el 28/07.
    const resultado = assessRecency('2026-07-27', opciones());
    expect(resultado.verdict).toBe('STALE');
    expect(resultado.disposition).toBe('REJECT');
    expect(resultado.ageDays).toBe(35);
    expect(resultado.reasons).toContain('antiguedad:35d');
    expect(resultado.reasons).toContain('cierre-de-mes-admitido-desde:2026-07-28');
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

  /*
   * 2026-10-16: «los últimos 3 meses completos» es lo que se le pide a la persona y lo que la banca ofrece. Un
   * extracto de julio a septiembre descargado el 16 de octubre tiene 16 días y antes se rechazaba como vencido.
   */
  describe('el extracto que cierra el último mes completo', () => {
    const el = (iso: string) => normalizeRecencyOptions({ now: () => new Date(iso) });

    it('julio–septiembre el 16/10 se admite; el 30/04 sigue vencido', () => {
      const octubre = el('2026-10-16T15:00:00Z');
      const septiembre = assessRecency('2026-09-30', octubre);
      expect(septiembre.verdict).toBe('CURRENT');
      expect(septiembre.reasons).toContain('cierra-el-ultimo-mes-completo:2026-09-30');
      expect(assessRecency('2026-09-27', octubre).verdict).toBe('CURRENT');
      expect(assessRecency('2026-09-26', octubre).verdict).toBe('STALE');
      expect(assessRecency('2026-04-30', octubre).verdict).toBe('STALE');
    });

    it('el día 1 del mes, el mes anterior ya es el completo', () => {
      const primero = el('2026-11-01T15:00:00Z');
      expect(assessRecency('2026-10-31', primero).verdict).toBe('CURRENT');
      expect(assessRecency('2026-10-28', primero).verdict).toBe('CURRENT');
      expect(assessRecency('2026-10-27', primero).verdict).toBe('STALE');
    });

    it('meses de 28, 29, 30 y 31 días', () => {
      expect(assessRecency('2026-02-25', el('2026-03-20T15:00:00Z')).verdict).toBe('CURRENT'); // 28/02 − 3
      expect(assessRecency('2026-02-24', el('2026-03-20T15:00:00Z')).verdict).toBe('STALE');
      expect(assessRecency('2028-02-26', el('2028-03-20T15:00:00Z')).verdict).toBe('CURRENT'); // bisiesto: 29/02 − 3
      expect(assessRecency('2028-02-25', el('2028-03-20T15:00:00Z')).verdict).toBe('STALE');
      expect(assessRecency('2026-06-27', el('2026-07-20T15:00:00Z')).verdict).toBe('CURRENT'); // 30/06 − 3
      expect(assessRecency('2026-06-26', el('2026-07-20T15:00:00Z')).verdict).toBe('STALE');
      expect(assessRecency('2026-12-28', el('2027-01-20T15:00:00Z')).verdict).toBe('CURRENT'); // 31/12 − 3, cambio de año
      expect(assessRecency('2026-12-27', el('2027-01-20T15:00:00Z')).verdict).toBe('STALE');
    });

    it('el mes se cuenta en la hora de Bolivia, no en UTC', () => {
      // 02:00 UTC del 1/10 son las 22:00 del 30/09 en La Paz: el último mes completo todavía es agosto.
      const finDeSeptiembreEnLaPaz = el('2026-10-01T02:00:00Z');
      expect(assessRecency('2026-08-31', finDeSeptiembreEnLaPaz).verdict).toBe('CURRENT');
      expect(assessRecency('2026-08-27', finDeSeptiembreEnLaPaz).verdict).toBe('STALE');
      // 05:00 UTC del 1/10 ya es el 1/10 en La Paz: septiembre es el mes completo.
      const primeroEnLaPaz = el('2026-10-01T05:00:00Z');
      expect(assessRecency('2026-09-27', primeroEnLaPaz).verdict).toBe('CURRENT');
    });

    it('la frase de rechazo pide lo mismo que la app', () => {
      const vencido = assessRecency('2026-04-30', el('2026-10-16T15:00:00Z'));
      expect(stalenessMessage(vencido)).toContain(
        'los últimos 3 meses completos (por ejemplo, de julio a septiembre) o hasta hoy',
      );
    });
  });
});
