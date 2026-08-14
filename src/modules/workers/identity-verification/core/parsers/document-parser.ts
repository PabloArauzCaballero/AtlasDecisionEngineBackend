import { Injectable } from '@nestjs/common';
import { IdentityDocumentType } from '../domain/identity-enums';
import type { ExtractedIdentityData } from '../domain/extracted-identity.types';
import type { DocumentOcrResult } from '../ports/identity.ports';

/**
 * Contrato de un analizador de documento y los dos casos generales.
 *
 * Absorbido del paquete original. El registro elige el primero que dice
 * soportar el par (tipo, país) y cae en el genérico, que soporta todo: sin ese
 * último eslabón, un documento no reconocido reventaría en vez de terminar en
 * revisión manual con un aviso, que es lo que se quiere.
 */

export interface DocumentParserContext {
  type: IdentityDocumentType;
  country: string;
}
export interface DocumentParserInput {
  ocr: DocumentOcrResult;
  context: DocumentParserContext;
}
export interface ParsedDocument {
  fields: ExtractedIdentityData;
  warnings: string[];
}

export interface DocumentParser {
  supports(context: DocumentParserContext): boolean;
  parse(input: DocumentParserInput): Promise<ParsedDocument>;
  /**
   * Anclajes que deben coincidir entre las dos caras de un mismo documento
   * físico. Opcional: sólo lo implementan los analizadores de tarjetas de dos
   * caras. Sirve para detectar un anverso y un reverso fotografiados de
   * documentos distintos.
   */
  crossCheckAnchors?(ocr: Pick<DocumentOcrResult, 'rawText' | 'lines'>): {
    documentNumber: string | null;
  };
}

@Injectable()
export class GenericDocumentParser implements DocumentParser {
  supports(): boolean {
    return true;
  }
  async parse(input: DocumentParserInput): Promise<ParsedDocument> {
    return {
      fields: {
        documentType: { value: input.context.type, confidence: null, source: 'DERIVED' },
        country: { value: input.context.country, confidence: 1, source: 'DERIVED' },
      },
      warnings: ['GENERIC_PARSER_USED'],
    };
  }
}

@Injectable()
export class PassportDocumentParser implements DocumentParser {
  supports(context: DocumentParserContext): boolean {
    return context.type === IdentityDocumentType.PASSPORT;
  }
  async parse(input: DocumentParserInput): Promise<ParsedDocument> {
    const mrz = input.ocr.rawText.split(/\n/).filter((line) => /^P</.test(line.replace(/\s/g, '')));
    return {
      fields: {
        documentType: {
          value: 'PASSPORT',
          confidence: mrz.length ? 0.95 : 0.6,
          source: mrz.length ? 'MRZ' : 'OCR',
        },
      },
      warnings: mrz.length ? [] : ['MRZ_NOT_FOUND'],
    };
  }
}
