/**
 * Validación previa y compatibilidad entre versiones de una variable (§1.2).
 *
 * Dos operaciones que el catálogo no tenía y que el pliego exige explícitamente:
 *
 * 1. **Validar antes de guardar.** Una versión de variable es inmutable en cuanto algún
 *    artefacto la usa, así que descubrir que el contrato estaba mal al publicar es
 *    descubrirlo tarde. Aquí se compila el contrato, se prueban sus propios ejemplos y
 *    se devuelven todos los incumplimientos de una vez.
 * 2. **Verificar compatibilidad entre versiones.** Estrechar un contrato (subir el
 *    mínimo, quitar un valor permitido, volver obligatorio lo opcional) rompe a quien ya
 *    envía datos válidos según la versión anterior. Se detecta y se marca como cambio
 *    incompatible, en vez de dejar que falle en la primera decisión real.
 */
import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';
import {
  parseConstraints,
  resolveConstraints,
  validateAgainstConstraints,
} from '../../common/contracts/constraint-engine';
import { checkConstraintCoherence } from '../../common/contracts/constraint-coherence';
import type { VariableConstraints } from '../../common/contracts/constraints.types';
import {
  isTypeAssignable,
  normalizeDataType,
  normalizeDataTypeOrString,
} from '../../common/contracts/data-types';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ValidateVariableContractDto } from './variable.dto';

export interface ContractIssue {
  code: string;
  message: string;
  path?: string;
}

export interface SampleCheck {
  value: unknown;
  valid: boolean;
  errors: string[];
}

export interface ContractValidationReport {
  valid: boolean;
  issues: ContractIssue[];
  /** Resultado de aplicar el contrato a cada ejemplo y valor de prueba. */
  samples: SampleCheck[];
  /** Restricciones ya aplanadas, tal como las aplicará el motor. */
  resolvedConstraints: VariableConstraints;
}

export type CompatibilityLevel = 'COMPATIBLE' | 'WIDENING' | 'BREAKING';

export interface CompatibilityReport {
  level: CompatibilityLevel;
  changes: Array<{ level: CompatibilityLevel; code: string; message: string }>;
}

@Injectable()
export class VariableContractService {
  constructor(private readonly prisma: PrismaService) {}

  /** Comprueba la coherencia interna del contrato y prueba sus ejemplos (§1.2). */
  validateContract(dto: ValidateVariableContractDto): ContractValidationReport {
    const issues: ContractIssue[] = [];
    const dataType = normalizeDataType(dto.dataType);
    if (!dataType) {
      issues.push({
        code: 'DATA_TYPE_UNKNOWN',
        message: `El tipo ${dto.dataType} no está en el catálogo canónico`,
        path: 'dataType',
      });
    }
    const constraints = parseConstraints(dto.constraints ?? dto.validationSchema);
    issues.push(...this.checkConstraintCoherence(constraints));

    if (dto.defaultValue !== undefined && dto.defaultValue !== null && dataType) {
      const violations = validateAgainstConstraints(dataType, constraints, dto.defaultValue);
      issues.push(
        ...violations.map((violation) => ({
          code: 'DEFAULT_VALUE_INVALID',
          message: `El valor por defecto ${violation.message}`,
          path: 'defaultValue',
        })),
      );
    }

    const samples: SampleCheck[] = [];
    if (dataType) {
      // El ejemplo válido DEBE pasar y el inválido DEBE fallar. Un ejemplo que no hace
      // lo que promete es peor que no tenerlo: documenta mal el contrato.
      if (dto.exampleValid !== undefined) {
        const errors = validateAgainstConstraints(dataType, constraints, dto.exampleValid).map(
          (violation) => violation.message,
        );
        samples.push({ value: dto.exampleValid, valid: !errors.length, errors });
        if (errors.length) {
          issues.push({
            code: 'EXAMPLE_VALID_REJECTED',
            message: `El ejemplo válido no cumple el contrato: ${errors.join('; ')}`,
            path: 'exampleValid',
          });
        }
      }
      if (dto.exampleInvalid !== undefined) {
        const errors = validateAgainstConstraints(dataType, constraints, dto.exampleInvalid).map(
          (violation) => violation.message,
        );
        samples.push({ value: dto.exampleInvalid, valid: !errors.length, errors });
        if (!errors.length) {
          issues.push({
            code: 'EXAMPLE_INVALID_ACCEPTED',
            message: 'El ejemplo inválido es aceptado por el contrato: no demuestra nada',
            path: 'exampleInvalid',
          });
        }
      }
      for (const value of dto.sampleValues ?? []) {
        const errors = validateAgainstConstraints(dataType, constraints, value).map(
          (violation) => violation.message,
        );
        samples.push({ value, valid: !errors.length, errors });
      }
    }

    if (!dto.nullable && dto.defaultValue === null) {
      issues.push({
        code: 'NULL_DEFAULT_ON_NON_NULLABLE',
        message: 'El valor por defecto es nulo pero la variable no admite nulos',
        path: 'defaultValue',
      });
    }

    return {
      valid: issues.length === 0,
      issues,
      samples,
      resolvedConstraints: resolveConstraints(constraints),
    };
  }

  /**
   * Restricciones que se contradicen entre sí. La regla vive en
   * `common/contracts/constraint-coherence` porque el validador de artefactos la
   * aplica también a las entradas declaradas, antes de publicar.
   */
  private checkConstraintCoherence(constraints: VariableConstraints): ContractIssue[] {
    return checkConstraintCoherence(constraints);
  }

  /**
   * Compara una versión nueva con la última existente y clasifica el cambio.
   * `BREAKING` significa que datos hoy válidos dejarían de serlo.
   */
  async checkCompatibility(
    tenantId: bigint,
    definitionId: bigint,
    candidate: ValidateVariableContractDto,
  ): Promise<CompatibilityReport> {
    const previous = await this.prisma.decisionVariableVersion.findFirst({
      where: { variableDefinitionId: definitionId, definition: { tenantId } },
      orderBy: { versionNumber: 'desc' },
    });
    if (!previous) return { level: 'COMPATIBLE', changes: [] };

    const changes: CompatibilityReport['changes'] = [];
    const from = normalizeDataTypeOrString(previous.dataType);
    const to = normalizeDataTypeOrString(candidate.dataType);
    if (from !== to) {
      changes.push({
        level: isTypeAssignable(from, to) ? 'WIDENING' : 'BREAKING',
        code: 'DATA_TYPE_CHANGED',
        message: `El tipo pasa de ${from} a ${to}`,
      });
    }
    if (previous.nullable && !candidate.nullable) {
      changes.push({
        level: 'BREAKING',
        code: 'NULLABLE_REMOVED',
        message: 'La variable dejaba pasar nulos y ahora no',
      });
    }

    const before = parseConstraints(previous.constraintsJson ?? previous.validationSchemaJson);
    const after = parseConstraints(candidate.constraints ?? candidate.validationSchema);
    changes.push(...compareBound('min', before.min, after.min, 'raise'));
    changes.push(...compareBound('max', before.max, after.max, 'lower'));
    changes.push(...compareBound('minLength', before.minLength, after.minLength, 'raise'));
    changes.push(...compareBound('maxLength', before.maxLength, after.maxLength, 'lower'));
    changes.push(...compareBound('minItems', before.minItems, after.minItems, 'raise'));
    changes.push(...compareBound('maxItems', before.maxItems, after.maxItems, 'lower'));

    if (before.allowedValues && after.allowedValues) {
      const removed = before.allowedValues.filter(
        (value) => !after.allowedValues!.some((candidateValue) => candidateValue === value),
      );
      if (removed.length) {
        changes.push({
          level: 'BREAKING',
          code: 'ALLOWED_VALUES_REMOVED',
          message: `Dejan de admitirse valores hoy válidos: ${removed.join(', ')}`,
        });
      }
    } else if (!before.allowedValues && after.allowedValues) {
      changes.push({
        level: 'BREAKING',
        code: 'ALLOWED_VALUES_INTRODUCED',
        message: 'Se cierra el dominio a una lista de valores: lo demás deja de valer',
      });
    }
    if (!before.pattern && after.pattern) {
      changes.push({
        level: 'BREAKING',
        code: 'PATTERN_INTRODUCED',
        message: 'Se exige un patrón que antes no existía',
      });
    }

    const level: CompatibilityLevel = changes.some((change) => change.level === 'BREAKING')
      ? 'BREAKING'
      : changes.some((change) => change.level === 'WIDENING')
        ? 'WIDENING'
        : 'COMPATIBLE';
    return { level, changes };
  }

  /**
   * Impide crear una versión incompatible cuando la variable ya alimenta artefactos
   * desplegados: ahí el cambio no es una decisión de catálogo, es una rotura en producción.
   */
  async assertSafeToVersion(
    tenantId: bigint,
    definitionId: bigint,
    candidate: ValidateVariableContractDto,
  ): Promise<CompatibilityReport> {
    const report = await this.checkCompatibility(tenantId, definitionId, candidate);
    if (report.level !== 'BREAKING') return report;

    const deployedUses = await this.prisma.decisionArtifactVariableDependency.count({
      where: {
        variableVersion: { variableDefinitionId: definitionId },
        artifactVersion: { status: { in: ['DEPLOYED_TO_PROD', 'DEPLOYED_TO_TEST', 'APPROVED'] } },
      },
    });
    if (deployedUses > 0) {
      throw new DomainException(
        'VARIABLE_CONTRACT_INCOMPATIBLE',
        `El cambio rompe el contrato y ${deployedUses} versión(es) aprobadas o desplegadas usan esta variable`,
        HttpStatus.CONFLICT,
        { changes: report.changes, deployedUses },
      );
    }
    return report;
  }
}

/** Un límite que se estrecha rompe; uno que se relaja, no. */
function compareBound(
  name: string,
  before: number | undefined,
  after: number | undefined,
  tightening: 'raise' | 'lower',
): CompatibilityReport['changes'] {
  if (after === undefined) {
    return before === undefined
      ? []
      : [
          {
            level: 'WIDENING',
            code: `${name.toUpperCase()}_REMOVED`,
            message: `Se elimina el límite ${name}`,
          },
        ];
  }
  if (before === undefined) {
    return [
      {
        level: 'BREAKING',
        code: `${name.toUpperCase()}_INTRODUCED`,
        message: `Se introduce el límite ${name} = ${after}`,
      },
    ];
  }
  if (before === after) return [];
  const tightened = tightening === 'raise' ? after > before : after < before;
  return [
    {
      level: tightened ? 'BREAKING' : 'WIDENING',
      code: `${name.toUpperCase()}_${tightened ? 'TIGHTENED' : 'RELAXED'}`,
      message: `${name} pasa de ${before} a ${after}`,
    },
  ];
}
