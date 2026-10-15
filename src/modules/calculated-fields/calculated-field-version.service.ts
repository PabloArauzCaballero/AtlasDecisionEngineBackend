/**
 * Ciclo de vida de un campo calculado (§5): versionado inmutable y promoción.
 *
 * Una versión PUBLISHED nunca se edita: se clona. Es la misma regla de inmutabilidad
 * que gobierna los artefactos, y sin ella una decisión ya tomada dejaría de ser
 * reproducible en cuanto alguien "corrigiera" el cálculo.
 */
import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { CalculatedFieldImplKind, CalculatedFieldStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { parseBigIntId } from '../../common/http/id';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { LibraryService } from '../libraries/library.service';
import { allowedFunctionsFor } from '../libraries/library-preludes';
import { validateCalculatedFieldContract } from './calculated-field-contract.validator';
import { CalculatedFieldLoader } from './calculated-field-loader.service';
import { CalculatedFieldTestingService } from './calculated-field-testing.service';
import type {
  CreateCalculatedFieldVersionDto,
  PromoteCalculatedFieldVersionDto,
} from './calculated-field.dto';

/** Transiciones permitidas del estado de una versión. */
const TRANSITIONS: Readonly<Record<string, readonly CalculatedFieldStatus[]>> = {
  DRAFT: ['IN_REVIEW', 'RETIRED'],
  IN_REVIEW: ['APPROVED', 'DRAFT', 'RETIRED'],
  APPROVED: ['PUBLISHED', 'DRAFT', 'RETIRED'],
  PUBLISHED: ['DEPRECATED', 'RETIRED'],
  DEPRECATED: ['RETIRED'],
  RETIRED: [],
};

@Injectable()
export class CalculatedFieldVersionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly libraries: LibraryService,
    private readonly loader: CalculatedFieldLoader,
    private readonly testing: CalculatedFieldTestingService,
  ) {}

  async createVersion(
    tenantId: bigint,
    fieldId: bigint,
    dto: CreateCalculatedFieldVersionDto,
    principal: AuthenticatedPrincipal,
  ) {
    const field = await this.prisma.calculatedField.findFirst({
      where: { id: fieldId, tenantId },
      select: { id: true, fieldCode: true },
    });
    if (!field) {
      throw new DomainException(
        'CALCULATED_FIELD_NOT_FOUND',
        'Campo calculado no encontrado',
        HttpStatus.NOT_FOUND,
      );
    }

    const libraryIds = (dto.libraryIds ?? []).map((id) => parseBigIntId(id, 'libraryId'));
    const libraries = await this.libraries.resolveForExecution(
      tenantId,
      libraryIds,
      dto.implementationKind as CalculatedFieldImplKind,
      dto.environment ?? null,
    );
    const allowedFunctions =
      dto.implementationKind === 'OPERATION'
        ? []
        : allowedFunctionsFor(
            libraries.map((library) => library.packageName),
            dto.implementationKind,
          );

    const validation = validateCalculatedFieldContract(dto, allowedFunctions);
    if (!validation.valid) {
      throw new DomainException(
        'CALCULATED_FIELD_CONTRACT_INVALID',
        'El contrato del campo calculado no es válido',
        HttpStatus.BAD_REQUEST,
        { issues: validation.issues },
      );
    }

    const latest = await this.prisma.calculatedFieldVersion.findFirst({
      where: { calculatedFieldId: fieldId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    const versionNumber = (latest?.versionNumber ?? 0) + 1;
    const sourceChecksum = dto.sourceCode
      ? createHash('sha256').update(dto.sourceCode).digest('hex')
      : null;
    const contentHash = createHash('sha256')
      .update(
        JSON.stringify({
          inputs: dto.inputs,
          returns: dto.returns,
          operation: dto.operation ?? null,
          sourceCode: dto.sourceCode ?? null,
          libraries: libraries.map((library) => `${library.packageName}@${library.version}`).sort(),
        }),
      )
      .digest('hex');

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.calculatedFieldVersion.create({
        data: {
          calculatedFieldId: fieldId,
          versionNumber,
          implementationKind: dto.implementationKind as CalculatedFieldImplKind,
          inputsJson: dto.inputs as unknown as Prisma.InputJsonValue,
          returnJson: dto.returns as unknown as Prisma.InputJsonValue,
          commentsJson: dto.comments as unknown as Prisma.InputJsonValue | undefined,
          operationJson: dto.operation as Prisma.InputJsonValue | undefined,
          sourceCode: dto.sourceCode,
          sourceChecksum,
          timeoutMs: dto.timeoutMs ?? 50,
          errorPolicy: dto.errorPolicy ?? 'FAIL',
          defaultValueJson: dto.defaultValue as Prisma.InputJsonValue | undefined,
          contentHash,
          environment: dto.environment,
          authorId: principal.id,
        },
      });
      if (libraries.length) {
        await tx.calculatedFieldLibrary.createMany({
          data: libraries.map((library) => ({
            calculatedFieldVersionId: created.id,
            approvedLibraryId: library.id,
          })),
        });
      }
      if (dto.testCases?.length) {
        await tx.calculatedFieldTestCase.createMany({
          data: dto.testCases.map((testCase) => ({
            calculatedFieldVersionId: created.id,
            name: testCase.name,
            inputsJson: testCase.inputs as Prisma.InputJsonValue,
            expectedJson: testCase.expected as Prisma.InputJsonValue | undefined,
            expectedErrorCode: testCase.expectedErrorCode,
          })),
        });
      }
      await this.audit.append(
        {
          tenantId,
          eventType: 'CALCULATED_FIELD_VERSION_CREATED',
          aggregateType: 'CalculatedFieldVersion',
          aggregateId: created.id.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            fieldCode: field.fieldCode,
            versionNumber,
            implementationKind: dto.implementationKind,
            contentHash,
            libraries: libraries.map((library) => `${library.logicalName}@${library.version}`),
          },
        },
        tx,
      );
      return {
        id: created.id.toString(),
        versionNumber,
        status: created.status,
        contentHash,
        executableLines: validation.codeGuard?.executableLines ?? 0,
      };
    });
  }

  async promote(
    tenantId: bigint,
    versionId: bigint,
    dto: PromoteCalculatedFieldVersionDto,
    principal: AuthenticatedPrincipal,
  ) {
    const version = await this.loader.loadVersion(tenantId, versionId);
    const target = dto.status as CalculatedFieldStatus;
    if (target === 'RETIRED' || target === 'DEPRECATED') {
      const uses = await this.prisma.decisionArtifactCalculatedFieldUse.count({
        where: { calculatedFieldVersionId: versionId },
      });
      if (uses > 0 && target === 'RETIRED') {
        // Retirar una versión que algún artefacto invoca dejaría ese artefacto sin poder
        // explicar cómo calculó su decisión. Se avisa aquí y no con un error de clave
        // foránea seis capas más abajo.
        throw new DomainException(
          'CALCULATED_FIELD_VERSION_IN_USE',
          `No se puede retirar: ${uses} artefacto(s) invocan esta versión`,
          HttpStatus.CONFLICT,
          { uses },
        );
      }
    }
    if (!TRANSITIONS[version.status].includes(target)) {
      throw new DomainException(
        'CALCULATED_FIELD_TRANSITION_INVALID',
        `No se puede pasar de ${version.status} a ${target}`,
        HttpStatus.CONFLICT,
        { allowed: TRANSITIONS[version.status] },
      );
    }
    // Publicar exige que las pruebas declaradas pasen de verdad: una versión
    // publicada es inmutable, así que es la última oportunidad de detectarlo.
    if (target === 'PUBLISHED') {
      const report = await this.testing.runTestCases(tenantId, versionId);
      if (report.failed > 0) {
        throw new DomainException(
          'CALCULATED_FIELD_TESTS_FAILED',
          `No se puede publicar: ${report.failed} de ${report.total} casos de prueba fallan`,
          HttpStatus.CONFLICT,
          { results: report.results },
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.calculatedFieldVersion.update({
        where: { id: versionId },
        data: {
          status: target,
          reviewerId: target === 'IN_REVIEW' ? principal.id : version.reviewerId,
          approverId: target === 'APPROVED' ? principal.id : version.approverId,
          publishedAt: target === 'PUBLISHED' ? new Date() : version.publishedAt,
        },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'CALCULATED_FIELD_VERSION_PROMOTED',
          aggregateType: 'CalculatedFieldVersion',
          aggregateId: versionId.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { from: version.status, to: target, note: dto.note ?? null },
        },
        tx,
      );
      return { id: updated.id.toString(), status: updated.status };
    });
  }
}
