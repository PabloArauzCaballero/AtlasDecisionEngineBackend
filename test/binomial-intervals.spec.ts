import {
  clopperPearson,
  describeInterval,
  recruitmentSize,
  ruleOfThree,
  sampleSizeForPrecision,
  trialsForZeroErrors,
  wilson,
  zeroErrorUpperBound,
} from '../src/common/statistics/binomial';
import { TAMANOS_SIN_ERRORES } from '../src/modules/workers/identity-verification/core/corpus/corpus-identidad.generated';

/**
 * Las cifras contra las que se comprueba esta implementación NO las escribimos
 * nosotros: vienen calculadas dentro de los dos corpus, y el de identidad trae
 * además la tabla entera de tamaños sin errores. Es la clase de prueba que vale
 * la pena: un oráculo independiente.
 */
describe('intervalos binomiales', () => {
  it('reproduce la tabla de tamaños sin errores del corpus de identidad', () => {
    expect(TAMANOS_SIN_ERRORES.length).toBeGreaterThan(0);
    for (const fila of TAMANOS_SIN_ERRORES) {
      expect(trialsForZeroErrors(fila.tasaObjetivo, fila.confianza)).toBe(fila.ensayos);
      expect(zeroErrorUpperBound(fila.ensayos, fila.confianza)).toBeCloseTo(fila.cotaSuperior, 12);
    }
  });

  it('cero falsos positivos sobre 299 documentos no demuestra tasa cero', () => {
    // `FALSE_POSITIVES_299` del corpus de extractos: la cota, no el cero.
    expect(zeroErrorUpperBound(299, 0.95)).toBeCloseTo(0.009969146792899286, 15);
    const intervalo = clopperPearson(0, 299, 0.95);
    expect(intervalo.lower).toBe(0);
    expect(intervalo.upper).toBeGreaterThan(0);
  });

  it('el 81 % de 21 casos es, en realidad, entre 60 % y 92 %', () => {
    // `CLASSIFIER_21`: el corpus interpreta el 81 % redondeado como 17 de 21.
    const intervalo = wilson(17, 21, 0.95);
    expect(intervalo.lower).toBeCloseTo(0.5999943530979508, 9);
    expect(intervalo.upper).toBeCloseTo(0.9233243494723822, 9);
    expect(describeInterval(intervalo)).toContain('17/21');
  });

  it('Clopper-Pearson es más ancho que Wilson, que es lo que se le pide', () => {
    const exacto = clopperPearson(3, 40);
    const aproximado = wilson(3, 40);
    expect(exacto.lower).toBeLessThanOrEqual(aproximado.lower);
    expect(exacto.upper).toBeGreaterThanOrEqual(aproximado.upper);
  });

  it('reproduce los tamaños de muestra por precisión del corpus de extractos', () => {
    // 865 casos para medir una tasa del 10 % con ±2 puntos al 95 %.
    expect(sampleSizeForPrecision(0.1, 0.02, 0.95)).toBe(865);
    expect(sampleSizeForPrecision(0.1, 0.01, 0.95)).toBe(3458);
    expect(sampleSizeForPrecision(0.05, 0.01, 0.95)).toBe(1825);
    // Prevalencia desconocida: el escenario conservador es p = 0,5.
    expect(sampleSizeForPrecision(0.5, 0.05, 0.95)).toBe(385);
  });

  it('el ajuste por conglomerados sube el reclutamiento, no lo baja', () => {
    // 865 casos independientes, DEFF 1,5 y 80 % de seguimiento completo → 1622.
    expect(recruitmentSize(865, 1.5, 0.8)).toBe(1622);
  });

  it('la regla de tres es una aproximación, no la cota exacta', () => {
    expect(ruleOfThree(100)).toBeCloseTo(0.02995732, 8);
    // Y se parece a la exacta sin ser igual: por eso existen las dos.
    expect(Math.abs(ruleOfThree(100) - zeroErrorUpperBound(100, 0.95))).toBeLessThan(0.001);
  });

  it('un intervalo exige ensayos independientes y lo dice en su forma', () => {
    const intervalo = wilson(5, 10);
    expect(intervalo.trials).toBe(10);
    expect(intervalo.successes).toBe(5);
    expect(() => wilson(11, 10)).toThrow();
    expect(() => wilson(1, 0)).toThrow();
  });
});
