import type { ImportLanguage } from '../code-import.types';
import { readJavaScript } from './javascript';
import { readLines } from './lines';
import { readPython } from './python';
import { ReadStatement } from './types';

export function readStatements(source: string, language: ImportLanguage): ReadStatement[] {
  return language === 'PYTHON'
    ? readPython(readLines(source), 0).statements
    : readJavaScript(source);
}

// --------------------------------------------------------------------------
// Python: bloques por indentación.
// --------------------------------------------------------------------------
