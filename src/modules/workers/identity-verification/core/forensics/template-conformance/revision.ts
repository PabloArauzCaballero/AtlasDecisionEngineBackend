import type { ConformidadDePlantilla } from '../../catalog/bolivia-ci.recognizer';
import type { EntradaDePlantilla, IncoherenciaEstructural, ObservacionEstructural } from './types';

/** Lo que cada comprobación necesita y dónde deja lo que encuentra. */
export interface Revision {
  readonly entrada: EntradaDePlantilla;
  readonly textoCompleto: string;
  readonly conformidad: ConformidadDePlantilla;
  readonly fallos: IncoherenciaEstructural[];
  readonly notas: ObservacionEstructural[];
}
