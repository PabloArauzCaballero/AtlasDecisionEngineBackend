import { DomainException } from '../src/common/errors/domain-exception';
import { DeploymentResolverService } from '../src/modules/deployments/deployment-resolver.service';
import type { CacheService } from '../src/common/cache/cache.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';

/**
 * El resolutor está en el camino caliente: toda decisión de producción pasa por él antes de
 * tocar el motor. Su regla es que **Redis es una optimización, no la autoridad**. Una entrada
 * corrupta, vieja o de otra forma no puede convertir cada decisión de ese binding en un 500;
 * tiene que caer a PostgreSQL y seguir.
 *
 * La otra mitad es el redondeo de tipos: los identificadores son `bigint` y viajan a la caché
 * como cadena. Si la vuelta no los reconstruye, el motor recibe un `string` donde espera un
 * `bigint` y la ejecución falla más tarde, lejos de la causa.
 */
describe('DeploymentResolverService (caché)', () => {
  const TENANT = 5n;

  const compiled = { artifact: { code: 'CREDIT' }, nodes: {}, startNodeKey: 'START' };

  const binding = {
    environmentId: 3n,
    environment: { code: 'PROD', subjectReferencePolicy: 'REQUIRED' },
    activeDeployment: {
      id: 11n,
      artifactVersionId: 22n,
      compiledArtifactId: 33n,
      // La exigencia de sujeto y el dominio de riesgo viajan con el despliegue: son datos del
      // binding —cambian cuando cambia el despliegue, no entre peticiones— y consultarlos aparte
      // costaría una consulta más en el camino caliente de CADA decisión.
      artifactVersion: {
        subjectReferencePolicy: null,
        subjectPolicyJustification: null,
        artifact: { riskDomain: 'CREDIT_ORIGINATION' },
      },
      compiledArtifact: {
        compiledChecksum: 'sha256:abc',
        compiledPayloadJson: compiled,
      },
    },
  };

  function makeCache(initial?: string) {
    const store = new Map<string, string>();
    if (initial !== undefined) store.set('decision-binding:CREDIT:PROD', initial);
    const calls = { del: 0, set: 0 };
    const cache = {
      getForTenant: (_tenant: bigint, key: string) => Promise.resolve(store.get(key) ?? null),
      setForTenant: (_tenant: bigint, key: string, value: string) => {
        calls.set += 1;
        store.set(key, value);
        return Promise.resolve();
      },
      delForTenant: (_tenant: bigint, key: string) => {
        calls.del += 1;
        store.delete(key);
        return Promise.resolve();
      },
    } as unknown as CacheService;
    return { cache, store, calls };
  }

  function makePrisma(found = true) {
    const calls = { findFirst: 0 };
    const prisma = {
      decisionRuntimeBinding: {
        findFirst: () => {
          calls.findFirst += 1;
          return Promise.resolve(found ? binding : null);
        },
      },
    } as unknown as PrismaService;
    return { prisma, calls };
  }

  it('lee de la base cuando no hay nada en caché, y guarda el resultado', async () => {
    const { cache, store, calls: cacheCalls } = makeCache();
    const { prisma, calls } = makePrisma();
    const resolved = await new DeploymentResolverService(prisma, cache).resolve(
      TENANT,
      'CREDIT',
      'PROD',
    );

    expect(calls.findFirst).toBe(1);
    expect(cacheCalls.set).toBe(1);
    expect(resolved.deploymentId).toBe(11n);
    expect(resolved.compiledChecksum).toBe('sha256:abc');
    // Guardado con los identificadores como cadena: `bigint` no es serializable en JSON.
    expect(JSON.parse(store.get('decision-binding:CREDIT:PROD')!).deploymentId).toBe('11');
  });

  it('sirve desde caché sin volver a la base, y reconstruye los bigint', async () => {
    const { cache } = makeCache(
      JSON.stringify({
        deploymentId: '11',
        artifactVersionId: '22',
        environmentId: '3',
        compiledArtifactId: '33',
        environmentCode: 'PROD',
        compiledChecksum: 'sha256:abc',
        compiled,
        subjectPolicy: 'REQUIRED',
        riskDomain: 'CREDIT_ORIGINATION',
      }),
    );
    const { prisma, calls } = makePrisma();
    const resolved = await new DeploymentResolverService(prisma, cache).resolve(
      TENANT,
      'CREDIT',
      'PROD',
    );

    expect(calls.findFirst).toBe(0);
    // El tipo importa: el motor y el escritor de ejecuciones esperan `bigint`.
    expect(typeof resolved.deploymentId).toBe('bigint');
    expect(resolved.artifactVersionId).toBe(22n);
    expect(resolved.environmentId).toBe(3n);
  });

  it('una entrada corrupta no rompe la decisión: se descarta y se lee de la base', async () => {
    const { cache, calls: cacheCalls } = makeCache('esto-no-es-json');
    const { prisma, calls } = makePrisma();
    const resolved = await new DeploymentResolverService(prisma, cache).resolve(
      TENANT,
      'CREDIT',
      'PROD',
    );

    expect(calls.findFirst).toBe(1);
    expect(cacheCalls.del).toBe(1);
    expect(resolved.deploymentId).toBe(11n);
  });

  it('una entrada incompleta —sin el compilado— también cae a la base', async () => {
    // El caso real: un despliegue antiguo cacheado antes de que la forma incluyera el
    // compilado. Servirla tal cual dejaría al motor sin grafo que ejecutar.
    const { cache, calls: cacheCalls } = makeCache(
      JSON.stringify({ deploymentId: '11', compiledChecksum: 'sha256:abc' }),
    );
    const { prisma } = makePrisma();
    const resolved = await new DeploymentResolverService(prisma, cache).resolve(
      TENANT,
      'CREDIT',
      'PROD',
    );

    expect(cacheCalls.del).toBe(1);
    expect(resolved.compiled).toEqual(compiled);
  });

  it('una entrada sin la política de sujeto cae a la base en vez de servirla', async () => {
    /*
     * El caso que este control existe para evitar, y que no es hipotético: durante los 60 s de
     * TTL posteriores a un despliegue, la caché conserva entradas escritas por la versión
     * ANTERIOR del servicio, que no llevan `subjectPolicy`. Servirlas tal cual dejaría la
     * política en `undefined` y `applySubjectPolicy` no exigiría nada — es decir, la exigencia
     * de sujeto desaparecería en silencio justo después de cada despliegue, que es cuando menos
     * se está mirando.
     */
    const { cache, calls: cacheCalls } = makeCache(
      JSON.stringify({
        deploymentId: '11',
        artifactVersionId: '22',
        environmentId: '3',
        compiledArtifactId: '33',
        environmentCode: 'PROD',
        compiledChecksum: 'sha256:abc',
        compiled,
      }),
    );
    const { prisma, calls } = makePrisma();
    const resolved = await new DeploymentResolverService(prisma, cache).resolve(
      TENANT,
      'CREDIT',
      'PROD',
    );

    expect(calls.findFirst).toBe(1);
    expect(cacheCalls.del).toBe(1);
    expect(resolved.subjectPolicy).toBe('REQUIRED');
  });

  it('si el borrado de la entrada mala falla, la lectura autoritativa sigue adelante', async () => {
    // Redis caído a mitad: la invalidación es best-effort, la decisión no.
    const cache = {
      getForTenant: () => Promise.resolve('{'),
      setForTenant: () => Promise.resolve(),
      delForTenant: () => Promise.reject(new Error('redis down')),
    } as unknown as CacheService;
    const { prisma } = makePrisma();

    await expect(
      new DeploymentResolverService(prisma, cache).resolve(TENANT, 'CREDIT', 'PROD'),
    ).resolves.toMatchObject({ deploymentId: 11n });
  });

  it('sin despliegue activo responde 404 con el artefacto y el entorno en el mensaje', async () => {
    const { cache } = makeCache();
    const { prisma } = makePrisma(false);
    const error = await new DeploymentResolverService(prisma, cache)
      .resolve(TENANT, 'CREDIT', 'PROD')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DomainException);
    expect((error as DomainException).code).toBe('ACTIVE_DEPLOYMENT_NOT_FOUND');
    expect((error as DomainException).status).toBe(404);
    expect((error as DomainException).message).toContain('CREDIT');
    expect((error as DomainException).message).toContain('PROD');
  });

  it('la clave de caché separa artefactos y entornos', async () => {
    const { cache, store } = makeCache();
    const { prisma } = makePrisma();
    const resolver = new DeploymentResolverService(prisma, cache);
    await resolver.resolve(TENANT, 'CREDIT', 'PROD');
    await resolver.resolve(TENANT, 'CREDIT', 'TEST');
    await resolver.resolve(TENANT, 'FRAUD', 'PROD');

    // Sin esta separación, publicar en TEST cambiaría lo que sirve PROD.
    expect([...store.keys()].sort()).toEqual([
      'decision-binding:CREDIT:PROD',
      'decision-binding:CREDIT:TEST',
      'decision-binding:FRAUD:PROD',
    ]);
  });

  it('invalidar borra exactamente la clave de ese artefacto y entorno', async () => {
    const { cache, store } = makeCache();
    const { prisma } = makePrisma();
    const resolver = new DeploymentResolverService(prisma, cache);
    await resolver.resolve(TENANT, 'CREDIT', 'PROD');
    await resolver.resolve(TENANT, 'CREDIT', 'TEST');

    await resolver.invalidate(TENANT, 'CREDIT', 'PROD');

    expect([...store.keys()]).toEqual(['decision-binding:CREDIT:TEST']);
  });
});
