/** Reconstructs the canonical graph snapshot used by validation, compilation and the editor. */
import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DomainException } from '../../common/errors/domain-exception';
import type { ArtifactGraphSnapshot, CalculatedFieldCallSnapshot } from '../graph/graph.types';

@Injectable()
export class ArtifactGraphReaderService {
  constructor(private readonly prisma: PrismaService) {}

  async loadSnapshot(tenantId: bigint, versionId: bigint): Promise<ArtifactGraphSnapshot> {
    const version = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: versionId, artifact: { tenantId } },
      include: {
        artifact: true,
        intermediateVariables: { orderBy: { code: 'asc' } },
        calculatedFieldUses: {
          orderBy: [{ nodeKey: 'asc' }, { callKey: 'asc' }],
          include: {
            calculatedFieldVersion: {
              select: { versionNumber: true, calculatedField: { select: { fieldCode: true } } },
            },
          },
        },
        outputContractFields: {
          orderBy: { fieldCode: 'asc' },
          include: {
            reasonCodes: {
              include: { reasonCode: true },
              orderBy: [{ priority: 'asc' }, { id: 'asc' }],
            },
          },
        },
        variableDependencies: {
          include: {
            variableVersion: {
              include: {
                definition: true,
                validationRules: true,
                sources: { orderBy: [{ precedence: 'asc' }, { id: 'asc' }] },
              },
            },
          },
        },
        conditions: true,
        actions: {
          include: {
            reasonMappings: {
              include: { reasonCode: true },
              orderBy: [{ priority: 'asc' }, { id: 'asc' }],
            },
          },
        },
        nodes: {
          include: {
            nodeConditions: { include: { condition: true }, orderBy: { evaluationOrder: 'asc' } },
            nodeActions: { include: { action: true }, orderBy: { executionOrder: 'asc' } },
          },
          orderBy: [{ orderIndex: 'asc' }, { nodeKey: 'asc' }],
        },
        edges: {
          include: {
            fromNode: true,
            toNode: true,
            edgeConditions: { include: { condition: true }, orderBy: { evaluationOrder: 'asc' } },
          },
          orderBy: [{ priority: 'asc' }, { edgeKey: 'asc' }],
        },
      },
    });
    if (!version)
      throw new DomainException(
        'VERSION_NOT_FOUND',
        'Artifact version not found',
        HttpStatus.NOT_FOUND,
      );

    return {
      artifact: {
        id: version.artifact.id.toString(),
        tenantId: version.artifact.tenantId.toString(),
        code: version.artifact.artifactCode,
        type: version.artifact.artifactType,
        name: version.artifact.name,
        riskDomain: version.artifact.riskDomain,
      },
      version: {
        id: version.id.toString(),
        number: version.versionNumber,
        semanticVersion: version.semanticVersion,
        status: version.status,
        checksum: version.canonicalChecksum,
        authoringNotes: version.authoringNotes,
      },
      variables: version.variableDependencies.map((dependency) => ({
        variableVersionId: dependency.variableVersion.id.toString(),
        usageType: dependency.usageType,
        dependencyPath: dependency.dependencyPath,
        code: dependency.variableVersion.definition.variableCode,
        version: dependency.variableVersion.versionNumber,
        dataType: dependency.variableVersion.dataType,
        unitCode: dependency.variableVersion.unitCode,
        nullable: dependency.variableVersion.nullable,
        defaultValue: dependency.variableVersion.defaultValueJson,
        validationSchema: dependency.variableVersion.validationSchemaJson,
        constraints: dependency.variableVersion.constraintsJson,
        displayName: dependency.variableVersion.displayName,
        description: dependency.variableVersion.description,
        validationMessage: dependency.variableVersion.validationMessage,
        exampleValid: dependency.variableVersion.exampleValidJson,
        exampleInvalid: dependency.variableVersion.exampleInvalidJson,
        expectedOrigin: dependency.variableVersion.expectedOrigin,
        contractVersion: dependency.variableVersion.contractVersion,
        sensitivityClass: dependency.variableVersion.definition.sensitivityClass,
        validationRules: dependency.variableVersion.validationRules.map((rule) => ({
          ruleType: rule.ruleType,
          config: rule.ruleConfigJson,
          severity: rule.severity,
          errorCode: rule.errorCode,
        })),
        sources: dependency.variableVersion.sources.map((source) => ({
          system: source.sourceSystemCode,
          path: source.sourcePath,
          field: source.sourceField,
          precedence: source.precedence,
          freshnessSlaSeconds: source.freshnessSlaSeconds,
          authoritative: source.isAuthoritative,
        })),
        required: dependency.isRequired,
        fallbackPolicy: dependency.fallbackPolicy,
        sensitive: dependency.variableVersion.definition.isSensitive,
      })),
      intermediates: version.intermediateVariables.map((intermediate) => ({
        id: intermediate.id.toString(),
        code: intermediate.code,
        name: intermediate.name,
        description: intermediate.description,
        dataType: intermediate.dataType,
        producerNodeKey: intermediate.producerNodeKey,
        consumerNodeKeys: intermediate.consumerNodeKeys,
        initialValue: intermediate.initialValueJson ?? undefined,
        constraints: intermediate.constraintsJson,
        nullable: intermediate.nullable,
        updatePolicy: intermediate.updatePolicy,
        availabilityCondition: intermediate.availabilityConditionJson ?? undefined,
        sensitivityClass: intermediate.sensitivityClass,
        tracePolicy: intermediate.tracePolicy,
      })),
      outputContract: version.outputContractFields.map((field) => ({
        id: field.id.toString(),
        code: field.fieldCode,
        name: field.name,
        description: field.description,
        sourceKind: field.sourceKind,
        sourceRef: field.sourceRef,
        valueMapping: (field.valueMappingJson ?? null) as Record<string, unknown> | null,
        absenceReasons: field.absenceReasons,
        // Se devuelven los CÓDIGOS, que es como los manda el autor: el editor
        // vuelve a cargar exactamente lo que guardó, sin traducir ids.
        reasonCodes: field.reasonCodes.map((mapping) => mapping.reasonCode.reasonCode),
        example: field.exampleJson ?? undefined,
        contractVersion: field.contractVersion,
        sensitivityClass: field.sensitivityClass,
        tracePolicy: field.tracePolicy,
      })),
      conditions: version.conditions.map((condition) => ({
        id: condition.id.toString(),
        code: condition.conditionCode,
        name: condition.name,
        expressionType: condition.expressionType,
        expression: condition.expressionJson,
        severity: condition.severity,
        reusable: condition.isReusable,
      })),
      actions: version.actions.map((action) => ({
        id: action.id.toString(),
        code: action.actionCode,
        type: action.actionType,
        payload: action.payloadTemplateJson as Record<string, unknown>,
        terminal: action.isTerminal,
        reasonCodes: action.reasonMappings.map((mapping) => ({
          id: mapping.reasonCode.id.toString(),
          code: mapping.reasonCode.reasonCode,
          category: mapping.reasonCode.category,
          publicMessage: mapping.reasonCode.publicMessage,
          internalMessage: mapping.reasonCode.internalMessage,
          severity: mapping.reasonCode.severity,
          adverseAction: mapping.reasonCode.isAdverseAction,
          priority: mapping.priority,
        })),
      })),
      nodes: version.nodes.map((node) => ({
        id: node.id.toString(),
        // Las llamadas a campos calculados se reconstruyen desde el registro, no desde
        // el `config` del nodo: allí está la definición congelada que el motor ejecuta.
        calculatedFieldCalls: version.calculatedFieldUses
          .filter((use) => use.nodeKey === node.nodeKey)
          .map((use) => ({
            callKey: use.callKey,
            fieldCode: use.calculatedFieldVersion.calculatedField.fieldCode,
            calculatedFieldVersionId: use.calculatedFieldVersionId.toString(),
            versionNumber: use.calculatedFieldVersion.versionNumber,
            inputMapping: use.inputMappingJson as CalculatedFieldCallSnapshot['inputMapping'],
            target: {
              kind: use.targetKind as 'INTERMEDIATE' | 'OUTPUT',
              code: use.targetCode,
            },
            definition: use.definitionJson as unknown as CalculatedFieldCallSnapshot['definition'],
          })),
        key: node.nodeKey,
        type: node.nodeType as ArtifactGraphSnapshot['nodes'][number]['type'],
        label: node.label,
        config: node.configJson as Record<string, unknown>,
        x: node.xPos,
        y: node.yPos,
        order: node.orderIndex,
        terminal: node.isTerminal,
        conditions: node.nodeConditions.map((binding) => ({
          code: binding.condition.conditionCode,
          order: binding.evaluationOrder,
          expected: binding.expectedBoolean,
        })),
        actions: node.nodeActions.map((binding) => ({
          code: binding.action.actionCode,
          order: binding.executionOrder,
        })),
      })),
      edges: version.edges.map((edge) => ({
        id: edge.id.toString(),
        key: edge.edgeKey,
        from: edge.fromNode.nodeKey,
        to: edge.toNode.nodeKey,
        type: edge.edgeType,
        priority: edge.priority,
        default: edge.isDefault,
        conditions: edge.edgeConditions.map((binding) => ({
          code: binding.condition.conditionCode,
          order: binding.evaluationOrder,
        })),
      })),
    };
  }
}
