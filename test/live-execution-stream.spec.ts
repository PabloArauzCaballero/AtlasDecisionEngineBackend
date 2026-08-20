import { ConfigService } from '@nestjs/config';
import { firstValueFrom, toArray } from 'rxjs';
import { DomainException } from '../src/common/errors/domain-exception';
import { LiveExecutionController } from '../src/modules/live-execution/live-execution.controller';
import type { LiveExecutionStreamQueryDto } from '../src/modules/live-execution/live-execution.dto';
import type { DeploymentResolverService } from '../src/modules/deployments/deployment-resolver.service';
import type { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import type { NestedTreeExecutionService } from '../src/modules/nested-trees/nested-tree-execution.service';
import type { VariableResolutionService } from '../src/modules/variables/variable-resolution.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';

/**
 * El stream de ejecución en vivo tiene una particularidad que lo hace fácil de romper sin
 * darse cuenta: **cuando falla, la respuesta HTTP 200 ya se envió**. El filtro global de
 * excepciones ya no puede tocarla, así que todo lo que el cliente llegue a ver depende de
 * este controlador. De ahí lo que se comprueba aquí:
 *
 *  - un fallo inesperado NO se cuenta al cliente (iría sin redactar), pero sí termina el
 *    stream en vez de dejarlo colgado;
 *  - un `DomainException` sí conserva su código, que es lo que la interfaz sabe interpretar;
 *  - la política de PROD se aplica igual que en simulación: esto es una vista previa sin
 *    idempotencia ni auditoría y no puede apuntar a producción.
 */
describe('LiveExecutionController (stream SSE)', () => {
  const principal = { id: 'analista', requestId: 'req-1' } as AuthenticatedPrincipal;

  const query = (overrides: Partial<LiveExecutionStreamQueryDto> = {}) =>
    ({
      artifactCode: 'CREDIT',
      environmentCode: 'DEV',
      variables: '{"score":700}',
      requestId: 'req-1',
      ...overrides,
    }) as LiveExecutionStreamQueryDto;

  const nestedTrees = { bind: () => undefined } as unknown as NestedTreeExecutionService;

  function controller(options: {
    enabled?: boolean;
    resolveDeployment?: () => Promise<unknown>;
    execute?: () => Promise<unknown>;
    resolutionValid?: boolean;
  }) {
    const deployments = {
      resolve:
        options.resolveDeployment ??
        (() =>
          Promise.resolve({
            compiled: { variables: [], nodes: {}, edgesByNode: {} },
          })),
    } as unknown as DeploymentResolverService;
    const variables = {
      resolve: () =>
        Promise.resolve({
          valid: options.resolutionValid ?? true,
          values: { score: 700 },
          snapshots: [],
          errors: options.resolutionValid === false ? [{ code: 'X', message: 'falta' }] : [],
        }),
    } as unknown as VariableResolutionService;
    const engine = {
      execute:
        options.execute ??
        (() =>
          Promise.resolve({
            status: 'SUCCEEDED',
            outcome: 'APPROVED',
            output: {},
            reasons: [],
            nestedExecutions: [],
          })),
    } as unknown as ExecutionEngineService;

    return new LiveExecutionController(
      new ConfigService({
        LIVE_EXECUTION_STREAM_ENABLED: options.enabled ?? true,
        LIVE_EXECUTION_STREAM_HEARTBEAT_MS: 60_000,
      }),
      deployments,
      variables,
      engine,
      nestedTrees,
    );
  }

  /** Consume el stream entero y devuelve los eventos emitidos. */
  const collect = (observable: ReturnType<LiveExecutionController['stream']>) =>
    firstValueFrom(observable.pipe(toArray()));

  it('rechaza el stream cuando el entorno no lo tiene habilitado', () => {
    expect(() => controller({ enabled: false }).stream(1n, principal, query())).toThrow(
      DomainException,
    );
  });

  it('nunca ejecuta contra PROD, igual que la simulación', async () => {
    const events = await collect(
      controller({}).stream(1n, principal, query({ environmentCode: 'PROD' })),
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('execution_failed');
    expect((events[0].data as { code: string }).code).toBe('LIVE_EXECUTION_PROD_FORBIDDEN');
  });

  it('rechaza `variables` que no sea un objeto JSON', async () => {
    for (const invalid of ['no-es-json', '[1,2,3]', 'null', '"texto"']) {
      const events = await collect(
        controller({}).stream(1n, principal, query({ variables: invalid })),
      );
      expect((events[0].data as { code: string }).code).toBe('LIVE_EXECUTION_VARIABLES_INVALID');
    }
  });

  it('emite el resultado y CIERRA el stream cuando la ejecución va bien', async () => {
    const events = await collect(controller({}).stream(1n, principal, query()));
    // Que `toArray()` resuelva ya prueba que el stream se completó: si quedara abierto,
    // esta promesa nunca se cumpliría y la prueba expiraría.
    expect(events.map((event) => event.type)).toEqual(['execution_completed']);
    expect((events[0].data as { outcome: string }).outcome).toBe('APPROVED');
  });

  it('un contrato de entrada inválido termina el stream con los errores de resolución', async () => {
    const events = await collect(
      controller({ resolutionValid: false }).stream(1n, principal, query()),
    );
    expect(events[0].type).toBe('execution_failed');
    expect((events[0].data as { errors: unknown[] }).errors).toHaveLength(1);
  });

  it('un DomainException del motor conserva su código para la interfaz', async () => {
    const events = await collect(
      controller({
        execute: () => Promise.reject(new DomainException('NO_MATCHING_EDGE', 'sin rama')),
      }).stream(1n, principal, query()),
    );
    expect((events[0].data as { code: string }).code).toBe('NO_MATCHING_EDGE');
  });

  it('un fallo inesperado NO llega al cliente sin redactar, pero cierra el stream', async () => {
    const secreto = 'connect ECONNREFUSED postgres-primary.interno:5432';
    const events = await collect(
      controller({ execute: () => Promise.reject(new Error(secreto)) }).stream(
        1n,
        principal,
        query(),
      ),
    );
    const body = JSON.stringify(events);
    expect(body).not.toContain('postgres-primary.interno');
    expect((events[0].data as { code: string }).code).toBe('LIVE_EXECUTION_FAILED');
    expect((events[0].data as { message: string }).message).toBe(
      'Live execution failed unexpectedly',
    );
  });
});
