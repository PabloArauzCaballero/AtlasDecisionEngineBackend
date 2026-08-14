/**
 * La frescura del dato: el control que estaba declarado y no existía.
 *
 * `freshnessSlaSeconds` vivía en el esquema desde el principio sin que nada lo comprobara. Estas
 * pruebas fijan las tres decisiones que hacen que estrenarlo no tumbe el motor: sin fecha no hay
 * viejo, sin SLA no hay viejo, y un reloj adelantado no produce un dato eternamente fresco.
 */
import { FreshnessPolicy } from '@prisma/client';
import { evaluateFreshness } from '../src/modules/variables/freshness';

const AHORA = new Date('2026-08-12T12:00:00.000Z');
const haceSegundos = (seconds: number) => new Date(AHORA.getTime() - seconds * 1_000);

describe('evaluateFreshness', () => {
  it('un dato dentro de su SLA no está viejo', () => {
    const verdict = evaluateFreshness(
      { observedAt: haceSegundos(30) },
      60,
      FreshnessPolicy.REJECT,
      AHORA,
    );
    expect(verdict).toMatchObject({ ageSeconds: 30, stale: false, reject: false, degraded: false });
  });

  it('REJECT rechaza el dato fuera de SLA', () => {
    const verdict = evaluateFreshness(
      { observedAt: haceSegundos(3_600) },
      60,
      FreshnessPolicy.REJECT,
      AHORA,
    );
    expect(verdict).toMatchObject({ ageSeconds: 3_600, stale: true, reject: true, degraded: false });
  });

  it('DEGRADE lo acepta y lo marca', () => {
    // La decisión sigue siendo válida; lo que no vale es que no se pueda distinguir de una
    // tomada con datos frescos.
    const verdict = evaluateFreshness(
      { observedAt: haceSegundos(3_600) },
      60,
      FreshnessPolicy.DEGRADE,
      AHORA,
    );
    expect(verdict).toMatchObject({ stale: true, reject: false, degraded: true });
  });

  it('IGNORE anota la antigüedad y no marca nada', () => {
    const verdict = evaluateFreshness(
      { observedAt: haceSegundos(3_600) },
      60,
      FreshnessPolicy.IGNORE,
      AHORA,
    );
    expect(verdict).toMatchObject({ ageSeconds: 3_600, stale: true, reject: false, degraded: false });
  });

  it('sin fecha declarada NO se considera viejo', () => {
    /*
     * La decisión discutible de este módulo. La mayoría de integraciones vivas no mandan
     * `observedAt`, y tratarlas como infinitamente viejas convertiría el estreno de esta
     * comprobación en una caída general del camino de decisión. Queda `ageSeconds: null`, que
     * es medible: subir esa cobertura es el paso previo a poder exigir REJECT de verdad.
     */
    const verdict = evaluateFreshness({}, 60, FreshnessPolicy.REJECT, AHORA);
    expect(verdict).toMatchObject({ ageSeconds: null, stale: false, reject: false });
  });

  it('sin SLA declarado tampoco', () => {
    // `slaSeconds = 0` es el valor con el que están sembradas casi todas las fuentes. Leerlo
    // como «tiene que ser instantáneo» dejaría fuera absolutamente todo.
    const verdict = evaluateFreshness(
      { observedAt: haceSegundos(86_400) },
      0,
      FreshnessPolicy.REJECT,
      AHORA,
    );
    expect(verdict).toMatchObject({ ageSeconds: 86_400, stale: false, reject: false });
  });

  it('usa fetchedAt cuando no hay observedAt, pero prefiere observedAt', () => {
    const soloFetch = evaluateFreshness({ fetchedAt: haceSegundos(100) }, 60, FreshnessPolicy.DEGRADE, AHORA);
    expect(soloFetch.ageSeconds).toBe(100);

    const ambos = evaluateFreshness(
      { observedAt: haceSegundos(10), fetchedAt: haceSegundos(100) },
      60,
      FreshnessPolicy.DEGRADE,
      AHORA,
    );
    // Lo que importa es cuándo era CIERTO el valor, no cuándo se fue a buscar.
    expect(ambos.ageSeconds).toBe(10);
    expect(ambos.stale).toBe(false);
  });

  it('descarta una fecha en el futuro en vez de creerla', () => {
    /*
     * Un reloj adelantado en el origen produciría antigüedad negativa y con ella un dato
     * eternamente fresco: justo el fallo que este control existe para impedir, y silencioso.
     */
    const futuro = new Date(Date.now() + 86_400_000).toISOString();
    expect(evaluateFreshness({ observedAt: futuro }, 60, FreshnessPolicy.REJECT).ageSeconds).toBeNull();
  });

  it('una fecha ilegible se descarta sin romper la decisión', () => {
    expect(evaluateFreshness({ observedAt: 'ayer por la tarde' }, 60, FreshnessPolicy.REJECT).ageSeconds).toBeNull();
  });
});
