/**
 * La frescura del dato: el control que estaba declarado y no existía.
 *
 * `freshnessSlaSeconds` vivía en el esquema desde el principio sin que nada lo comprobara. Estas
 * pruebas fijan las tres decisiones que hacen que estrenarlo no tumbe el motor: sin fecha no hay
 * viejo, sin SLA no hay viejo, y un reloj adelantado no produce un dato eternamente fresco.
 */
import { ConfigService } from '@nestjs/config';
import { FreshnessPolicy } from '@prisma/client';
import { HashService } from '../src/common/crypto/hash.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import type { VariableContractSnapshot } from '../src/modules/graph/graph.types';
import { evaluateFreshness } from '../src/modules/variables/freshness';
import { VariableResolutionService } from '../src/modules/variables/variable-resolution.service';

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
    expect(verdict).toMatchObject({
      ageSeconds: 3_600,
      stale: true,
      reject: true,
      degraded: false,
    });
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
    expect(verdict).toMatchObject({
      ageSeconds: 3_600,
      stale: true,
      reject: false,
      degraded: false,
    });
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
    const soloFetch = evaluateFreshness(
      { fetchedAt: haceSegundos(100) },
      60,
      FreshnessPolicy.DEGRADE,
      AHORA,
    );
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
    expect(
      evaluateFreshness({ observedAt: futuro }, 60, FreshnessPolicy.REJECT).ageSeconds,
    ).toBeNull();
  });

  it('una fecha ilegible no se vuelve «sin fecha»: se marca como sello inválido', () => {
    // Con DEGRADE la decisión sigue, pero marcada; antes se descartaba y pasaba por dato limpio.
    const verdict = evaluateFreshness(
      { observedAt: 'ayer por la tarde' },
      60,
      FreshnessPolicy.DEGRADE,
      AHORA,
    );
    expect(verdict).toMatchObject({
      ageSeconds: null,
      timestampStatus: 'INVALID',
      degraded: true,
      reason: 'TIMESTAMP_INVALID',
    });
  });
});

describe('evaluateFreshness · política explícita para sellos dudosos y frescura desconocida (P-10)', () => {
  it('usa el reloj inyectado también para decidir qué es futuro', () => {
    /*
     * `toDate` consultaba `Date.now()` aunque el evaluador recibía `now`. Con el reloj de la
     * decisión fijado el 12-ago, un sello del 13-ago era «pasado» para el reloj del sistema y
     * salía con antigüedad 0: fresco. Tiene que salir FUTURO respecto de la decisión.
     */
    const verdict = evaluateFreshness(
      { observedAt: '2026-08-13T12:00:00.000Z' },
      60,
      FreshnessPolicy.REJECT,
      AHORA,
    );
    expect(verdict).toMatchObject({
      timestampStatus: 'FUTURE',
      ageSeconds: null,
      reject: true,
      reason: 'TIMESTAMP_FUTURE',
    });
  });

  it('una fecha futura no se vuelve aceptable en silencio, tampoco sin SLA', () => {
    const verdict = evaluateFreshness(
      { observedAt: new Date(AHORA.getTime() + 3_600_000) },
      0,
      FreshnessPolicy.DEGRADE,
      AHORA,
    );
    expect(verdict).toMatchObject({ timestampStatus: 'FUTURE', degraded: true });
  });

  it('el minuto de tolerancia de relojes no cuenta como futuro', () => {
    const verdict = evaluateFreshness(
      { observedAt: new Date(AHORA.getTime() + 30_000) },
      60,
      FreshnessPolicy.REJECT,
      AHORA,
    );
    expect(verdict).toMatchObject({ timestampStatus: 'PRESENT', ageSeconds: 0, reject: false });
  });

  it('variable crítica sin fecha: frescura desconocida, degradada por omisión', () => {
    const verdict = evaluateFreshness({}, 60, FreshnessPolicy.REJECT, AHORA);
    expect(verdict).toMatchObject({
      timestampStatus: 'ABSENT',
      unknown: true,
      degraded: true,
      reject: false,
      stale: false,
      reason: 'FRESHNESS_UNKNOWN',
    });
  });

  it('variable crítica sin fecha con política REJECT: rechazo', () => {
    const verdict = evaluateFreshness({}, 60, FreshnessPolicy.REJECT, AHORA, {
      unknownPolicy: 'REJECT',
    });
    expect(verdict).toMatchObject({ unknown: true, reject: true, reason: 'FRESHNESS_UNKNOWN' });
  });

  it('variable crítica sin SLA positivo: exige SLA, no se da por fresca', () => {
    const verdict = evaluateFreshness(
      { observedAt: haceSegundos(10) },
      0,
      FreshnessPolicy.REJECT,
      AHORA,
      { unknownPolicy: 'REJECT' },
    );
    expect(verdict).toMatchObject({ unknown: true, reject: true, reason: 'SLA_NOT_DECLARED' });
  });

  it('MEASURE sólo anota: ni rechaza ni degrada, pero queda marcada como desconocida', () => {
    const verdict = evaluateFreshness({}, 60, FreshnessPolicy.REJECT, AHORA, {
      unknownPolicy: 'MEASURE',
    });
    expect(verdict).toMatchObject({ unknown: true, reject: false, degraded: false });
  });

  it('una variable NO crítica sin fecha sigue como antes: se anota y no se marca', () => {
    const verdict = evaluateFreshness({}, 60, FreshnessPolicy.DEGRADE, AHORA);
    expect(verdict).toMatchObject({ unknown: false, degraded: false, timestampStatus: 'ABSENT' });
  });

  it('el dato vencido se distingue del sello dudoso por su motivo', () => {
    const verdict = evaluateFreshness(
      { observedAt: haceSegundos(3_600) },
      60,
      FreshnessPolicy.REJECT,
      AHORA,
    );
    expect(verdict).toMatchObject({ stale: true, reject: true, reason: 'STALE' });
  });
});

describe('VariableResolutionService · frescura con el reloj de la decisión', () => {
  const contract = (fallbackPolicy: string) =>
    ({
      variableVersionId: '1',
      code: 'saldo',
      name: 'saldo',
      dataType: 'NUMBER',
      required: true,
      nullable: false,
      fallbackPolicy,
      sensitive: false,
      validationRules: [],
      sources: [
        {
          system: 'core',
          path: 'x',
          field: 'saldo',
          precedence: 1,
          freshnessSlaSeconds: 60,
          authoritative: true,
        },
      ],
    }) as unknown as VariableContractSnapshot;

  function service(policy?: string) {
    const config = new ConfigService({
      AUDIT_HASH_SECRET: 'test-secret-with-at-least-24-characters',
      ...(policy ? { FRESHNESS_UNKNOWN_POLICY: policy } : {}),
    });
    return new VariableResolutionService(config, new HashService(config), new MetricsService());
  }

  it('FAIL_CLOSED es crítica: un dato vencido rechaza (antes sólo se degradaba)', async () => {
    /*
     * `freshnessPolicyOf` comparaba con 'FAIL', pero las dependencias escriben 'FAIL_CLOSED':
     * el REJECT era inalcanzable y toda variable crítica vieja se aceptaba degradada.
     */
    const result = await service().resolve(
      [contract('FAIL_CLOSED')],
      { saldo: 10 },
      {
        tenantId: 1n,
        artifactCode: 'A',
        requestId: 'r',
        allowExternal: false,
        metadata: { saldo: { observedAt: haceSegundos(3_600) } },
        now: AHORA,
      },
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([expect.objectContaining({ code: 'VARIABLE_STALE' })]);
  });

  it('un sello futuro respecto del reloj de la decisión se rechaza con su propio código', async () => {
    const result = await service().resolve(
      [contract('FAIL_CLOSED')],
      { saldo: 10 },
      {
        tenantId: 1n,
        artifactCode: 'A',
        requestId: 'r',
        allowExternal: false,
        metadata: { saldo: { observedAt: '2026-08-13T12:00:00.000Z' } },
        now: AHORA,
      },
    );
    expect(result.errors).toEqual([expect.objectContaining({ code: 'VARIABLE_TIMESTAMP_FUTURE' })]);
  });

  it('crítica sin sello: con REJECT configurado no hay decisión', async () => {
    const result = await service('REJECT').resolve(
      [contract('FAIL_CLOSED')],
      { saldo: 10 },
      { tenantId: 1n, artifactCode: 'A', requestId: 'r', allowExternal: false, now: AHORA },
    );
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'VARIABLE_FRESHNESS_UNKNOWN' }),
    ]);
  });

  it('crítica sin sello: por omisión se decide, pero la instantánea queda degradada y desconocida', async () => {
    const result = await service().resolve(
      [contract('FAIL_CLOSED')],
      { saldo: 10 },
      { tenantId: 1n, artifactCode: 'A', requestId: 'r', allowExternal: false, now: AHORA },
    );
    expect(result.valid).toBe(true);
    expect(result.snapshots[0].freshness).toMatchObject({ unknown: true, degraded: true });
  });
});
