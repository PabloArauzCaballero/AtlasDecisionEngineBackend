import { Injectable } from '@nestjs/common';
import { EntityAlias } from '../domain/semantic-analysis.types';

interface FoldedText {
  /** Texto plegado a minúsculas y sin diacríticos, usado sólo para localizar alias. */
  readonly value: string;
  /** Mapa `índice plegado -> índice original`, con longitud `value.length + 1`. */
  readonly offsets: readonly number[];
}

interface AliasMatch {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

const WORD_CHARACTER = /[\p{Letter}\p{Number}_]/u;
const DIACRITIC = /\p{Diacritic}/gu;
const REGEXP_METACHARACTER = /[.*+?^${}()|[\]\\]/gu;

@Injectable()
export class TextNormalizer {
  /**
   * Estandariza espacios, caracteres Unicode y alias configurados.
   *
   * La sustitución de alias es insensible a mayúsculas y a diacríticos, respeta límites de palabra
   * Unicode y se aplica en una sola pasada: un fragmento ya sustituido no vuelve a compararse, de
   * modo que los alias no se encadenan entre sí.
   *
   * @param text - Texto original.
   * @param aliases - Alias activos administrados como datos.
   * @returns Texto normalizado sin alterar el significado intencional.
   */
  public normalize(text: string, aliases: readonly EntityAlias[]): string {
    const compactText = this.compact(text);
    if (aliases.length === 0 || compactText.length === 0) {
      return compactText;
    }
    return this.applyAliases(compactText, aliases);
  }

  private compact(text: string): string {
    return text
      .normalize('NFKC')
      .replace(/./gu, (character) => (this.isDisallowedCharacter(character) ? ' ' : character))
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private applyAliases(text: string, aliases: readonly EntityAlias[]): string {
    const folded = this.fold(text);
    const claimed: AliasMatch[] = [];
    const orderedAliases = [...aliases].sort(
      (left, right) => right.alias.length - left.alias.length,
    );

    for (const entityAlias of orderedAliases) {
      const foldedAlias = this.fold(entityAlias.alias).value.trim();
      if (foldedAlias.length === 0) {
        continue;
      }
      const pattern = this.createAliasPattern(foldedAlias);
      for (const match of folded.value.matchAll(pattern)) {
        const start = folded.offsets[match.index];
        const end = folded.offsets[match.index + match[0].length];
        if (start === undefined || end === undefined || this.overlaps(claimed, start, end)) {
          continue;
        }
        claimed.push({ start, end, replacement: entityAlias.canonicalName });
      }
    }

    return this.rebuild(text, claimed);
  }

  /**
   * Construye una vista comparable del texto conservando la posición de cada carácter original.
   */
  private fold(text: string): FoldedText {
    let value = '';
    const offsets: number[] = [];
    let originalIndex = 0;

    for (const codePoint of text) {
      const stripped = codePoint.normalize('NFD').replace(DIACRITIC, '');
      const comparable = (stripped.length === 0 ? codePoint : stripped).toLocaleLowerCase();
      for (let position = 0; position < comparable.length; position += 1) {
        offsets.push(originalIndex);
      }
      value += comparable;
      originalIndex += codePoint.length;
    }
    offsets.push(originalIndex);

    return { value, offsets };
  }

  /**
   * Aplica límites de palabra Unicode sólo cuando el extremo del alias es un carácter de palabra,
   * de modo que alias como `A+B` sigan localizándose.
   */
  private createAliasPattern(foldedAlias: string): RegExp {
    const characters = [...foldedAlias];
    const first = characters[0] ?? '';
    const last = characters[characters.length - 1] ?? '';
    const prefix = WORD_CHARACTER.test(first) ? '(?<![\\p{Letter}\\p{Number}_])' : '';
    const suffix = WORD_CHARACTER.test(last) ? '(?![\\p{Letter}\\p{Number}_])' : '';
    const escaped = foldedAlias.replace(REGEXP_METACHARACTER, '\\$&');
    return new RegExp(`${prefix}${escaped}${suffix}`, 'gu');
  }

  private overlaps(claimed: readonly AliasMatch[], start: number, end: number): boolean {
    return claimed.some((match) => start < match.end && end > match.start);
  }

  private rebuild(text: string, claimed: readonly AliasMatch[]): string {
    if (claimed.length === 0) {
      return text;
    }
    const ordered = [...claimed].sort((left, right) => left.start - right.start);
    let rebuilt = '';
    let cursor = 0;
    for (const match of ordered) {
      rebuilt += text.slice(cursor, match.start) + match.replacement;
      cursor = match.end;
    }
    return rebuilt + text.slice(cursor);
  }

  /**
   * Neutraliza controles C0/C1 y caracteres invisibles usados para ocultar instrucciones.
   */
  private isDisallowedCharacter(character: string): boolean {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      return false;
    }
    return (
      (codePoint >= 0x00 && codePoint <= 0x08) ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x0e && codePoint <= 0x1f) ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x00ad ||
      (codePoint >= 0x200b && codePoint <= 0x200f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2060 && codePoint <= 0x2064) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069) ||
      codePoint === 0xfeff ||
      (codePoint >= 0xe0000 && codePoint <= 0xe007f)
    );
  }
}
