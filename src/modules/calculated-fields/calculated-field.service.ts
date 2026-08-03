/**
 * Ciclo de vida de un campo calculado (§5): alta, versionado inmutable y promoción.
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
import { pageResult, paginationArgs } from '../../common/http/pagination';
import { parseBigIntId } from '../../common/http/id';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { LibraryService } from '../libraries/library.service';
import { buildSampleBatch, seedSequence, type SampleRequest } from '../qa-lab/sample-inputs';
import { allowedFunctionsFor } from '../libraries/library-preludes';
import { validateCalculatedFieldContract } from './calculated-field-contract.validator';
import {
  CalculatedFieldExecutorService,
  type ExecutableCalculatedField,
} from './calculated-field-executor.service';
import type {
  CalculatedFieldQueryDto,
  CreateCalculatedFieldDto,
  CreateCalculatedFieldVersionDto,
  PromoteCalculatedFieldVersionDto,
} from './calculated-field.dto';
import type { CalculatedFieldContract, OperationNode } from './calculated-field.types';

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
export class CalculatedFieldService {
  /** Semillas distintas en pulsaciones sucesivas del botón de generar. */
  private readonly nextSampleSeed = seedSequence('calculated-field-sample');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly libraries: LibraryService,
    private readonly executor: CalculatedFieldExecutorService,
  ) {}

  async list(tenantId: bigint, query: CalculatedFieldQueryDto) {
    const { skip, take, page, pageSize } = paginationArgs(query);
    const where: Prisma.CalculatedFieldWhereInput = {
      tenantId,
      ...(query.category ? { category: query.category } : {}),
      ...(query.search
        ? {
            OR: [
              { fieldCode: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.implementationKind || query.status
        ? {
            versions: {
              some: {
                ...(query.implementationKind
                  ? { implementationKind: query.implementationKind as CalculatedFieldImplKind }
                  : {}),
                ...(query.status ? { status: query.status as CalculatedFieldStatus } : {}),
              },
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.calculatedField.findMany({
        where,
        orderBy: [{ category: 'asc' }, { fieldCode: 'asc' }],
        skip,
        take,
        include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
      }),
      this.prisma.calculatedField.count({ where }),
    ]);
    return pageResult(
      rows.map((row) => ({
        id: row.id.toString(),
        fieldCode: row.fieldCode,
        name: row.name,
        description: row.description,
        category: row.category,
        ownerTeam: row.ownerTeam,
        isActive: row.isActive,
        latestVersion: row.versions[0]?.versionNumber ?? null,
        status: row.versions[0]?.status ?? null,
        implementationKind: row.versions[0]?.implementationKind ?? null,
        returnType:
          (row.versions[0]?.returnJson as { dataType?: string } | undefined)?.dataType ?? null,
        updatedAt: row.updatedAt,
      })),
      total,
      page,
      pageSize,
    );
  }

  async get(tenantId: bigint, fieldId: bigint) {
    const field = await this.prisma.calculatedField.findFirst({
      where: { id: fieldId, tenantId },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          include: {
            libraries: { include: { library: true } },
            testCases: { orderBy: { id: 'asc' } },
            // §5.2 «Dependencias»: qué artefactos usan esta versión. Es también lo que
            // impide retirarla a ciegas: el borrado está restringido en la base.
            artifactUses: {
              include: {
                artifactVersion: {
                  select: {
                    id: true,
                    versionNumber: true,
                    semanticVersion: true,
                    status: true,
                    artifact: { select: { artifactCode: true, name: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!field) {
      throw new DomainException(
        'CALCULATED_FIELD_NOT_FOUND',
        'Campo calculado no encontrado',
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      id: field.id.toString(),
      fieldCode: field.fieldCode,
      name: field.name,
      description: field.description,
      rationale: field.rationale,
      category: field.category,
      ownerTeam: field.ownerTeam,
      isActive: field.isActive,
      versions: field.versions.map((version) => ({
        id: version.id.toString(),
        versionNumber: version.versionNumber,
        status: version.status,
        implementationKind: version.implementationKind,
        inputs: version.inputsJson,
        returns: version.returnJson,
        comments: version.commentsJson,
        operation: version.operationJson,
        sourceCode: version.sourceCode,
        timeoutMs: version.timeoutMs,
        errorPolicy: version.errorPolicy,
        defaultValue: version.defaultValueJson,
        environment: version.environment,
        contentHash: version.contentHash,
        authorId: version.authorId,
        reviewerId: version.reviewerId,
        approverId: version.approverId,
        createdAt: version.createdAt,
        publishedAt: version.publishedAt,
        libraries: version.libraries.map((link) => ({
          id: link.library.id.toString(),
          logicalName: link.library.logicalName,
          packageName: link.library.packageName,
          version: link.library.version,
          language: link.library.language,
          category: link.library.category,
        })),
        usedBy: version.artifactUses.map((use) => ({
          artifactCode: use.artifactVersion.artifact.artifactCode,
          artifactName: use.artifactVersion.artifact.name,
          artifactVersionId: use.artifactVersion.id.toString(),
          versionNumber: use.artifactVersion.versionNumber,
          semanticVersion: use.artifactVersion.semanticVersion,
          status: use.artifactVersion.status,
          nodeKey: use.nodeKey,
          callKey: use.callKey,
          target: `${use.targetKind.toLowerCase()}.${use.targetCode}`,
        })),
        testCases: version.testCases.map((testCase) => ({
          id: testCase.id.toString(),
          name: testCase.name,
          inputs: testCase.inputsJson,
          expected: testCase.expectedJson,
          expectedErrorCode: testCase.expectedErrorCode,
        })),
      })),
    };
  }

  async create(tenantId: bigint, dto: CreateCalculatedFieldDto, principal: AuthenticatedPrincipal) {
    const existing = await this.prisma.calculatedField.findFirst({
      where: { tenantId, fieldCode: dto.fieldCode },
      select: { id: true },
    });
    if (existing) {
      throw new DomainException(
        'CALCULATED_FIELD_CODE_TAKEN',
        `Ya existe un campo calculado con el código ${dto.fieldCode}`,
        HttpStatus.CONFLICT,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.calculatedField.create({ data: { tenantId, ...dto } });
      await this.audit.append(
        {
          tenantId,
          eventType: 'CALCULATED_FIELD_CREATED',
          aggregateType: 'CalculatedField',
          aggregateId: created.id.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { fieldCode: created.fieldCode, category: created.category },
        },
        tx,
      );
      return { id: created.id.toString(), fieldCode: created.fieldCode };
    });
  }

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
    const version = await this.loadVersion(tenantId, versionId);
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
      const report = await this.runTestCases(tenantId, versionId);
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

  /** Ejecuta el campo con entradas de ejemplo, sin persistir nada (§6.1). */
  async tryRun(tenantId: bigint, versionId: bigint, inputs: Record<string, unknown>) {
    const executable = await this.toExecutable(tenantId, versionId);
    const result = await this.executor.execute(executable, inputs);
    return { ...result, fieldCode: executable.fieldCode };
  }

  /**
   * Entradas de ejemplo derivadas del contrato de la versión, sin ejecutarlas.
   *
   * Reutiliza el generador del QA Lab en vez de tener uno propio: las entradas de
   * un campo calculado declaran tipo y restricciones igual que las variables de un
   * artefacto, así que la misma lógica sirve y no quedan dos criterios distintos
   * sobre qué es un valor «válido» o «de frontera».
   *
   * Determinista por semilla: repetirla devuelve el mismo lote, que es lo que
   * permite reproducir un caso que falló.
   */
  async sampleInputs(tenantId: bigint, versionId: bigint, request: SampleRequest) {
    const executable = await this.toExecutable(tenantId, versionId);
    const inputs = executable.contract.inputs ?? [];
    if (!inputs.length) {
      throw new DomainException(
        'CALCULATED_FIELD_HAS_NO_INPUTS',
        'Esta versión no declara entradas, así que no hay valores que generar',
        HttpStatus.CONFLICT,
      );
    }
    const batch = buildSampleBatch(
      inputs.map((input) => ({
        code: input.id,
        dataType: input.dataType,
        required: input.required,
        // Una entrada de campo calculado no declara nulabilidad propia: si no es
        // obligatoria, puede faltar.
        nullable: !input.required,
        defaultValue: input.defaultValue,
        constraints: input.constraints,
      })),
      request,
      this.nextSampleSeed,
    );
    return { ...batch, versionId: versionId.toString(), fieldCode: executable.fieldCode };
  }

  async runTestCases(tenantId: bigint, versionId: bigint) {
    const executable = await this.toExecutable(tenantId, versionId);
    const testCases = await this.prisma.calculatedFieldTestCase.findMany({
      where: { calculatedFieldVersionId: versionId },
      orderBy: { id: 'asc' },
    });
    const results = [];
    for (const testCase of testCases) {
      results.push(await this.runSingleTestCase(executable, testCase));
    }
    return {
      total: results.length,
      passed: results.filter((entry) => entry.passed).length,
      failed: results.filter((entry) => !entry.passed).length,
      results,
    };
  }

  private async runSingleTestCase(
    executable: ExecutableCalculatedField,
    testCase: {
      name: string;
      inputsJson: Prisma.JsonValue;
      expectedJson: Prisma.JsonValue;
      expectedErrorCode: string | null;
    },
  ) {
    try {
      const result = await this.executor.execute(
        executable,
        testCase.inputsJson as Record<string, unknown>,
      );
      const passed = testCase.expectedErrorCode
        ? false
        : JSON.stringify(result.value) === JSON.stringify(testCase.expectedJson);
      return { name: testCase.name, passed, actual: result.value, expected: testCase.expectedJson };
    } catch (error) {
      const code = error instanceof DomainException ? error.code : 'UNEXPECTED_ERROR';
      return {
        name: testCase.name,
        passed: testCase.expectedErrorCode === code,
        actual: null,
        error: code,
        expected: testCase.expectedJson,
      };
    }
  }

  /** Carga una versión y la convierte en algo directamente ejecutable. */
  async toExecutable(tenantId: bigint, versionId: bigint): Promise<ExecutableCalculatedField> {
    const version = await this.loadVersion(tenantId, versionId);
    return {
      fieldCode: version.calculatedField.fieldCode,
      implementationKind: version.implementationKind,
      contract: {
        inputs: version.inputsJson as unknown as CalculatedFieldContract['inputs'],
        returns: version.returnJson as unknown as CalculatedFieldContract['returns'],
      },
      operation: (version.operationJson ?? undefined) as OperationNode | undefined,
      sourceCode: version.sourceCode ?? undefined,
      libraryPackages: version.libraries.map((link) => link.library.packageName),
      defaultValue: version.defaultValueJson ?? undefined,
    };
  }

  private async loadVersion(tenantId: bigint, versionId: bigint) {
    const version = await this.prisma.calculatedFieldVersion.findFirst({
      where: { id: versionId, calculatedField: { tenantId } },
      include: {
        calculatedField: { select: { fieldCode: true } },
        libraries: { include: { library: { select: { packageName: true } } } },
      },
    });
    if (!version) {
      throw new DomainException(
        'CALCULATED_FIELD_VERSION_NOT_FOUND',
        'Versión de campo calculado no encontrada',
        HttpStatus.NOT_FOUND,
      );
    }
    return version;
  }
}
