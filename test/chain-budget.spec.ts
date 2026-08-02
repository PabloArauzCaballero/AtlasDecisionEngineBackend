import { ChainBudget, DEFAULT_CHAIN_LIMITS } from '../src/modules/nested-trees/chain-budget';

/**
 * §9.3 exige acotar la cadena completa, no cada salto. Una profundidad de 3 puede
 * invocar decenas de artefactos en abanico, tardar un minuto o devolver megabytes: cada
 * uno de esos casos se prueba aquí porque cada uno tumbó alguna vez un motor de
 * decisiones en producción.
 */
describe('presupuesto de una cadena de artefactos', () => {
  it('acepta invocaciones hasta el máximo configurado', () => {
    const budget = new ChainBudget({
      maxArtifacts: 3,
      maxTotalMs: 1_000,
      maxResultBytes: 1_000,
      maxRetainedBytes: 1_000_000,
    });
    budget.consumeInvocation('N1');
    budget.consumeInvocation('N2');
    budget.consumeInvocation('N3');
    expect(budget.usedInvocations).toBe(3);
  });

  it('rechaza la invocación que supera el máximo de artefactos', () => {
    const budget = new ChainBudget({
      maxArtifacts: 2,
      maxTotalMs: 1_000,
      maxResultBytes: 1_000,
      maxRetainedBytes: 1_000_000,
    });
    budget.consumeInvocation('N1');
    budget.consumeInvocation('N2');
    expect(() => budget.consumeInvocation('N3')).toThrow(/artefactos encadenados/);
  });

  it('recorta el timeout del salto a lo que le queda a la cadena', () => {
    let clock = 0;
    const budget = new ChainBudget(
      { maxArtifacts: 10, maxTotalMs: 1_000, maxResultBytes: 1_000, maxRetainedBytes: 1_000_000 },
      () => clock,
    );
    expect(budget.remainingMs(5_000)).toBe(1_000);
    clock = 700;
    // Un salto que pide 5 s cuando a la cadena le quedan 300 ms recibe 300 ms.
    expect(budget.remainingMs(5_000)).toBe(300);
    expect(budget.remainingMs(100)).toBe(100);
  });

  it('falla cuando la cadena agota su tiempo total', () => {
    let clock = 0;
    const budget = new ChainBudget(
      { maxArtifacts: 10, maxTotalMs: 500, maxResultBytes: 1_000, maxRetainedBytes: 1_000_000 },
      () => clock,
    );
    clock = 600;
    expect(() => budget.remainingMs(100)).toThrow(/tiempo total/);
  });

  it('rechaza un resultado intermedio desmesurado', () => {
    const budget = new ChainBudget({
      maxArtifacts: 10,
      maxTotalMs: 1_000,
      maxResultBytes: 64,
      maxRetainedBytes: 1_000_000,
    });
    expect(() => budget.consumeResult('N1', { ok: true })).not.toThrow();
    expect(() => budget.consumeResult('N1', { texto: 'x'.repeat(500) })).toThrow(
      /El resultado de N1 ocupa/,
    );
  });

  /**
   * El límite de memoria de §9.3, que era la única cota del pliego sin implementar. El tope
   * por resultado no lo cubre: veinticinco saltos de 256 KiB pasan uno a uno y dejan 6,4 MiB
   * retenidos, porque cada entrada de la traza anidada conserva su `output`.
   */
  describe('memoria acumulada de la cadena', () => {
    const limits = (maxRetainedBytes: number) => ({
      maxArtifacts: 100,
      maxTotalMs: 10_000,
      maxResultBytes: 10_000,
      maxRetainedBytes,
    });

    it('suma lo retenido salto a salto', () => {
      const budget = new ChainBudget(limits(1_000_000));
      budget.consumeResult('N1', { texto: 'x'.repeat(100) });
      const afterFirst = budget.usedRetainedBytes;
      expect(afterFirst).toBeGreaterThan(100);
      budget.consumeResult('N2', { texto: 'x'.repeat(100) });
      expect(budget.usedRetainedBytes).toBe(afterFirst * 2);
    });

    it('falla cerrado cuando el acumulado supera el presupuesto', () => {
      const budget = new ChainBudget(limits(400));
      // Cada resultado cabe de sobra en maxResultBytes; el problema es la suma.
      budget.consumeResult('N1', { texto: 'x'.repeat(150) });
      budget.consumeResult('N2', { texto: 'x'.repeat(150) });
      expect(() => budget.consumeResult('N3', { texto: 'x'.repeat(150) })).toThrow(
        /La cadena retiene/,
      );
    });

    it('un resultado desmesurado se reporta como tal, no como falta de memoria', () => {
      // Si el orden de las comprobaciones se invirtiera, el autor recibiría "sin memoria" y
      // no sabría qué salto arreglar.
      const budget = new ChainBudget({
        maxArtifacts: 10,
        maxTotalMs: 1_000,
        maxResultBytes: 64,
        maxRetainedBytes: 10,
      });
      expect(() => budget.consumeResult('N1', { texto: 'x'.repeat(500) })).toThrow(
        /El resultado de N1 ocupa/,
      );
    });

    it('no cobra nada cuando el resultado fue rechazado', () => {
      const budget = new ChainBudget(limits(1_000));
      expect(() => budget.consumeResult('N1', { texto: 'x'.repeat(50_000) })).toThrow();
      expect(budget.usedRetainedBytes).toBe(0);
    });
  });

  it('los valores por defecto son conservadores pero utilizables', () => {
    expect(DEFAULT_CHAIN_LIMITS.maxArtifacts).toBeGreaterThan(1);
    expect(DEFAULT_CHAIN_LIMITS.maxTotalMs).toBeGreaterThan(1_000);
    expect(DEFAULT_CHAIN_LIMITS.maxResultBytes).toBeGreaterThan(1_024);
    // El acumulado tiene que dar para varios saltos, o la cota sobraría frente a maxResultBytes.
    expect(DEFAULT_CHAIN_LIMITS.maxRetainedBytes).toBeGreaterThan(
      DEFAULT_CHAIN_LIMITS.maxResultBytes,
    );
  });
});
