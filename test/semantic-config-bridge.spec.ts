import { ConfigService } from '@nestjs/config';
import { assertProviderTimeoutFitsAnalysis } from '../src/modules/workers/semantic-analysis/core/config/openai-provider.config';
import { buildSemanticWorkerConfig } from '../src/modules/workers/semantic-analysis/semantic-config.bridge';

/**
 * El presupuesto del análisis tiene que caber el peor caso del proveedor.
 *
 * `assertProviderTimeoutFitsAnalysis` exige
 * `timeout × intentos × 2 tiers ≤ analysisTimeoutSeconds`. Si no se cumple, el
 * análisis se corta SIEMPRE antes de que el proveedor agote sus intentos: el job
 * expira, se reintenta y nunca produce nada. El síntoma aparece en el primer
 * job, no al arrancar, así que sin esta prueba se descubre en producción.
 *
 * Es la deuda que dejó anotada el agente de documentación, y la decisión de por
 * dónde resolverla —ampliar el presupuesto en vez de recortar los intentos del
 * proveedor— queda fijada aquí.
 */
describe('puente de configuración del worker semántico', () => {
  /** Config vacía: todos los valores caen a sus defectos, que es el caso real. */
  function bridgeWith(values: Record<string, unknown> = {}) {
    return buildSemanticWorkerConfig(new ConfigService(values));
  }

  it('con los valores por defecto, el proveedor cabe en el análisis', () => {
    const config = bridgeWith();
    // 30 s × 3 intentos × 2 tiers = 180 s. Antes salía un presupuesto de 110 s.
    expect(() =>
      assertProviderTimeoutFitsAnalysis(30_000, 3, config.analysisTimeoutSeconds),
    ).not.toThrow();
  });

  it('eleva el lease cuando el proveedor puede tardar más que él', () => {
    // El lease declarado es un SUELO. Uno por debajo del peor caso dejaría que
    // otra réplica reclamase un job todavía vivo: el mismo texto se clasificaría
    // dos veces y se pagaría dos veces.
    const config = bridgeWith({
      SEMANTIC_ANALYSIS_LEASE_SECONDS: 30,
      SEMANTIC_PROVIDER_TIMEOUT_MS: 40_000,
      SEMANTIC_PROVIDER_MAX_ATTEMPTS: 3,
    });
    const worstCase = (40_000 * 3 * 2) / 1_000;
    expect(config.analysisTimeoutSeconds).toBeGreaterThanOrEqual(worstCase);
    expect(() =>
      assertProviderTimeoutFitsAnalysis(40_000, 3, config.analysisTimeoutSeconds),
    ).not.toThrow();
  });

  it('respeta un lease amplio cuando ya cabe de sobra', () => {
    // Con un lease holgado no se toca nada: el presupuesto sigue diez segundos
    // por debajo, para que el corte lo dé el análisis y no el vencimiento.
    const config = bridgeWith({
      SEMANTIC_ANALYSIS_LEASE_SECONDS: 600,
      SEMANTIC_PROVIDER_TIMEOUT_MS: 10_000,
      SEMANTIC_PROVIDER_MAX_ATTEMPTS: 2,
    });
    expect(config.analysisTimeoutSeconds).toBe(590);
  });

  it('cumple la invariante para cualquier combinación razonable', () => {
    // Barrido: la aritmética no debe depender de que alguien elija bien.
    for (const timeoutMs of [5_000, 15_000, 30_000, 60_000]) {
      for (const attempts of [1, 2, 3, 5]) {
        const config = bridgeWith({
          SEMANTIC_PROVIDER_TIMEOUT_MS: timeoutMs,
          SEMANTIC_PROVIDER_MAX_ATTEMPTS: attempts,
        });
        expect(() =>
          assertProviderTimeoutFitsAnalysis(timeoutMs, attempts, config.analysisTimeoutSeconds),
        ).not.toThrow();
      }
    }
  });

  it('no enciende el modo híbrido por defecto', () => {
    // El híbrido exige un vector por categoría calculado de antemano. Sin ese
    // paso devuelve peores candidatos que el léxico y gastando cuota.
    expect(bridgeWith().retrievalMode).toBe('lexical');
    expect(bridgeWith({ SEMANTIC_ANALYSIS_RETRIEVAL_MODE: 'hybrid' }).retrievalMode).toBe('hybrid');
  });
});
