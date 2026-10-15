import { HttpStatus, Injectable } from '@nestjs/common';
import { normalizeDataTypeOrString } from '../../common/contracts/data-types';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { GeneratedGraphPreview, LineIssue } from './code-import.types';

/**
 * Lo que una importación de código necesita saber del catálogo del tenant:
 * qué motivos de negocio existen y qué variables están declaradas. Sólo lee;
 * una importación nunca estrena catálogo.
 */
@Injectable()
export class CodeImportCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Códigos de motivo activos del tenant.
   *
   * Sirven para reconocer, entre los literales que escribe el código importado,
   * cuáles son motivos de negocio ya declarados. Sin esto un `"AGE_NOT_ELIGIBLE"`
   * entra al grafo como una cadena suelta: la decisión no se puede filtrar por
   * motivo, ni explicar al cliente, ni auditar.
   */
  async reasonCodeCatalog(tenantId: bigint): Promise<ReadonlySet<string>> {
    const rows = await this.prisma.decisionReasonCode.findMany({
      where: { tenantId, isActive: true },
      select: { reasonCode: true },
    });
    return new Set(rows.map((row) => row.reasonCode));
  }

  /** Ids de los motivos que las acciones generadas van a emitir. */
  async reasonCodeIds(tenantId: bigint, codes: string[]): Promise<Map<string, bigint>> {
    if (!codes.length) return new Map();
    const rows = await this.prisma.decisionReasonCode.findMany({
      where: { tenantId, isActive: true, reasonCode: { in: codes } },
      select: { id: true, reasonCode: true },
    });
    const byCode = new Map(rows.map((row) => [row.reasonCode, row.id]));
    const missing = codes.filter((code) => !byCode.has(code));
    if (missing.length) {
      // No debería ocurrir (la generación sólo usa códigos del catálogo), pero si
      // alguien desactiva un motivo entre analizar y guardar, mejor decirlo claro
      // que escribir un grafo con una acción rota.
      throw new DomainException(
        'CODE_IMPORT_REASON_CODE_MISSING',
        `These reason codes no longer exist in the catalog: ${missing.join(', ')}`,
        HttpStatus.CONFLICT,
        { missing },
      );
    }
    return byCode;
  }

  /**
   * Contraste del contrato contra el catálogo de variables del tenant.
   *
   * Un artefacto sólo puede usar variables ya declaradas; una importación de
   * código tenía la puerta abierta: la variable que el contrato mencionaba y no
   * existía se creaba sola al guardar, con nombre igual al código, sin dueño real
   * y sin restricciones. El catálogo se llenaba de variables que nadie gobierna
   * justo por la vía que menos revisión tiene.
   */
  async catalogIssues(
    tenantId: bigint,
    dependencies: GeneratedGraphPreview['dependencies'],
  ): Promise<LineIssue[]> {
    if (!dependencies.length) return [];
    const known = await this.variableVersions(
      tenantId,
      dependencies.map((dependency) => dependency.variableCode),
    );
    const issues: LineIssue[] = [];
    for (const dependency of dependencies) {
      const role = dependency.usageType === 'INPUT' ? 'Input' : 'Output';
      const existing = known.get(dependency.variableCode);
      if (!existing) {
        issues.push({
          source: 'CONTRACT',
          severity: 'ERROR',
          line: 1,
          code: 'CODE_IMPORT_VARIABLE_NOT_IN_CATALOG',
          message: `${role} "${dependency.variableCode}" is not declared in the variable catalog; declare it there before importing this code`,
        });
        continue;
      }
      const declared = normalizeDataTypeOrString(dependency.dataType);
      const catalog = normalizeDataTypeOrString(existing.dataType);
      if (declared !== catalog) {
        issues.push({
          source: 'CONTRACT',
          severity: 'ERROR',
          line: 1,
          code: 'CODE_IMPORT_VARIABLE_TYPE_MISMATCH',
          message: `${role} "${dependency.variableCode}" is declared as ${declared} but the catalog registers it as ${catalog}`,
        });
      }
    }
    return issues;
  }

  /**
   * Versiones de variable que usará el grafo. Nunca se crean: si el catálogo no
   * las tiene, se rechaza la escritura con la lista completa de las que faltan.
   *
   * El análisis ya lo avisa como error (ver {@link catalogIssues}) y por eso este
   * camino no debería alcanzarse; queda como red por si alguien retira una
   * variable entre analizar y guardar.
   */
  async resolveVariableVersions(
    tenantId: bigint,
    dependencies: GeneratedGraphPreview['dependencies'],
  ): Promise<Map<string, bigint>> {
    const known = await this.variableVersions(
      tenantId,
      dependencies.map((dependency) => dependency.variableCode),
    );
    const missing = dependencies
      .map((dependency) => dependency.variableCode)
      .filter((code) => !known.has(code));
    if (missing.length) {
      throw new DomainException(
        'CODE_IMPORT_VARIABLE_NOT_IN_CATALOG',
        `These variables are not declared in the catalog: ${missing.join(', ')}`,
        HttpStatus.CONFLICT,
        { missing },
      );
    }
    return new Map([...known].map(([code, version]) => [code, version.id]));
  }

  /** Última versión de cada variable pedida, por código. */
  private async variableVersions(
    tenantId: bigint,
    codes: string[],
  ): Promise<Map<string, { id: bigint; dataType: string }>> {
    const definitions = await this.prisma.decisionVariableDefinition.findMany({
      where: { tenantId, variableCode: { in: codes } },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });
    const byCode = new Map<string, { id: bigint; dataType: string }>();
    for (const definition of definitions) {
      const latest = definition.versions[0];
      if (latest) byCode.set(definition.variableCode, { id: latest.id, dataType: latest.dataType });
    }
    return byCode;
  }
}
