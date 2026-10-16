import { type DirectionCoherence } from '../official-glossary';
import type { TratamientoDeIngreso } from '../../../corpus/corpus-extractos.generated';

/** Un movimiento, reducido a lo que la capacidad de pago necesita de él. */
export interface AffordabilityTransaction {
  /** `AAAA-MM-DD`, o `null` si no se pudo leer la fecha. */
  readonly date: string | null;
  readonly description: string;
  readonly debit: number | null;
  readonly credit: number | null;
  readonly balance: number | null;
}

/** Un movimiento ya clasificado. Lo consume el resto del módulo. */
export interface ClassifiedMovement extends AffordabilityTransaction {
  readonly month: string;
  readonly day: number;
  readonly amount: number;
  readonly direction: 'INFLOW' | 'OUTFLOW';
  readonly kind: string;
  readonly nsf: boolean;
  /** Glosa normalizada y recortada: la clave con la que se detecta recurrencia. */
  readonly label: string;
  /** Quién nombró el movimiento: el glosario del emisor o nuestro léxico. */
  readonly classifiedBy: 'OFFICIAL_GLOSSARY' | 'LOCAL_LEXICON';
  /** Categorías analíticas del glosario oficial. Vacío si no casó ninguna. */
  readonly officialCategories: readonly string[];
  /** Lo que el glosario permite hacer con este importe al medir ingreso. */
  readonly officialIncomeTreatment: TratamientoDeIngreso | null;
  /** La fila contra lo que el emisor declara para esa glosa. Nunca cambia el lado. */
  readonly directionCoherence: DirectionCoherence;
}

export const MILLISECONDS_PER_DAY = 86_400_000;

/** Lo que hay que saber del documento para consultar el glosario de su emisor. */
export interface MovementClassificationContext {
  /** Sigla ASFI del emisor del extracto, cuando se pudo resolver. */
  readonly issuerCode?: string | null;
}
