import { DomainException } from '../src/common/errors/domain-exception';
import { SecurityReviewService } from '../src/modules/security-review/security-review.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';

/**
 * El panel de revisión de seguridad es lo que mira un aprobador antes de decir «sí» a una
 * versión. Dos cosas tienen que ser ciertas siempre:
 *
 *  1. **Aísla por tenant antes de leer nada más.** El resto de tablas que agrega
 *     —scripts de nodo, dependencias de variables, aprobaciones— NO tienen `tenant_id`, así
 *     que no hay RLS que las proteja: la única barrera es que la versión se resuelva primero
 *     por su artefacto y su tenant. Si esa consulta dejara de filtrar, el panel enseñaría el
 *     código de otro cliente sin que nada más lo impidiera.
 *  2. **La severidad no se queda corta.** Es un resumen para decidir; que un hallazgo HIGH
 *     se presente como MEDIUM es peor que no mostrarlo.
 */
describe('SecurityReviewService', () => {
  const TENANT = 7n;
  const VERSION = 42n;

  /** Registra con qué `where` se pidió la versión, que es donde vive el aislamiento. */
  function makePrisma(options: {
    versionFound: boolean;
    scripts?: unknown[];
    sensitive?: boolean;
  }) {
    const calls: { versionWhere?: unknown } = {};
    const version = {
      id: VERSION,
      versionNumber: 3,
      status: 'DRAFT',
      semanticVersion: '1.2.0',
      createdBy: 'autor',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      canonicalChecksum: 'sha256:abc',
      artifact: {
        id: 1n,
        artifactCode: 'CREDIT',
        name: 'Crédito',
        riskDomain: 'CREDIT',
        tenantId: TENANT,
      },
    };
    const dependency = {
      usageType: 'INPUT',
      variableVersion: {
        definition: {
          variableCode: 'ingresos',
          isSensitive: options.sensitive ?? false,
          dataClassification: options.sensitive ? 'RESTRICTED' : 'INTERNAL',
        },
      },
    };
    const empty = () => Promise.resolve([]);
    const prisma = {
      decisionArtifactVersion: {
        findFirst: (args: { where?: unknown }) => {
          calls.versionWhere = args.where;
          return Promise.resolve(options.versionFound ? version : null);
        },
      },
      decisionNodeScript: { findMany: () => Promise.resolve(options.scripts ?? []) },
      decisionArtifactVariableDependency: { findMany: () => Promise.resolve([dependency]) },
      decisionArtifactReference: { findMany: empty },
      decisionApprovalRequest: { findMany: empty },
      decisionCodeImport: { findMany: empty },
      decisionAuditEvent: { findMany: empty },
      decisionExecution: { findMany: empty },
    } as unknown as PrismaService;
    return { prisma, calls };
  }

  it('resuelve la versión filtrando SIEMPRE por el tenant del artefacto', async () => {
    const { prisma, calls } = makePrisma({ versionFound: true });
    await new SecurityReviewService(prisma).getVersionReview(TENANT, VERSION);
    // El `where` tiene que llevar las dos cosas: el id pedido y el tenant del solicitante.
    // Sin lo segundo, un id de otro cliente devolvería su versión.
    expect(calls.versionWhere).toEqual({ id: VERSION, artifact: { tenantId: TENANT } });
  });

  it('responde 404 —no 403— cuando la versión no es de este tenant', async () => {
    const { prisma } = makePrisma({ versionFound: false });
    const error = await new SecurityReviewService(prisma)
      .getVersionReview(TENANT, VERSION)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DomainException);
    expect((error as DomainException).code).toBe('VERSION_NOT_FOUND');
    // 404 y no 403 a propósito: un 403 confirmaría que el identificador existe en otro sitio.
    expect((error as DomainException).status).toBe(404);
  });

  it('marca HIGH cuando la versión ejecuta nodos de script', async () => {
    const { prisma } = makePrisma({
      versionFound: true,
      scripts: [
        { nodeKey: 'R1', language: 'PYTHON', sourceChecksum: 'x', sourceCode: 'result={}' },
      ],
    });
    const review = await new SecurityReviewService(prisma).getVersionReview(TENANT, VERSION);
    expect(review.severity).toBe('HIGH');
    expect(review.findings.map((finding) => finding.code)).toContain('CONTAINS_SCRIPT_NODES');
  });

  it('marca HIGH cuando hay variables sensibles, aunque no haya scripts', async () => {
    const { prisma } = makePrisma({ versionFound: true, sensitive: true });
    const review = await new SecurityReviewService(prisma).getVersionReview(TENANT, VERSION);
    expect(review.severity).toBe('HIGH');
    const codes = review.findings.map((finding) => finding.code);
    expect(codes).toContain('SENSITIVE_VARIABLES');
    // Una clasificación no interna es un hallazgo propio, de severidad menor.
    expect(codes).toContain('RESTRICTED_CLASSIFICATION_VARIABLES');
  });

  it('una versión sin scripts ni datos sensibles queda en LOW', async () => {
    const { prisma } = makePrisma({ versionFound: true });
    const review = await new SecurityReviewService(prisma).getVersionReview(TENANT, VERSION);
    expect(review.severity).toBe('LOW');
    expect(review.findings).toEqual([]);
  });

  it('recorta la fuente del script: el panel muestra un extracto, no el fichero entero', async () => {
    const largo = 'x'.repeat(5_000);
    const { prisma } = makePrisma({
      versionFound: true,
      scripts: [{ nodeKey: 'R1', language: 'JAVASCRIPT', sourceChecksum: 'x', sourceCode: largo }],
    });
    const review = await new SecurityReviewService(prisma).getVersionReview(TENANT, VERSION);
    expect(review.code[0].sourceExcerpt).toHaveLength(2_000);
  });
});
