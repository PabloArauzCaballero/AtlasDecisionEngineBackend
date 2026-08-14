import { ConfigService } from '@nestjs/config';
import { WorkerServiceInvokerService } from '../src/modules/workers/worker-service-invoker.service';
import { findBankStatementFixture } from '../src/modules/workers/bank-statement/fixtures/bank-statement-fixtures';
import type { SemanticAnalysisPipeline } from '../src/modules/workers/semantic-analysis/core/application/semantic-analysis.pipeline';
import type { AudioTtsRuntimeFactory } from '../src/modules/workers/audio-tts/audio-tts.runtime';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';
import type { WorkerServiceRequest } from '../src/modules/graph/graph.types';

/**
 * Guardas del invocador: qué rechaza antes de gastar una conversión.
 *
 * La conversión de un PDF real desde un nodo NO se prueba aquí sino en
 * `test/e2e/worker-service-nodes.e2e-spec.ts`, y es una decisión, no un olvido: `pdfjs-dist`
 * es ESM puro y bajo Jest se evalúa en la VM de módulos experimentales. Dos suites
 * unitarias del mismo proceso consumiéndolo se pisan —la segunda falla con
 * `PDF_EXTRACTION_FAILED` de forma intermitente, según el orden y la memoria—, así que en
 * la suite unitaria lo lee una sola: `bank-statement-fixtures.spec.ts`. El e2e corre en su
 * propio proceso y ahí la conversión desde un nodo sí se ejercita de punta a punta.
 *
 * Lo que queda aquí es lo que ninguna de esas dos cubre: que el invocador rechace lo que
 * no debe llegar al motor, y con el código correcto.
 */
const principal: AuthenticatedPrincipal = {
  id: 'test',
  tenantId: 1n,
  roles: [],
  audience: 'runtime',
  requestId: 'test',
  authMethod: 'jwt',
};

function build(overrides: Record<string, unknown> = {}) {
  const config = new ConfigService({
    BANK_STATEMENT_WORKER_ENABLED: true,
    BANK_STATEMENT_MAX_UPLOAD_BYTES: 10_485_760,
    BANK_STATEMENT_TIMEOUT_MS: 60_000,
    ...overrides,
  });
  const semantic = { analyze: jest.fn() } as unknown as SemanticAnalysisPipeline;
  /*
   * La fábrica de locución se pasa doblada y sin expectativas: estas pruebas
   * comprueban lo que el invocador rechaza ANTES de tocar nada, así que ninguna
   * llega a construir el núcleo. Doblarla —en vez de instanciarla— evita
   * arrastrar Prisma y el recolector de métricas a una suite unitaria.
   */
  const audio = {
    forTenant: jest.fn(),
    coreConfig: jest.fn(),
  } as unknown as AudioTtsRuntimeFactory;
  return new WorkerServiceInvokerService(config, semantic, audio).bind(1n, principal);
}

const statement = findBankStatementFixture('valid-complete')!;

function request(args: Record<string, unknown>): WorkerServiceRequest {
  return {
    service: 'bank-statement',
    operation: 'normalize',
    nodeKey: 'ANALIZAR',
    arguments: args,
    timeoutMs: 30_000,
  };
}

function audioRequest(args: Record<string, unknown>): WorkerServiceRequest {
  return {
    service: 'audio-tts',
    operation: 'speak',
    nodeKey: 'LOCUTAR',
    arguments: args,
    timeoutMs: 30_000,
  };
}

describe('invocador de servicios de worker', () => {
  it('rechaza un documento que no es base64 sin llegar al motor', async () => {
    await expect(
      build().invoke(request({ documentBase64: 'esto no es base64 ***' })),
    ).rejects.toThrow(/no es base64 válido/);
  });

  it('rechaza un base64 válido que no es un PDF', async () => {
    await expect(
      build().invoke(request({ documentBase64: Buffer.from('no soy un pdf').toString('base64') })),
    ).rejects.toThrow(/no es un PDF/);
  });

  it('rechaza la llamada si el despliegue no declara la capacidad', async () => {
    await expect(
      build({ BANK_STATEMENT_WORKER_ENABLED: false }).invoke(
        request({ documentBase64: statement.build().toString('base64') }),
      ),
    ).rejects.toThrow(/no está habilitado en este despliegue/);
  });

  /*
   * Locución desde un nodo del grafo.
   *
   * Las dos guardas que se comprueban aquí ocurren ANTES de tocar el núcleo, y
   * ése es justo su valor: una llamada a un servicio apagado o sin plantilla no
   * debe llegar a construir un repositorio, ni mucho menos a un proveedor que
   * cobra por petición.
   */
  it('rechaza locutar si el despliegue no declara la capacidad', async () => {
    await expect(
      build({ AUDIO_TTS_WORKER_ENABLED: false, AUDIO_TTS_PROVIDER: 'fake' }).invoke(
        audioRequest({ templateCode: 'onboarding.welcome.generic' }),
      ),
    ).rejects.toThrow(/no está habilitado en este despliegue/);
  });

  // Encendido pero sin proveedor NO es disponible: aceptaría trabajo que va a
  // fallar. Es la misma regla que aplica el catálogo `/v1/workers`.
  it('rechaza locutar si está encendido pero sin proveedor de voz', async () => {
    await expect(
      build({ AUDIO_TTS_WORKER_ENABLED: true, AUDIO_TTS_PROVIDER: 'disabled' }).invoke(
        audioRequest({ templateCode: 'onboarding.welcome.generic' }),
      ),
    ).rejects.toThrow(/no está habilitado en este despliegue/);
  });

  it('rechaza locutar sin plantilla: no hay texto libre por esta puerta tampoco', async () => {
    await expect(
      build({ AUDIO_TTS_WORKER_ENABLED: true, AUDIO_TTS_PROVIDER: 'fake' }).invoke(
        audioRequest({ variables: { name: 'Ana' } }),
      ),
    ).rejects.toThrow(/sin el argumento templateCode/);
  });

  it('rechaza una operación que ningún servicio ofrece', async () => {
    await expect(build().invoke({ ...request({}), operation: 'inventada' })).rejects.toThrow(
      /no sabe ejecutar/,
    );
  });
});
