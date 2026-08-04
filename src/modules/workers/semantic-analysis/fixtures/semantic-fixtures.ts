/**
 * Escenarios de prueba del worker semántico.
 *
 * Sintéticos y sin datos personales reales: los nombres, importes y documentos
 * son inventados. Cada escenario declara qué demuestra, para que la interfaz lo
 * explique antes de ejecutarlo.
 *
 * Pasan por el **mismo esquema de validación** que una entrada real. Un fixture
 * que se saltara la validación podría alcanzar un estado que la entrada normal
 * no produce, y entonces dejaría de demostrar nada sobre el sistema real.
 */
export interface SemanticFixture {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly text: string;
  readonly expectsFailure: boolean;
}

export const SEMANTIC_FIXTURES: readonly SemanticFixture[] = [
  {
    code: 'valid-basic',
    name: 'Reclamo claro',
    description:
      'Un texto que encaja sin ambigüedad en una sola categoría. Es el camino feliz: debe terminar en MATCH con confianza alta.',
    text: 'Quiero reportar un cobro que no reconozco en mi tarjeta de crédito del mes pasado.',
    expectsFailure: false,
  },
  {
    code: 'valid-complete',
    name: 'Con entidades, montos y fechas',
    description:
      'Ejercita la resolución de entidades y el reconocimiento de montos con separador de miles y de fechas reales, además de la clasificación.',
    text:
      'El 15 de marzo de 2026 se debitaron Bs 1.250,50 de mi cuenta en el Banco Nacional de Bolivia ' +
      'por un servicio que cancelé en febrero. Solicito la devolución del importe.',
    expectsFailure: false,
  },
  {
    code: 'boundary-case',
    name: 'Ambiguo entre dos categorías',
    description:
      'Un texto que sostiene dos categorías con confianzas muy próximas. Debe terminar en AMBIGUOUS o MULTI_MATCH, no eligiendo una al azar: es el escenario que demuestra que el motor prefiere no decidir a decidir mal.',
    text: 'Me cobraron dos veces la misma compra y además la tarjeta quedó bloqueada sin que yo lo pidiera.',
    expectsFailure: false,
  },
  {
    code: 'invalid-example',
    name: 'Texto vacío tras normalizar',
    description:
      'Sólo espacios y caracteres invisibles. Debe rechazarse en la validación, antes de gastar una sola llamada al proveedor de modelos.',
    // Espacios de ancho cero y separadores Unicode: parecen contenido y no lo
    // son. Es exactamente lo que la normalización debe neutralizar.
    text: '​​   ⁠  ​',
    expectsFailure: true,
  },
];

export function findSemanticFixture(code: string): SemanticFixture | undefined {
  return SEMANTIC_FIXTURES.find((fixture) => fixture.code === code);
}
