import { Injectable } from '@nestjs/common';
import { BoliviaCiDocumentParser } from './bolivia-ci-document.parser';
import {
  GenericDocumentParser,
  PassportDocumentParser,
  type DocumentParser,
  type DocumentParserContext,
} from './document-parser';

/**
 * Elige analizador por (tipo, país). Absorbido sin cambios.
 *
 * El genérico va el último y soporta todo: es el que evita que un documento no
 * reconocido reviente en vez de terminar en revisión manual con un aviso.
 */
@Injectable()
export class DocumentParserRegistry {
  private readonly parsers: DocumentParser[];

  constructor(
    bolivia: BoliviaCiDocumentParser,
    passport: PassportDocumentParser,
    generic: GenericDocumentParser,
  ) {
    this.parsers = [bolivia, passport, generic];
  }

  resolve(context: DocumentParserContext): DocumentParser {
    return (
      this.parsers.find((parser) => parser.supports(context)) ??
      this.parsers[this.parsers.length - 1]
    );
  }
}
