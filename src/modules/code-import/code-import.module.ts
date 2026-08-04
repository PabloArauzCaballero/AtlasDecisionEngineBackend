/**
 * Compone el pipeline de análisis estático y reutiliza los servicios de artefacto.
 *
 * Ya no importa `VariableModule`: desde que una importación no puede crear
 * variables (sólo usar las que el catálogo ya declara), este módulo no escribe
 * nada en el catálogo — sólo lo lee por Prisma para comprobar el contrato.
 */
import { Module } from '@nestjs/common';
import { ArtifactModule } from '../artifacts/artifact.module';
import { CodeImportController } from './code-import.controller';
import { CodeImportService } from './code-import.service';
import { ContractExtractorService } from './contract-extractor.service';
import { ContractValidatorService } from './contract-validator.service';
import { BranchExtractorService } from './branch-extractor.service';
import { GraphGeneratorService } from './graph-generator.service';
import { SecurityAnalyzerService } from './security-analyzer.service';
import { SyntaxAnalyzerService } from './syntax-analyzer.service';

@Module({
  imports: [ArtifactModule],
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
