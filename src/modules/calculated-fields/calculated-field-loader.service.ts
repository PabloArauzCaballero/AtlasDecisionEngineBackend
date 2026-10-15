import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ExecutableCalculatedField } from './calculated-field-executor.service';
import type { CalculatedFieldContract, OperationNode } from './calculated-field.types';

@Injectable()
export class CalculatedFieldLoader {
  constructor(private readonly prisma: PrismaService) {}

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

  async loadVersion(tenantId: bigint, versionId: bigint) {
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
