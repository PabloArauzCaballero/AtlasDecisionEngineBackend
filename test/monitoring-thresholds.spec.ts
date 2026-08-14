/**
 * Los umbrales que convierten una medición en veredicto.
 *
 * Se prueban aquí porque su fallo no se ve: un corte mal puesto no rompe nada, simplemente deja de
 * avisar —o avisa siempre, que acaba siendo lo mismo cuando quien lo lee aprende a ignorarlo.
 */
import { MonitoringVerdict } from '@prisma/client';
import { METRIC, thresholdOf, verdictFor } from '../src/modules/model-monitoring/monitoring-thresholds';

const { OK, WATCH, BREACH } = MonitoringVerdict;

describe('verdictFor', () => {
  it('PSI: más alto es peor', () => {
    expect(verdictFor(METRIC.psi, 0.05, 1_000)).toBe(OK);
    expect(verdictFor(METRIC.psi, 0.15, 1_000)).toBe(WATCH);
    expect(verdictFor(METRIC.psi, 0.4, 1_000)).toBe(BREACH);
  });

  it('impacto adverso: más BAJO es peor (regla de los cuatro quintos)', () => {
    // La dirección invertida es el error fácil de este módulo: un 0,7 aquí es lo grave.
    expect(verdictFor(METRIC.adverseImpactRatio, 1, 1_000)).toBe(OK);
    expect(verdictFor(METRIC.adverseImpactRatio, 0.85, 1_000)).toBe(WATCH);
    expect(verdictFor(METRIC.adverseImpactRatio, 0.7, 1_000)).toBe(BREACH);
  });

  it('AUC y KS también son «más bajo es peor»', () => {
    expect(verdictFor(METRIC.auc, 0.78, 1_000)).toBe(OK);
    expect(verdictFor(METRIC.auc, 0.5, 1_000)).toBe(BREACH);
    expect(verdictFor(METRIC.ks, 0.45, 1_000)).toBe(OK);
    expect(verdictFor(METRIC.ks, 0.1, 1_000)).toBe(BREACH);
  });

  it('con muestra insuficiente devuelve OK, no alarma', () => {
    /*
     * Deliberado y discutible. Un veredicto rojo sobre doce casos entrena a quien lo lee a
     * ignorar el color, y a partir de ahí el gate no sirve para nada. La muestra viaja en la
     * fila, así que la pantalla puede decir «sin datos suficientes» sin que eso sea una alarma.
     */
    expect(verdictFor(METRIC.psi, 0.9, 12)).toBe(OK);
    expect(verdictFor(METRIC.adverseImpactRatio, 0.1, 12)).toBe(OK);
  });

  it('la frescura de la vigilancia se juzga SIEMPRE, sin muestra mínima', () => {
    // Es la métrica que vigila a las demás: exigirle muestra la volvería silenciosa justo en el
    // caso que existe para detectar, que es que no haya nada que medir porque se paró.
    expect(verdictFor(METRIC.monitoringFreshness, 2, 1)).toBe(OK);
    expect(verdictFor(METRIC.monitoringFreshness, 30, 1)).toBe(WATCH);
    expect(verdictFor(METRIC.monitoringFreshness, 72, 1)).toBe(BREACH);
  });

  it('una métrica desconocida no inventa alarmas', () => {
    expect(verdictFor('INVENTADA', 999, 10_000)).toBe(OK);
    expect(thresholdOf('INVENTADA')).toBe(0);
  });

  it('el umbral que se persiste es el de BREACH, para que la fila se lea sin el código', () => {
    expect(thresholdOf(METRIC.psi)).toBe(0.25);
    expect(thresholdOf(METRIC.adverseImpactRatio)).toBe(0.8);
  });
});
