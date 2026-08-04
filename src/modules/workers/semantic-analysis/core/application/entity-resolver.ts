import { Injectable } from '@nestjs/common';
import { EntityAlias, ResolvedEntity } from '../domain/semantic-analysis.types';

/**
 * Importe con separadores de miles opcionales y hasta dos decimales.
 * La alternancia prioriza la forma agrupada para no truncar `1.500,00` en `1.50`.
 *
 * El signo se admite en las dos posiciones en que los extractos bolivianos lo
 * imprimen: pegado a la moneda (`-Bs. 8.232,55`) o entre la moneda y la cifra
 * (`Bs. -8.232,55`, `Bs.-8.232,55`). En la primera posición **no** se tolera
 * espacio: `Transferencia - Bs. 500` usa el guion como separador de texto, no
 * como signo, y aceptarlo convertiría un abono en un cargo.
 *
 * Los paréntesis contables se dejan fuera a propósito: en los extractos reales
 * verificados delimitan el importe sin indicar su signo —conviven
 * `(Bs. -8.232,55)` y `(Bs. 7.686,00)` en el mismo resumen—, de modo que leerlos
 * como negativo corrompería los abonos.
 */
const AMOUNT_PATTERN =
  /(?<leadingSign>[-+])?(?<currency>Bs\.?|BOB|US\$|USD|EUR|\$|€)\s?(?<trailingSign>[-+])?(?<value>\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\p{Number}])/giu;

const ISO_DATE_PATTERN = /(?<![\p{Number}-])(\d{4})-(\d{2})-(\d{2})(?![\p{Number}-])/gu;

const CURRENCY_CODES: ReadonlyMap<string, string> = new Map([
  ['bs', 'BOB'],
  ['bs.', 'BOB'],
  ['bob', 'BOB'],
  ['usd', 'USD'],
  ['us$', 'USD'],
  ['$', 'USD'],
  ['eur', 'EUR'],
  ['€', 'EUR'],
]);

@Injectable()
export class EntityResolver {
  /**
   * Resuelve entidades conocidas y valores estructurados sin inferir identidades no configuradas.
   *
   * @param text - Texto ya normalizado, donde los alias fueron sustituidos por su nombre canónico.
   * @param aliases - Alias activos administrados como datos.
   */
  public resolve(text: string, aliases: readonly EntityAlias[]): readonly ResolvedEntity[] {
    const configuredEntities = aliases.flatMap((entityAlias) => {
      const occurrence = this.findOccurrence(text, entityAlias.canonicalName);
      return occurrence === undefined
        ? []
        : [
            {
              type: entityAlias.entityType,
              canonicalName: entityAlias.canonicalName,
              sourceText: occurrence,
              confidence: 1,
            },
          ];
    });

    return this.removeDuplicates([
      ...configuredEntities,
      ...this.resolveAmounts(text),
      ...this.resolveIsoDates(text),
    ]);
  }

  /**
   * Devuelve el fragmento real del texto que corresponde al valor buscado, no el alias original.
   */
  private findOccurrence(text: string, expectedValue: string): string | undefined {
    if (expectedValue.length === 0) {
      return undefined;
    }
    const position = text.toLocaleLowerCase().indexOf(expectedValue.toLocaleLowerCase());
    return position === -1 ? undefined : text.slice(position, position + expectedValue.length);
  }

  private resolveAmounts(text: string): readonly ResolvedEntity[] {
    return [...text.matchAll(AMOUNT_PATTERN)].flatMap((match) => {
      const currency = match.groups?.['currency'];
      const value = match.groups?.['value'];
      if (currency === undefined || value === undefined) {
        return [];
      }
      const magnitude = this.parseAmount(value);
      if (magnitude === undefined) {
        return [];
      }
      const isNegative =
        magnitude !== 0 &&
        (match.groups?.['leadingSign'] === '-' || match.groups?.['trailingSign'] === '-');
      const amount = isNegative ? -magnitude : magnitude;
      const code = CURRENCY_CODES.get(currency.toLocaleLowerCase()) ?? currency.toUpperCase();
      return [
        {
          type: 'AMOUNT',
          canonicalName: `${code} ${amount.toFixed(2)}`,
          sourceText: match[0],
          confidence: 0.98,
        },
      ];
    });
  }

  /**
   * Interpreta el último separador como decimal sólo cuando no delimita un grupo de tres dígitos.
   */
  private parseAmount(value: string): number | undefined {
    const lastSeparator = Math.max(value.lastIndexOf('.'), value.lastIndexOf(','));
    const decimalDigits = lastSeparator === -1 ? 0 : value.length - lastSeparator - 1;
    const isDecimalSeparator = lastSeparator !== -1 && decimalDigits !== 3;
    const integerPart = (isDecimalSeparator ? value.slice(0, lastSeparator) : value).replace(
      /[.,]/gu,
      '',
    );
    const fractionPart = isDecimalSeparator ? value.slice(lastSeparator + 1) : '0';
    const parsed = Number(`${integerPart}.${fractionPart}`);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private resolveIsoDates(text: string): readonly ResolvedEntity[] {
    return [...text.matchAll(ISO_DATE_PATTERN)].flatMap((match) =>
      this.isRealCalendarDate(match[0])
        ? [
            {
              type: 'DATE',
              canonicalName: match[0],
              sourceText: match[0],
              confidence: 0.99,
            },
          ]
        : [],
    );
  }

  private isRealCalendarDate(isoDate: string): boolean {
    const parsed = new Date(`${isoDate}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(isoDate);
  }

  private removeDuplicates(entities: readonly ResolvedEntity[]): readonly ResolvedEntity[] {
    const uniqueEntities = new Map<string, ResolvedEntity>();
    for (const entity of entities) {
      const key = `${entity.type}:${entity.canonicalName}`;
      if (!uniqueEntities.has(key)) {
        uniqueEntities.set(key, entity);
      }
    }
    return [...uniqueEntities.values()];
  }
}
