import { HttpStatus, Injectable } from '@nestjs/common';
import { DecisionKind } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { reviewEconomicContract } from '../risk-governance/semantic-outputs';

@Injectable()
export class EconomicContractGate {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Un artefacto que ORIGINA crédito no llega a producción sin declarar su riesgo.
   *
   * Es el gate económico del plan, y sólo actúa en producción a propósito: en sandbox se
   * experimenta, y exigir el contrato completo para probar una idea sólo conseguiría que la
   * gente probara en producción.
   *
   * La salida legítima no es una exención escondida: es declarar `decisionKind` de verdad. Un
   * artefacto que no origina crédito no tiene por qué publicar una probabilidad de
   * incumplimiento, y decirlo así queda en el esquema, en la auditoría y en la pantalla — al
   * contrario que una casilla «saltar comprobación», que nadie vuelve a mirar.
   */
  async assert(
    tenantId: bigint,
    version: { id: bigint; artifact: { decisionKind: DecisionKind } },
    isProduction: boolean,
  ): Promise<void> {
    if (!isProduction) return;
    const fields = await this.prisma.decisionOutputContractField.findMany({
      where: { tenantId, artifactVersionId: version.id },
      select: { fieldCode: true, semanticRole: true },
    });
    const problems = reviewEconomicContract(
      fields,
      version.artifact.decisionKind === DecisionKind.ORIGINATION,
    );
    if (!problems.length) return;
    throw new DomainException(
      'ECONOMIC_CONTRACT_INCOMPLETE',
      `${problems.join(' ')} Si esta decisión no origina crédito, decláralo en su ` +
        `\`decisionKind\` en vez de publicar un contrato económico incompleto.`,
      HttpStatus.CONFLICT,
      { problems },
    );
  }
}
