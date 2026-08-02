/**
 * Resuelve las invocaciones a campos calculados que declara un grafo (§5.1).
 *
 * El autor manda qué versión invocar; **la definición ejecutable la resuelve el backend
 * desde la base y la congela**. Si el cliente pudiera aportarla, un `PUT` del grafo sería
 * una vía para meter código arbitrario en el sandbox saltándose por completo el registro
 * de campos calculados y su ciclo de aprobación.
 *
 * Congelarla, además, es lo que hace reproducible una decisión: el artefacto compilado
 * lleva dentro el cálculo exacto que se ejecutó, aunque el campo se deprecie después.
 */
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { parseBigIntId } from '../../common/http/id';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { CalculatedFieldCallSnapshot } from '../graph/graph.types';
import type { CalculatedFieldCallDto } from './artifact-contract.dto';

/** Estados en los que una versión puede invocarse desde un grafo. */
const USABLE_STATUSES = ['APPROVED', 'PUBLISHED'] as const;

export interface ResolvedCalculatedFieldCall {
  nodeKey: string;
  call: CalculatedFieldCallSnapshot;
}

@Injectable()
export class CalculatedFieldBindingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resuelve todas las llamadas del grafo en una sola consulta y devuelve el snapshot
   * congelado de cada una, listo para persistir y compilar.
   */
  async resolve(
    tenantId: bigint,
    nodes: Array<{ key: string; calculatedFieldCalls?: CalculatedFieldCallDto[] }>,
    tx: Prisma.TransactionClient,
  ): Promise<ResolvedCalculatedFieldCall[]> {
    const requested = nodes.flatMap((node) =>
      (node.calculatedFieldCalls ?? []).map((call) => ({ nodeKey: node.key, call })),
    );
    if (!requested.length) return [];

    const versionIds = [
      ...new Set(
        requested.map((entry) =>
          parseBigIntId(entry.call.calculatedFieldVersionId, 'calculatedFieldVersionId').toString(),
        ),
      ),
    ].map(BigInt);

    const versions = await tx.calculatedFieldVersion.findMany({
      where: { id: { in: versionIds }, calculatedField: { tenantId } },
      include: {
        calculatedField: { select: { fieldCode: true } },
        libraries: { include: { library: { select: { packageName: true, status: true } } } },
      },
    });
    const byId = new Map(versions.map((version) => [version.id.toString(), version]));

    return requested.map(({ nodeKey, call }) => {
      const version = byId.get(String(call.calculatedFieldVersionId));
      if (!version) {
        throw new DomainException(
          'CALCULATED_FIELD_VERSION_NOT_FOUND',
          `El nodo ${nodeKey} invoca la versión de campo calculado ${call.calculatedFieldVersionId}, que no existe en este tenant`,
          HttpStatus.NOT_FOUND,
        );
      }
      if (!(USABLE_STATUSES as readonly string[]).includes(version.status)) {
        // Un borrador puede cambiar bajo los pies del artefacto; solo lo aprobado o
        // publicado es estable para que una decisión dependa de ello.
        throw new DomainException(
          'CALCULATED_FIELD_NOT_USABLE',
          `El campo calculado ${version.calculatedField.fieldCode} está en estado ${version.status}; solo puede invocarse APPROVED o PUBLISHED`,
          HttpStatus.CONFLICT,
        );
      }
      const blocked = version.libraries.find((link) => link.library.status === 'BLOCKED');
      if (blocked) {
        throw new DomainException(
          'CALCULATED_FIELD_LIBRARY_BLOCKED',
          `El campo calculado ${version.calculatedField.fieldCode} usa la librería ${blocked.library.packageName}, que está bloqueada`,
          HttpStatus.CONFLICT,
        );
      }

      return {
        nodeKey,
        call: {
          callKey: call.callKey,
          fieldCode: version.calculatedField.fieldCode,
          calculatedFieldVersionId: version.id.toString(),
          versionNumber: version.versionNumber,
          inputMapping: call.inputMapping as CalculatedFieldCallSnapshot['inputMapping'],
          target: { kind: call.targetKind, code: call.targetCode },
          definition: {
            implementationKind: version.implementationKind,
            contract: {
              inputs: version.inputsJson,
              returns: version.returnJson,
            },
            operation: version.operationJson ?? undefined,
            sourceCode: version.sourceCode ?? undefined,
            libraryPackages: version.libraries.map((link) => link.library.packageName),
            defaultValue: version.defaultValueJson ?? undefined,
            timeoutMs: version.timeoutMs,
          },
        },
      };
    });
  }

  /** Persiste el registro de uso, que es también la dependencia inversa de §5.2. */
  async persist(
    tenantId: bigint,
    artifactVersionId: bigint,
    resolved: ResolvedCalculatedFieldCall[],
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (!resolved.length) return;
    await tx.decisionArtifactCalculatedFieldUse.createMany({
      data: resolved.map(({ nodeKey, call }) => ({
        tenantId,
        artifactVersionId,
        nodeKey,
        callKey: call.callKey,
        calculatedFieldVersionId: BigInt(call.calculatedFieldVersionId),
        inputMappingJson: call.inputMapping as unknown as Prisma.InputJsonValue,
        targetKind: call.target.kind,
        targetCode: call.target.code,
        definitionJson: call.definition as unknown as Prisma.InputJsonValue,
      })),
    });
  }
}
