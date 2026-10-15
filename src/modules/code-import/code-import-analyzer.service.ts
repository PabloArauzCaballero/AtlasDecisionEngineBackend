import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain-exception';
import { BranchExtractorService } from './branch-extractor.service';
import { CodeImportCatalogService } from './code-import-catalog.service';
import { CodeImportSourceInspector } from './code-import-source-inspector.service';
import { AnalyzeCodeImportDto } from './code-import.dto';
import { GraphGeneratorService } from './graph-generator.service';
import type { CodeImportIR, GeneratedGraphPreview, LineIssue } from './code-import.types';

/** El resultado del análisis, antes de guardarlo como importación. */
export interface CodeImportAnalysis {
  ir: CodeImportIR;
  issues: LineIssue[];
  generatedGraph: GeneratedGraphPreview;
  hasBlockingIssues: boolean;
}

/**
 * Del código al grafo de vista previa: valida tamaño, inspecciona el fuente,
 * arma el IR, deriva el árbol de decisión y comprueba las dependencias contra
 * el catálogo del tenant. No escribe nada.
 */
@Injectable()
export class CodeImportAnalyzer {
  constructor(
    private readonly config: ConfigService,
    private readonly inspector: CodeImportSourceInspector,
    private readonly branches: BranchExtractorService,
    private readonly graphGenerator: GraphGeneratorService,
    private readonly catalog: CodeImportCatalogService,
  ) {}

  async analyze(tenantId: bigint, dto: AnalyzeCodeImportDto): Promise<CodeImportAnalysis> {
    const maxBytes = this.config.get<number>('CODE_IMPORT_MAX_SOURCE_BYTES') ?? 131_072;
    const sourceBytes = Buffer.byteLength(dto.sourceCode, 'utf8');
    if (sourceBytes > maxBytes) {
      throw new DomainException(
        'CODE_IMPORT_SOURCE_TOO_LARGE',
        `Source exceeds ${maxBytes} bytes`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const { issues, contract, scriptBody } = this.inspector.inspect(dto.language, dto.sourceCode);

    const hasBlockingIssues = issues.some((issue) => issue.severity === 'ERROR');
    const ir: CodeImportIR = {
      irVersion: '1',
      language: dto.language,
      sourceChecksum: createHash('sha256').update(dto.sourceCode).digest('hex'),
      contract: contract ?? { contractVersion: '1', inputs: [], outputs: [] },
      scriptBody,
    };
    // Se intenta derivar el árbol de decisión del código; si no es traducible se
    // avisa con el motivo exacto y se cae al nodo de script (nunca a medias).
    if (contract && !hasBlockingIssues) {
      const derived = this.branches.extract(dto.language, scriptBody, contract);
      ir.branches = derived.branches;
      if (derived.unsupported) issues.push(derived.unsupported);
    }
    const generatedGraph = hasBlockingIssues
      ? { dependencies: [], nodes: [], edges: [] }
      : this.graphGenerator.generate(ir, await this.catalog.reasonCodeCatalog(tenantId));
    // El catálogo se comprueba DESPUÉS de generar el grafo, y sus errores no
    // entran en `hasBlockingIssues`: una variable sin declarar tiene que poder
    // verse en la vista previa, porque para declararla bien hay que saber qué
    // pide el algoritmo. Lo que sí impide es escribirla en un artefacto:
    // `writeToArtifact` rechaza cualquier import con errores guardados.
    issues.push(...(await this.catalog.catalogIssues(tenantId, generatedGraph.dependencies)));

    return { ir, issues, generatedGraph, hasBlockingIssues };
  }
}
