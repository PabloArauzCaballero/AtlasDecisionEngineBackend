import { Injectable } from '@nestjs/common';
import type { ImportLanguage, LineIssue, MetadataContract } from './code-import.types';

export interface ContractExtractionResult {
  contract?: MetadataContract;
  /** Source with the contract header comment block removed, ready to store as the
   *  generated RESULT node's script body. */
  scriptBody: string;
  issues: LineIssue[];
}

/**
 * Extracts the versioned metadata contract from an `@atlas-contract` marker comment
 * at the top of the file, e.g. (JavaScript):
 *
 *   // @atlas-contract
 *   // { "contractVersion": "1",
 *   //   "inputs": [{ "id": "age", "name": "Age", "type": "INTEGER", "required": true }],
 *   //   "outputs": [{ "id": "riskLevel", "name": "Risk Level", "type": "STRING", "required": true }] }
 *   return { riskLevel: variables.age >= 21 ? 'LOW' : 'HIGH' };
 *
 * `variables`/`decision`/`output` are exactly the sandbox globals
 * script-node-runner.service.ts already injects for SCRIPT-mode RESULT nodes — an
 * imported script reads its declared inputs from `variables` and returns (JS) or
 * assigns `result` (Python) with its declared outputs, with no new runtime surface.
 *
 * Python uses `#` comments the same way. This is an explicit declaration rather than
 * inference from the code body: inferring input/output types reliably from arbitrary
 * dynamically-typed JS/Python is not tractable without a full type-flow analysis, so
 * the contract is the authored source of truth — the same trade-off most low-code
 * platforms with a code-import path make. See docs/code-to-flow-specification.md.
 */
@Injectable()
export class ContractExtractorService {
  extract(language: ImportLanguage, source: string): ContractExtractionResult {
    const commentPrefix = language === 'PYTHON' ? '#' : '//';
    const lines = source.split('\n');
    const markerIndex = lines.findIndex(
      (line) => line.trim() === `${commentPrefix} @atlas-contract`,
    );
    if (markerIndex === -1) {
      return {
        scriptBody: source,
        issues: [
          {
            source: 'CONTRACT',
            severity: 'ERROR',
            line: 1,
            message: `Missing "${commentPrefix} @atlas-contract" header — the metadata contract (inputs/outputs) must be declared before the code body`,
            code: 'CONTRACT_MARKER_MISSING',
          },
        ],
      };
    }

    let blockEnd = markerIndex + 1;
    const jsonLines: string[] = [];
    while (blockEnd < lines.length && lines[blockEnd].trimStart().startsWith(commentPrefix)) {
      jsonLines.push(lines[blockEnd].trimStart().slice(commentPrefix.length));
      blockEnd += 1;
    }
    const scriptBody = [...lines.slice(0, markerIndex), ...lines.slice(blockEnd)].join('\n');

    if (!jsonLines.length) {
      return {
        scriptBody,
        issues: [
          {
            source: 'CONTRACT',
            severity: 'ERROR',
            line: markerIndex + 1,
            message: 'The @atlas-contract header has no JSON body on the following comment lines',
            code: 'CONTRACT_BODY_EMPTY',
          },
        ],
      };
    }

    try {
      const parsed = JSON.parse(jsonLines.join('\n')) as Partial<MetadataContract>;
      const contract: MetadataContract = {
        contractVersion: String(parsed.contractVersion ?? '1'),
        inputs: Array.isArray(parsed.inputs) ? parsed.inputs : [],
        outputs: Array.isArray(parsed.outputs) ? parsed.outputs : [],
        primaryOutputId: parsed.primaryOutputId,
        // Sin copiarlo, declarar `reasonOutputId` no servía de nada: el generador
        // lo lee (graph-generator.service.ts) para saber QUÉ salida lleva el
        // motivo, y al llegarle vacío caía a buscar coincidencias en cualquier
        // salida de texto — más laxo justo cuando el autor fue explícito.
        reasonOutputId: parsed.reasonOutputId,
      };
      return { contract, scriptBody, issues: [] };
    } catch (error) {
      return {
        scriptBody,
        issues: [
          {
            source: 'CONTRACT',
            severity: 'ERROR',
            line: markerIndex + 2,
            message: `The @atlas-contract JSON body is invalid: ${error instanceof Error ? error.message : String(error)}`,
            code: 'CONTRACT_JSON_INVALID',
          },
        ],
      };
    }
  }
}
