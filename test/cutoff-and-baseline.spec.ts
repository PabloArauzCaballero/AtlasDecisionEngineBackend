/**
 * Las dos piezas que convierten la vigilancia en algo accionable, y su aritmética.
 *
 *  - `psiAgainstBaseline` compara la población de hoy contra una referencia CONGELADA. Es la
 *    variante que usa la vigilancia programada, distinta de la que compara dos muestras.
 *  - `bucketOfValue` es la categorización compartida. Tenía tres copias, y la única forma de que
 *    el índice signifique algo es que las tres coincidan exactamente.
 */
import {
  bucketOfSnapshot,
  bucketOfValue,
  psiAgainstBaseline,
} from '../src/modules/model-monitoring/monitoring-analytics';

describe('bucketOfValue', () => {
  it('agrupa los numéricos en escala logarítmica', () => {
    // Sin agrupar, cada valor distinto sería su propia categoría y el PSI mediría ruido.
    expect(bucketOfValue(1_000)).toBe(bucketOfValue(1_100));
    expect(bucketOfValue(10)).not.toBe(bucketOfValue(1_000_000));
  });

  it('de un valor sensible sólo conserva su presencia como categoría opaca', () => {
    // Llega como `{ valueHash, source }`: la deriva se detecta si cambia el reparto de valores
    // distintos, no su magnitud. Es una limitación real y preferible a guardar el valor.
    expect(bucketOfValue({ valueHash: 'abcdef1234567890', source: 'BURO' })).toBe('h:abcdef123456');
  });

  it('ignora lo que no aporta categoría', () => {
    expect(bucketOfValue(null)).toBeNull();
    expect(bucketOfValue(undefined)).toBeNull();
    expect(bucketOfValue({ sinHash: true })).toBeNull();
  });

  it('lee una variable del snapshot de entrada', () => {
    expect(bucketOfSnapshot({ ingresos: 5_000 }, 'ingresos')).toBe(bucketOfValue(5_000));
    expect(bucketOfSnapshot({ ingresos: 5_000 }, 'otra')).toBeNull();
    expect(bucketOfSnapshot(null, 'ingresos')).toBeNull();
  });
});

describe('psiAgainstBaseline', () => {
  it('una población idéntica a su referencia da PSI cero', () => {
    const referencia = { 'n:3': 0.5, 'n:6': 0.5 };
    const actual = [...Array(50).fill('n:3'), ...Array(50).fill('n:6')];
    const resultado = psiAgainstBaseline(referencia, actual);
    expect(resultado.psi).toBeCloseTo(0, 6);
    expect(resultado.verdict).toBe('STABLE');
  });

  it('detecta una población que se dio la vuelta', () => {
    const referencia = { 'n:3': 0.9, 'n:6': 0.1 };
    const actual = [...Array(10).fill('n:3'), ...Array(90).fill('n:6')];
    const resultado = psiAgainstBaseline(referencia, actual);
    expect(resultado.psi).toBeGreaterThan(0.25);
    expect(resultado.verdict).toBe('UNSTABLE');
  });

  it('un cubo nuevo no hace estallar el índice', () => {
    /*
     * El cubo que existe en una orilla y no en la otra daría `log(0)` —infinito— y un solo caso
     * raro convertiría el índice en una alarma permanente. El suelo lo evita.
     */
    const resultado = psiAgainstBaseline({ 'n:3': 1 }, ['n:3', 'n:9']);
    expect(Number.isFinite(resultado.psi)).toBe(true);
  });

  it('sin referencia o sin muestra actual no inventa deriva', () => {
    // Una versión promovida por primera vez no tiene población previa. Devolver un PSI alto ahí
    // sería declarar inestable un modelo del que todavía no se sabe nada.
    expect(psiAgainstBaseline({}, ['n:3']).psi).toBe(0);
    expect(psiAgainstBaseline({ 'n:3': 1 }, []).psi).toBe(0);
  });

  it('publica los cubos ordenados por cuánto aportan a la deriva', () => {
    // Quien lo mira necesita saber QUÉ se movió, no sólo cuánto: el primer cubo es por dónde
    // empezar a buscar.
    const resultado = psiAgainstBaseline(
      { 'n:1': 0.4, 'n:2': 0.4, 'n:3': 0.2 },
      [...Array(80).fill('n:3'), ...Array(10).fill('n:1'), ...Array(10).fill('n:2')],
    );
    expect(resultado.buckets[0].bucket).toBe('n:3');
  });
});
