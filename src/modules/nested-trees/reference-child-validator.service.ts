import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateArtifactReferenceDto } from './nested-tree.dto';
import { validateReferenceContract } from './reference-contract.validator';

/** Que el hijo se pueda referenciar: existe, compila, la política de versión lo admite y su contrato encaja. */
@Injectable()
export class ReferenceChildValidator {
  constructor(private readonly prisma: PrismaService) {}

  async assertReferencableChild(
    tenantId: bigint,
    parentArtifactId: bigint,
    childArtifactId: bigint,
    childVersionId: bigint,
  ): Promise<void> {
    if (childArtifactId === parentArtifactId) {
      throw new DomainException(
        'SELF_REFERENCE_FORBIDDEN',
        'An artifact cannot directly reference itself',
        HttpStatus.BAD_REQUEST,
      );
    }
    const childArtifact = await this.prisma.decisionArtifact.findFirst({
      where: { id: childArtifactId, tenantId, isActive: true },
      select: { id: true },
    });
    if (!childArtifact) {
      throw new DomainException(
        'CHILD_ARTIFACT_NOT_FOUND',
        'Child artifact not found',
        HttpStatus.NOT_FOUND,
      );
    }
    const childVersion = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: childVersionId, artifactId: childArtifactId },
      select: { id: true },
    });
    if (!childVersion) {
      throw new DomainException(
        'CHILD_VERSION_NOT_FOUND',
        'Child artifact version not found for the given child artifact',
        HttpStatus.NOT_FOUND,
      );
    }
    const compiled = await this.prisma.decisionCompiledArtifact.findFirst({
      where: { artifactVersionId: childVersionId, compileStatus: 'SUCCESS' },
      orderBy: { compiledAt: 'desc' },
      select: { id: true },
    });
    if (!compiled) {
      throw new DomainException(
        'CHILD_VERSION_NOT_COMPILED',
        'The referenced child version has no successful compiled artifact yet; compile it before referencing it',
        HttpStatus.CONFLICT,
      );
    }
  }

  /**
   * §9.1: en PROD una referencia debe apuntar a una versión exacta. Resolver «la activa
   * del ambiente» significa que la misma entrada puede dar resultados distintos según
   * cuándo se ejecute, y eso rompe la reproducibilidad que exige una decisión auditable.
   */
  assertVersionPolicy(dto: CreateArtifactReferenceDto): void {
    if (
      dto.versionSelection === 'ACTIVE_IN_ENVIRONMENT' &&
      (dto.environmentCode ?? '').toUpperCase() === 'PROD'
    ) {
      throw new DomainException(
        'REFERENCE_VERSION_POLICY_FORBIDDEN',
        'En PROD la referencia debe fijar una versión exacta: resolver la activa del ambiente haría la decisión irreproducible',
        HttpStatus.CONFLICT,
      );
    }
  }

  /**
   * Comprueba que el contrato del hijo pueda satisfacerse con lo que el padre ofrece
   * (§9.2). Se ejecuta al guardar, no al ejecutar: una referencia rota descubierta en
   * producción ya costó una decisión fallida.
   */
  async assertCompatibleContracts(
    parentVersionId: bigint,
    childVersionId: bigint,
    inputMapping: CreateArtifactReferenceDto['inputMapping'],
    outputMapping: CreateArtifactReferenceDto['outputMapping'],
  ): Promise<void> {
    const [parentContext, childContract] = await Promise.all([
      this.loadParentContext(parentVersionId),
      this.loadChildContract(childVersionId),
    ]);
    const issues = validateReferenceContract({
      childInputs: childContract.inputs,
      childOutputs: childContract.outputs,
      parentContext,
      inputMapping: inputMapping ?? [],
      outputMapping: outputMapping ?? [],
    });
    if (issues.length) {
      throw new DomainException(
        'REFERENCE_CONTRACT_INCOMPATIBLE',
        `El contrato del artefacto referenciado no puede satisfacerse: ${issues[0].message}`,
        HttpStatus.CONFLICT,
        { issues },
      );
    }
  }

  /** Variables de entrada e intermedias que el padre puede ofrecer como origen. */
  async loadParentContext(parentVersionId: bigint) {
    const [dependencies, intermediates] = await Promise.all([
      this.prisma.decisionArtifactVariableDependency.findMany({
        where: { artifactVersionId: parentVersionId },
        include: { variableVersion: { include: { definition: true } } },
      }),
      this.prisma.decisionIntermediateVariable.findMany({
        where: { artifactVersionId: parentVersionId },
      }),
    ]);
    return [
      ...dependencies.map((dependency) => ({
        code: dependency.variableVersion.definition.variableCode,
        dataType: dependency.variableVersion.dataType,
        required: dependency.isRequired,
        nullable: dependency.variableVersion.nullable,
      })),
      ...intermediates.map((intermediate) => ({
        code: intermediate.code,
        dataType: intermediate.dataType,
        required: true,
        nullable: intermediate.nullable,
      })),
    ];
  }

  async loadChildContract(childVersionId: bigint) {
    const dependencies = await this.prisma.decisionArtifactVariableDependency.findMany({
      where: { artifactVersionId: childVersionId },
      include: { variableVersion: { include: { definition: true } } },
    });
    const mapped = dependencies.map((dependency) => ({
      isOutput: dependency.usageType.startsWith('OUTPUT'),
      entry: {
        code: dependency.variableVersion.definition.variableCode,
        dataType: dependency.variableVersion.dataType,
        required: dependency.isRequired,
        nullable: dependency.variableVersion.nullable,
      },
    }));
    return {
      inputs: mapped.filter((item) => !item.isOutput).map((item) => item.entry),
      outputs: mapped.filter((item) => item.isOutput).map((item) => item.entry),
    };
  }
}
