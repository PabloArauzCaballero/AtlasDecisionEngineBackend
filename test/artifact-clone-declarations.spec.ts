import { ConfigService } from '@nestjs/config';
import { ArtifactService } from '../src/modules/artifacts/artifact.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';

/**
 * «Nueva versión» tiene que copiar TODO lo que la versión declara, no sólo el grafo.
 *
 * La clonación copiaba nodos, condiciones, acciones y aristas y se dejaba las variables intermedias,
 * el contrato de salida, los scripts de nodo, los campos calculados y la declaración del
 * tratamiento. El borrador de PARTNER_KYB_REVIEW (v12) salió con 18 errores
 * `UNDECLARED_INTERMEDIATE_REFERENCE` y no se podía compilar: la única vía de cambiar una política
 * aprobada producía siempre una versión inservible.
 */
describe('ArtifactService.cloneVersion copia lo que la versión declara', () => {
  const principal = {
    id: 'ana',
    requestId: 'r-1',
    roles: ['PLATFORM_ADMIN'],
  } as unknown as AuthenticatedPrincipal;
  const stamp = { id: 1n, createdAt: new Date(), updatedAt: new Date(), artifactVersionId: 10n };

  function make() {
    const createMany: Record<string, any[]> = {};
    const record = (name: string) => async (args: any) => {
      createMany[name] = args.data;
      return { count: args.data.length };
    };
    let versionData: any;
    const tx: any = {
      decisionArtifactVersion: {
        create: async (args: any) => {
          versionData = args.data;
          return { id: 99n, versionNumber: 13 };
        },
      },
      decisionArtifactVariableDependency: { createMany: record('dependencias') },
      decisionRuleCondition: { create: async () => ({ id: 5n }) },
      decisionRuleAction: { create: async () => ({ id: 6n }) },
      decisionRuleNode: { create: async () => ({ id: 7n }) },
      decisionNodeCondition: { createMany: record('nodeConditions') },
      decisionNodeAction: { createMany: record('nodeActions') },
      decisionRuleEdge: { create: async () => ({ id: 8n }) },
      decisionEdgeCondition: { createMany: record('edgeConditions') },
      decisionIntermediateVariable: { createMany: record('intermedias') },
      decisionOutputContractField: { createMany: record('contrato') },
      decisionNodeScript: { createMany: record('scripts') },
      decisionArtifactCalculatedFieldUse: { createMany: record('calculados') },
    };
    const source = {
      id: 12n,
      artifactId: 1n,
      versionNumber: 12,
      semanticVersion: '1.1.0',
      processingPurpose: 'Verificar el expediente del comercio',
      legalBasis: 'LEGAL_OBLIGATION',
      subjectReferencePolicy: 'REQUIRED',
      subjectPolicyJustification: null,
      enablingBasisPolicy: null,
      artifact: { versions: [{ versionNumber: 12 }] },
      variableDependencies: [],
      conditions: [],
      actions: [],
      nodes: [],
      edges: [],
      intermediateVariables: [
        {
          ...stamp,
          tenantId: 1n,
          code: 'requisitos_faltantes',
          name: 'n',
          description: 'd',
          dataType: 'INTEGER',
          producerNodeKey: 'CONTAR',
          consumerNodeKeys: ['EVALUAR'],
          initialValueJson: null,
          constraintsJson: null,
          nullable: true,
          updatePolicy: 'SINGLE_WRITE',
          availabilityConditionJson: null,
          sensitivityClass: 'INTERNAL',
          tracePolicy: 'FULL',
        },
      ],
      outputContractFields: [
        {
          ...stamp,
          tenantId: 1n,
          fieldCode: 'kyb_decision',
          name: 'n',
          description: null,
          sourceKind: 'NODE',
          sourceRef: 'APROBAR',
          semanticRole: 'NONE',
          policyMinValue: null,
          policyMaxValue: null,
          valueMappingJson: null,
          absenceReasons: [],
          exampleJson: null,
          contractVersion: '1',
          sensitivityClass: 'INTERNAL',
          tracePolicy: 'FULL',
        },
      ],
      nodeScripts: [
        {
          ...stamp,
          tenantId: 1n,
          nodeKey: 'S',
          language: 'js',
          sourceCode: 'x',
          sourceChecksum: 'c',
          inputVariablesJson: [],
          outputVariablesJson: [],
          createdBy: 'ana',
        },
      ],
      calculatedFieldUses: [
        {
          ...stamp,
          tenantId: 1n,
          nodeKey: 'N',
          callKey: 'k',
          calculatedFieldVersionId: 3n,
          inputMappingJson: {},
          targetKind: 'INTERMEDIATE',
          targetCode: 't',
          definitionJson: {},
        },
      ],
    };
    const prisma: any = {
      decisionArtifactVersion: { findFirst: async () => source },
      $transaction: async (cb: (t: unknown) => unknown) => cb(tx),
    };
    const service = new ArtifactService(
      prisma,
      { append: async () => ({}) } as any,
      new ConfigService({}),
    );
    return { service, createMany, version: () => versionData };
  }

  it('copia intermedias, contrato de salida, scripts y campos calculados a la versión nueva', async () => {
    const { service, createMany } = make();
    await service.cloneVersion(1n, 12n, {} as any, principal);

    expect(createMany.intermedias).toHaveLength(1);
    expect(createMany.intermedias[0]).toMatchObject({
      code: 'requisitos_faltantes',
      producerNodeKey: 'CONTAR',
      artifactVersionId: 99n,
    });
    expect(createMany.contrato[0]).toMatchObject({
      fieldCode: 'kyb_decision',
      artifactVersionId: 99n,
    });
    expect(createMany.scripts[0]).toMatchObject({ nodeKey: 'S', artifactVersionId: 99n });
    expect(createMany.calculados[0]).toMatchObject({
      callKey: 'k',
      calculatedFieldVersionId: 3n,
      artifactVersionId: 99n,
    });
  });

  it('no arrastra ids ni marcas de tiempo de la fila de origen', async () => {
    const { service, createMany } = make();
    await service.cloneVersion(1n, 12n, {} as any, principal);

    for (const filas of [
      createMany.intermedias,
      createMany.contrato,
      createMany.scripts,
      createMany.calculados,
    ]) {
      expect(filas[0]).not.toHaveProperty('id');
      expect(filas[0]).not.toHaveProperty('createdAt');
    }
  });

  it('el borrador conserva la finalidad, la base legal y la política de sujeto de la versión de origen', async () => {
    const { service, version } = make();
    await service.cloneVersion(1n, 12n, {} as any, principal);

    expect(version()).toMatchObject({
      processingPurpose: 'Verificar el expediente del comercio',
      legalBasis: 'LEGAL_OBLIGATION',
      subjectReferencePolicy: 'REQUIRED',
    });
  });
});
