import { Injectable } from '@nestjs/common';
import { ContractExtractorService } from './contract-extractor.service';
import { ContractValidatorService } from './contract-validator.service';
import { SecurityAnalyzerService } from './security-analyzer.service';
import { SyntaxAnalyzerService } from './syntax-analyzer.service';
import type { ImportLanguage, LineIssue, MetadataContract } from './code-import.types';

/** Lo que dice el código fuente por sí solo: su contrato, su cuerpo y lo que le falta. */
export interface SourceInspection {
  issues: LineIssue[];
  contract: MetadataContract | undefined;
  scriptBody: string;
}

/**
 * Análisis estático del código importado: sintaxis, extracción del contrato,
 * seguridad y validación del contrato contra el cuerpo del script. Junta los
 * hallazgos de las cuatro lecturas en el orden en que se ven en la vista previa.
 */
@Injectable()
export class CodeImportSourceInspector {
  constructor(
    private readonly syntax: SyntaxAnalyzerService,
    private readonly contractExtractor: ContractExtractorService,
    private readonly contractValidator: ContractValidatorService,
    private readonly security: SecurityAnalyzerService,
  ) {}

  inspect(language: ImportLanguage, sourceCode: string): SourceInspection {
    const issues: LineIssue[] = [];
    issues.push(...this.syntax.analyze(language, sourceCode));

    const extraction = this.contractExtractor.extract(language, sourceCode);
    issues.push(...extraction.issues);

    issues.push(...this.security.analyze(language, extraction.scriptBody));

    const contract = extraction.contract;
    if (contract) {
      issues.push(...this.contractValidator.validate(contract, language, extraction.scriptBody));
    }
    return { issues, contract, scriptBody: extraction.scriptBody };
  }
}
