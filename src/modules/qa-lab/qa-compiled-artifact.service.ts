import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { CompiledDecisionArtifact } from '../graph/graph.types';

/** Lee el artefacto compilado de una versión del tenant. */
@Injectable()
export class QaCompiledArtifactService {
  constructor(private readonly prisma: PrismaService) {}

  async load(tenantId: bigint, versionId: bigint): Promise<CompiledDecisionArtifact> {
    const compiled = await this.prisma.decisionCompiledArtifact.findFirst({
      where: {
        artifactVersionId: versionId,
        compileStatus: 'SUCCESS',
        artifactVersion: { artifact: { tenantId } },
      },
      orderBy: { compiledAt: 'desc' },
    });
    if (!compiled) {
      throw new DomainException(
        'QA_VERSION_NOT_COMPILED',
        'La versión no tiene un artefacto compilado con éxito: compílala antes de generar casos',
        HttpStatus.CONFLICT,
      );
    }
    return compiled.compiledPayloadJson as unknown as CompiledDecisionArtifact;
  }
}
