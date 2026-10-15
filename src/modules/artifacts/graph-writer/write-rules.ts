import type { Prisma } from '@prisma/client';
import { DomainException } from '../../../common/errors/domain-exception';
import { parseBigIntId } from '../../../common/http/id';
import type { ReplaceGraphDto } from '../artifact.dto';
import type { GraphWriteContext } from './graph-write-context';

/** Condiciones y acciones (con sus motivos), devueltas por código de negocio para enlazarlas. */
export async function writeConditionsAndActions(
  tx: Prisma.TransactionClient,
  { tenantId, versionId }: GraphWriteContext,
  dto: ReplaceGraphDto,
): Promise<{ conditionIds: Map<string, bigint>; actionIds: Map<string, bigint> }> {
  // Every child insert below is batched with createManyAndReturn / createMany rather
  // than one create() per row. The author path is low-volume, but a graph with
  // hundreds of nodes/edges otherwise issued hundreds of round-trips inside one open
  // transaction — long-held row locks and real contention risk. Generated ids are
  // mapped back by each row's unique business key (conditionCode/actionCode/nodeKey/
  // edgeKey), so the mapping does not depend on any insert-ordering guarantee.
  const conditionIds = new Map<string, bigint>();
  if (dto.conditions.length) {
    const created = await tx.decisionRuleCondition.createManyAndReturn({
      data: dto.conditions.map((condition) => ({
        artifactVersionId: versionId,
        conditionCode: condition.code,
        name: condition.name,
        expressionType: condition.expressionType,
        expressionJson: condition.expression as Prisma.InputJsonValue,
        severity: condition.severity,
        isReusable: condition.reusable,
      })),
      select: { id: true, conditionCode: true },
    });
    for (const row of created) conditionIds.set(row.conditionCode, row.id);
  }

  const reasonIds = [
    ...new Set(
      dto.actions.flatMap((action) => action.reasonCodes.map((reason) => reason.reasonCodeId)),
    ),
  ].map(BigInt);
  if (reasonIds.length) {
    const reasonCount = await tx.decisionReasonCode.count({
      where: { id: { in: reasonIds }, tenantId },
    });
    if (reasonCount !== reasonIds.length) {
      throw new DomainException(
        'REASON_CODE_NOT_FOUND',
        'One or more reason codes do not exist in this tenant',
      );
    }
  }

  // Actions first, then their reason mappings keyed on the returned action ids:
  // createManyAndReturn cannot create the nested mappings, so they are a second batch.
  const actionIds = new Map<string, bigint>();
  if (dto.actions.length) {
    const created = await tx.decisionRuleAction.createManyAndReturn({
      data: dto.actions.map((action) => ({
        artifactVersionId: versionId,
        actionCode: action.code,
        actionType: action.type,
        payloadSchemaJson: action.payloadSchema as Prisma.InputJsonValue | undefined,
        payloadTemplateJson: action.payload as Prisma.InputJsonValue,
        isTerminal: action.terminal,
      })),
      select: { id: true, actionCode: true },
    });
    for (const row of created) actionIds.set(row.actionCode, row.id);

    const reasonMappingRows = dto.actions.flatMap((action) =>
      action.reasonCodes.map((reason) => ({
        actionId: actionIds.get(action.code)!,
        reasonCodeId: parseBigIntId(reason.reasonCodeId, 'reasonCodeId'),
        priority: reason.priority,
        messageTemplateJson: reason.messageTemplate as Prisma.InputJsonValue | undefined,
      })),
    );
    if (reasonMappingRows.length) {
      await tx.decisionActionReasonMapping.createMany({ data: reasonMappingRows });
    }
  }
  return { conditionIds, actionIds };
}
