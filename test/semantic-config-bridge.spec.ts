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

  it('con el gateway, el peor caso sale de las variables DEL GATEWAY', () => {
    // Leer siempre `SEMANTIC_PROVIDER_*` derivaba el presupuesto de variables que
    // un despliegue con LiteLLM no usa: subir el plazo del gateway volvía a
    // romper la primera clasificación, que es justo lo que este cálculo impide.
    const config = bridgeWith({
      SEMANTIC_ANALYSIS_PROVIDER: 'litellm',
      LITELLM_TIMEOUT_MS: 60_000,
      LITELLM_MAX_ATTEMPTS: 4,
    });
    expect(() =>
      assertProviderTimeoutFitsAnalysis(60_000, 4, config.analysisTimeoutSeconds),
    ).not.toThrow();
  });

  it('sin gateway, las variables del gateway no alteran el presupuesto', () => {
    // La simétrica: un `LITELLM_TIMEOUT_MS` olvidado en el entorno no debe
    // inflar el lease de un despliegue que clasifica con OpenAI.
    const conGateway = bridgeWith({ LITELLM_TIMEOUT_MS: 600_000, LITELLM_MAX_ATTEMPTS: 10 });
    expect(conGateway.analysisTimeoutSeconds).toBe(bridgeWith().analysisTimeoutSeconds);
  });

  it('con OpenRouter, el peor caso sale de las variables DE OPENROUTER', () => {
    // Mismo defecto que tuvo el gateway propio, por la puerta de al lado: leer
    // las de LiteLLM en un despliegue con OpenRouter derivaría el presupuesto de
    // variables que ese despliegue no usa.
    const config = bridgeWith({
      SEMANTIC_ANALYSIS_PROVIDER: 'openrouter',
      OPENROUTER_TIMEOUT_MS: 60_000,
      OPENROUTER_MAX_ATTEMPTS: 4,
      LITELLM_TIMEOUT_MS: 1_000,
      LITELLM_MAX_ATTEMPTS: 1,
    });
    expect(() =>
      assertProviderTimeoutFitsAnalysis(60_000, 4, config.analysisTimeoutSeconds),
    ).not.toThrow();
  });

  it('con las dos credenciales, el lease cubre al gateway MÁS LENTO', () => {
    // El gateway se puede cambiar desde el portal sin reiniciar el worker. Un
    // lease calculado para el elegido en el entorno dejaría corto al otro, y
    // otra réplica reclamaría un job todavía vivo justo después de cambiar.
    const config = bridgeWith({
      SEMANTIC_ANALYSIS_PROVIDER: 'litellm',
      LITELLM_API_KEY: 'sk-gateway',
      LITELLM_TIMEOUT_MS: 10_000,
      LITELLM_MAX_ATTEMPTS: 1,
      OPENROUTER_API_KEY: 'sk-or-v1',
      OPENROUTER_TIMEOUT_MS: 60_000,
      OPENROUTER_MAX_ATTEMPTS: 4,
    });
    expect(() =>
      assertProviderTimeoutFitsAnalysis(60_000, 4, config.analysisTimeoutSeconds),
    ).not.toThrow();
  });

  it('en cascada, el peor caso es el del escalón remoto ELEGIDO', () => {
    // Con el remoto en OpenRouter, las variables de LiteLLM no cuentan aunque
    // estén en el entorno, y al revés.
    const local = 2_000;
    const conOpenRouter = bridgeWith({
      SEMANTIC_ANALYSIS_PROVIDER: 'cascade',
      SEMANTIC_CASCADE_REMOTE_PROVIDER: 'openrouter',
      SEMANTIC_CASCADE_LOCAL_TIMEOUT_MS: local,
      OPENROUTER_TIMEOUT_MS: 50_000,
      OPENROUTER_MAX_ATTEMPTS: 2,
      LITELLM_TIMEOUT_MS: 600_000,
      LITELLM_MAX_ATTEMPTS: 10,
    });
    const peorCasoOpenRouter = Math.ceil((local + 50_000 * 2) / 1_000);
    expect(conOpenRouter.analysisTimeoutSeconds).toBeGreaterThanOrEqual(peorCasoOpenRouter);
    // Y muy por debajo de lo que pediría el gateway propio con esos valores.
    expect(conOpenRouter.analysisTimeoutSeconds).toBeLessThan((local + 600_000 * 10) / 1_000);
  });

  it('no enciende el modo híbrido por defecto', () => {
    // El híbrido exige un vector por categoría calculado de antemano. Sin ese
    // paso devuelve peores candidatos que el léxico y gastando cuota.
    expect(bridgeWith().retrievalMode).toBe('lexical');
    expect(bridgeWith({ SEMANTIC_ANALYSIS_RETRIEVAL_MODE: 'hybrid' }).retrievalMode).toBe('hybrid');
  });
});
