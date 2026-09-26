/**
 * La aritmética de discriminación y calibración, contra valores conocidos a mano.
 *
 * Se verifica aquí y no en un servicio porque el riesgo no es que la consulta traiga las filas
 * equivocadas: es que el número esté mal. Un AUC mal calculado no falla, sale 0,74 y alguien
 * aprueba una política con él.
 */
import { calibration, discrimination } from '../src/modules/model-monitoring/discrimination';

describe('discrimination', () => {
  it('separación perfecta da AUC 1, KS 1 y Gini 1', () => {
    const samples = [
      { score: 10, bad: false },
      { score: 20, bad: false },
      { score: 80, bad: true },
      { score: 90, bad: true },
    ];
    expect(discrimination(samples)).toMatchObject({ auc: 1, ks: 1, gini: 1, bad: 2, good: 2 });
  });

  it('empate total da AUC 0,5 y Gini 0', () => {
    // Con todos los puntajes iguales el modelo no distingue nada. El rango MEDIO en los empates
    // es lo que produce el 0,5 correcto; integrando la curva por trapecios saldría optimista.
    const samples = [
      { score: 50, bad: true },
      { score: 50, bad: false },
      { score: 50, bad: true },
      { score: 50, bad: false },
    ];
    expect(discrimination(samples)).toMatchObject({ auc: 0.5, gini: 0, ks: 0 });
  });

  it('orden invertido da AUC 0 — el modelo ordena al revés', () => {
    const samples = [
      { score: 90, bad: false },
      { score: 80, bad: false },
      { score: 20, bad: true },
      { score: 10, bad: true },
    ];
    expect(discrimination(samples).auc).toBe(0);
    expect(discrimination(samples).gini).toBe(-1);
  });

  it('un caso concreto con empate parcial: 0,875', () => {
    // Malos {2, 3}, buenos {1, 2}. Pares: (2>1)=1, (2=2)=0.5, (3>1)=1, (3>2)=1 → 3.5/4.
    const samples = [
      { score: 2, bad: true },
      { score: 3, bad: true },
      { score: 1, bad: false },
      { score: 2, bad: false },
    ];
    expect(discrimination(samples).auc).toBe(0.875);
  });

  it('sin una de las dos clases devuelve null, no 0,5', () => {
    /*
     * No es un caso de borde académico: una cartera joven puede no tener ni un solo malo. Un AUC
     * de 0,5 ahí significaría «el modelo no distingue nada», que es una conclusión falsa sobre un
     * modelo del que todavía no se sabe nada.
     */
    const sinMalos = discrimination([
      { score: 10, bad: false },
      { score: 20, bad: false },
    ]);
    expect(sinMalos).toMatchObject({ auc: null, ks: null, gini: null, good: 2, bad: 0 });
  });

  it('descarta puntajes no finitos sin tumbar el cálculo', () => {
    const samples = [
      { score: Number.NaN, bad: true },
      { score: 10, bad: false },
      { score: 90, bad: true },
    ];
    expect(discrimination(samples)).toMatchObject({ usable: 2, auc: 1 });
  });
});

describe('calibration', () => {
  it('un modelo perfectamente calibrado tiene sesgo cero', () => {
    // 100 casos: PD 0,5 exacta y la mitad malos, alternando para que cada decil quede mixto.
    const samples = Array.from({ length: 100 }, (_, index) => ({
      predicted: 0.5,
      bad: index % 2 === 0,
    }));
    const result = calibration(samples);
    expect(result.meanBias).toBe(0);
    expect(result.buckets).toHaveLength(10);
    expect(result.buckets[0]).toMatchObject({ predictedRate: 0.5, observedRate: 0.5 });
  });

  it('detecta un modelo pesimista: predice el doble de lo que ocurre', () => {
    const samples = Array.from({ length: 100 }, (_, index) => ({
      predicted: 0.4,
      bad: index % 5 === 0,
    }));
    const result = calibration(samples);
    // Predice 40 %, ocurre 20 %: sesgo +0,2. Positivo = pesimista.
    expect(result.meanBias).toBe(0.2);
    expect(result.hosmerLemeshow).toBeGreaterThan(15.5);
  });

  it('corta por cantidad de casos y no por tramos de probabilidad', () => {
    /*
     * Casi toda la cartera se concentra en PD bajas. Con tramos de ancho fijo los nueve primeros
     * deciles saldrían vacíos y el décimo tendría el 90 % de la muestra: una curva de un punto
     * dibujada como si tuviera diez.
     */
    const samples = [
      ...Array.from({ length: 90 }, () => ({ predicted: 0.01, bad: false })),
      ...Array.from({ length: 10 }, () => ({ predicted: 0.9, bad: true })),
    ];
    const result = calibration(samples);
    expect(result.buckets).toHaveLength(10);
    for (const bucket of result.buckets) expect(bucket.sampleSize).toBe(10);
  });

  it('con menos de diez casos no dibuja una curva', () => {
    expect(calibration([{ predicted: 0.5, bad: true }])).toMatchObject({
      buckets: [],
      hosmerLemeshow: null,
    });
  });

  it('un decil con varianza nula se omite en vez de hacer infinito el estadístico', () => {
    const samples = Array.from({ length: 20 }, () => ({ predicted: 0, bad: false }));
    expect(calibration(samples).hosmerLemeshow).toBe(0);
  });
});
