/**
 * Cuánto pesa una regla frente al modelo.
 *
 * - `ALTA`: el texto nombra una entidad o un trámite que sólo puede ser una
 *   cosa —`YPFB`, `IMPUESTOS NACIONALES`, `AFP`—. Se puede resolver sin llamar
 *   al modelo, y ahí está el ahorro de latencia: la glosa ya se explicó sola.
 * - `MEDIA`: el texto es compatible con la categoría pero admite matices que un
 *   modelo lee mejor. Sólo actúa como red, nunca como atajo.
 */
export type CertezaDeRegla = 'ALTA' | 'MEDIA';

/** De dónde salió la decisión, para que la traza no tenga que deducirlo. */
export type OrigenDeRegla = 'RUBRO' | 'INSTRUMENTO' | 'CAJON';

export interface Regla {
  /** Qué reconoce. Se evalúa sobre el texto PLEGADO: mayúsculas y sin tildes. */
  readonly patron: RegExp;
  /**
   * Categorías cuando el dinero salió, de la más específica a la más general.
   *
   * Es una LISTA y no un código porque el catálogo de un tenant no tiene por qué
   * traer la hoja fina: quien clasifica gasto doméstico quizá no sembró
   * `GASTOS.EMPRESARIALES.SOFTWARE`, y perder la regla entera por eso mandaba al
   * cajón algo que `GASTOS.OCIO.SUSCRIPCIONES` describía perfectamente.
   */
  readonly salida: readonly string[];
  /** Categorías cuando el dinero entró. Vacío si el instrumento sólo va en un sentido. */
  readonly entrada: readonly string[];
  /** Cómo se explica en la traza. */
  readonly porque: string;
  /** Si puede resolver sin modelo. */
  readonly certeza: CertezaDeRegla;
}
