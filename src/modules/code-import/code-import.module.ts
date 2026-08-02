/** Composes the static-analysis pipeline and reuses artifact/variable domain services. */
import { Module } from '@nestjs/common';
import { ArtifactModule } from '../artifacts/artifact.module';
import { VariableModule } from '../variables/variable.module';
import { CodeImportController } from './code-import.controller';
import { CodeImportService } from './code-import.service';
import { ContractExtractorService } from './contract-extractor.service';
import { ContractValidatorService } from './contract-validator.service';
import { BranchExtractorService } from './branch-extractor.service';
import { GraphGeneratorService } from './graph-generator.service';
import { SecurityAnalyzerService } from './security-analyzer.service';
import { SyntaxAnalyzerService } from './syntax-analyzer.service';

@Module({
  imports: [ArtifactModule, VariableModule],
  controllers: [CodeImportController],
  providers: [
    CodeImportService,
    SyntaxAnalyzerService,
    BranchExtractorService,
    ContractExtractorService,
    ContractValidatorService,
    SecurityAnalyzerService,
    GraphGeneratorService,
  ],
  exports: [CodeImportService],
})
export class CodeImportModule {}
