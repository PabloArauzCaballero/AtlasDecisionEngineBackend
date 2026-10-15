export interface MrzTd1 {
  documentNumber: string | null;
  birthDate: string | null;
  expirationDate: string | null;
  sex: 'M' | 'F' | 'X' | null;
  nationality: string | null;
  issuingState: string | null;
  lastNames: string | null;
  firstNames: string | null;
  /**
   * Qué comprobaciones cuadraron, en TRES estados y no en dos.
   *
   * `true` cuadra, `false` NO cuadra, y **`null` no se pudo evaluar**. El tercero
   * es el que faltaba y el que más caro salía: cuando el reconocedor devuelve un
   * `?`, una `c` minúscula o un espacio donde la norma exige un dígito de
   * control, lo que ha ocurrido no es que el documento falle su propio control —
   * es que no se ha leído el control. Tratar esas dos cosas igual convierte una
   * foto regular en una sospecha de manipulación.
   *
   * Medido sobre 23 cédulas bolivianas auténticas: **cuatro** traían el dígito
   * compuesto ilegible (`?`, `c`) y las cuatro salían con
   * `MRZ_COMPOSITE_CHECK_FAILED` en su expediente. Ninguna estaba manipulada; a
   * ninguna se le podía comprobar ese dígito.
   *
   * El corpus lo dice en una línea: «Campo no leído es NO_EVALUABLE, no FALSO».
   */
  checks: {
    documentNumber: boolean | null;
    birthDate: boolean | null;
    expirationDate: boolean | null;
    composite: boolean | null;
  };
}

/**
 * Lo que la MRZ deja ver de sí misma en un diagnóstico: los renglones que el
 * reconocedor entregó —con el número de documento ENMASCARADO, la misma
 * decisión que el resultado— y qué controles cuadraron tras la interpretación.
 *
 * Existe para la traza de ejecución: «los campos no salieron» no se puede
 * depurar; «el renglón llegó con un glifo delante y el control de la caducidad
 * no cuadró» sí. Sin esto, la única forma de ver qué leyó el OCR era volver a
 * correr la verificación con las imágenes en la mano — que el motor borra.
 */
export interface MrzDiagnostics {
  found: boolean;
  /** Los renglones candidatos tal como llegaron, con el número enmascarado. */
  lines?: string[];
  checks?: MrzTd1['checks'];
}
