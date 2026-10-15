import {
  OutputSemanticRole,
  OutputSourceKind,
  Prisma,
  SensitivityClass,
  TracePolicy,
} from '@prisma/client';
import { DomainException } from '../../../common/errors/domain-exception';
import type { ReplaceGraphDto } from '../artifact.dto';
import type { GraphWriteContext } from './graph-write-context';

/** Intermedias y contrato de salida: se reemplazan con el resto del grafo, en la misma transacción. */
export async function writeIntermediatesAndOutputContract(
  tx: Prisma.TransactionClient,
  { tenantId, versionId }: GraphWriteContext,
  dto: ReplaceGraphDto,
): Promise<void> {
  if (dto.intermediates?.length) {
    await tx.decisionIntermediateVariable.createMany({
      data: dto.intermediates.map((intermediate) => ({
        tenantId,
        artifactVersionId: versionId,
        code: intermediate.code,
        name: intermediate.name,
        description: intermediate.description,
        dataType: intermediate.dataType,
        producerNodeKey: intermediate.producerNodeKey,
        consumerNodeKeys: intermediate.consumerNodeKeys,
        initialValueJson: intermediate.initialValue as Prisma.InputJsonValue | undefined,
        constraintsJson: intermediate.constraints as Prisma.InputJsonValue | undefined,
        nullable: intermediate.nullable,
        updatePolicy: intermediate.updatePolicy,
        availabilityConditionJson: intermediate.availabilityCondition as
          Prisma.InputJsonValue | undefined,
        sensitivityClass: intermediate.sensitivityClass as SensitivityClass,
        tracePolicy: intermediate.tracePolicy as TracePolicy,
      })),
    });
  }
  if (dto.outputContract?.length) {
    // Igual que las acciones: primero los campos, luego sus motivos, porque
    // `createMany` no puede escribir la relación anidada. Los ids se recuperan
    // por `fieldCode`, que es único dentro de la versión.
    const createdFields = await tx.decisionOutputContractField.createManyAndReturn({
      data: dto.outputContract.map((field) => ({
        tenantId,
        artifactVersionId: versionId,
        fieldCode: field.code,
        name: field.name,
        description: field.description,
        sourceKind: field.sourceKind as OutputSourceKind,
        sourceRef: field.sourceRef,
        valueMappingJson: field.valueMapping as Prisma.InputJsonValue | undefined,
        absenceReasons: field.absenceReasons,
        exampleJson: field.example as Prisma.InputJsonValue | undefined,
        contractVersion: field.contractVersion,
        sensitivityClass: field.sensitivityClass as SensitivityClass,
        tracePolicy: field.tracePolicy as TracePolicy,
        /*
         * El significado económico del campo. Faltaba: la columna existía, el gate de despliegue
         * la leía y el guardián de decisiones la validaba, pero ningún camino de autoría la
         * escribía — así que TODO contrato quedaba en `NONE` y ningún artefacto de originación
         * podía llegar a producción, por un requisito que no había forma de cumplir.
         */
        semanticRole: (field.semanticRole ?? 'NONE') as OutputSemanticRole,
        policyMinValue:
          field.policyMinValue === undefined ? null : new Prisma.Decimal(field.policyMinValue),
        policyMaxValue:
          field.policyMaxValue === undefined ? null : new Prisma.Decimal(field.policyMaxValue),
      })),
      select: { id: true, fieldCode: true },
    });

    const outputReasonCodes = [
      ...new Set(dto.outputContract.flatMap((field) => field.reasonCodes ?? [])),
    ];
    if (outputReasonCodes.length) {
      const known = await tx.decisionReasonCode.findMany({
        where: { tenantId, reasonCode: { in: outputReasonCodes } },
        select: { id: true, reasonCode: true },
      });
      if (known.length !== outputReasonCodes.length) {
        const found = new Set(known.map((row) => row.reasonCode));
        const missing = outputReasonCodes.filter((code) => !found.has(code));
        throw new DomainException(
          'REASON_CODE_NOT_FOUND',
          `Unknown reason codes in the output contract: ${missing.join(', ')}`,
        );
      }
      const reasonIdByCode = new Map(known.map((row) => [row.reasonCode, row.id]));
      const fieldIdByCode = new Map(createdFields.map((row) => [row.fieldCode, row.id]));
      const rows = dto.outputContract.flatMap((field) =>
        (field.reasonCodes ?? []).map((code, index) => ({
          outputFieldId: fieldIdByCode.get(field.code)!,
          reasonCodeId: reasonIdByCode.get(code)!,
          // El orden declarado es la prioridad: quien consume la decisión lee
          // los motivos en el mismo orden en que el autor los puso.
          priority: (index + 1) * 10,
        })),
      );
      if (rows.length) await tx.decisionOutputFieldReasonMap.createMany({ data: rows });
    }
  }
}
