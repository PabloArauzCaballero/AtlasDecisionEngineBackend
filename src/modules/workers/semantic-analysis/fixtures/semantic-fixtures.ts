/**
 * Escenarios de prueba del clasificador de gastos.
 *
 * Son descripciones de movimiento tal como las escribe un banco boliviano en el
 * extracto: en mayúsculas, abreviadas y sin contexto. Es exactamente lo que
 * produce el worker de extractos, así que estos escenarios ejercitan la cadena
 * que el portal encadena de verdad —extracto → descripción → categoría— y no una
 * versión redactada a mano que nunca se ve en producción.
 *
 * Sintéticos y sin datos personales reales: los comercios, importes y nombres
 * son inventados. Cada escenario declara qué demuestra, para que la interfaz lo
 * explique antes de ejecutarlo.
 *
 * Pasan por el **mismo esquema de validación** que una entrada real. Un fixture
 * que se saltara la validación podría alcanzar un estado que la entrada normal
 * no produce, y entonces dejaría de demostrar nada sobre el sistema real.
 *
 * Los cuatro cubren los cuatro desenlaces que el motor sabe distinguir: una
 * categoría clara, una rama profunda del árbol, una abstención por falta de
 * evidencia y un rechazo antes de clasificar. Faltando cualquiera de ellos, la
 * pantalla sólo demuestra el camino feliz.
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
    code: 'gasto-claro',
    name: 'Gasto de categoría clara',
    description:
      'Una compra de supermercado, que sólo encaja en una hoja del árbol. Es el camino feliz: debe terminar en MATCH con confianza alta bajo «Gastos › Alimentación › Supermercado y mercado».',
    text: 'COMPRA EN SUPERMERCADO HIPERMAXI SUCURSAL NORTE BS 487,90',
    expectsFailure: false,
  },
  {
    code: 'ingreso-nomina',
    name: 'Ingreso de nómina',
    description:
      'Un abono de sueldo. Demuestra que el catálogo clasifica las dos direcciones del dinero y no sólo el gasto: debe caer en «Ingresos › Sueldo», no en una categoría de gasto por parecido de vocabulario bancario.',
    text: 'ABONO DE HABERES NOMINA JUNIO 2026 EMPRESA CONSTRUCTORA SRL BS 8.450,00',
    expectsFailure: false,
  },
  {
    code: 'rama-profunda',
    name: 'Distinción dentro de una misma rama',
    description:
      'Una cuota de crédito de vivienda. Se parece mucho al alquiler —misma rama del gasto, mismo vocabulario— y sólo el contraejemplo del catálogo las separa: debe terminar en «Gastos › Gastos financieros › Préstamos y tarjetas» y no en Alquiler. Es el escenario que demuestra para qué sirve el árbol.',
    text: 'PAGO CUOTA PRESTAMO HIPOTECARIO VIVIENDA CUOTA 24/180 BS 3.210,00',
    expectsFailure: false,
  },
  {
    code: 'sin-categoria',
    name: 'Descripción sin categoría posible',
    description:
      'Un movimiento con la descripción que ponen los bancos cuando no ponen ninguna. No hay categoría que sostener, y el resultado correcto es UNKNOWN: una abstención, no un error. Es lo que demuestra que el clasificador prefiere no decidir a decidir mal.',
    text: 'MOVIMIENTO VARIOS REF 000918237 OP 4471',
    expectsFailure: false,
  },
  {
    code: 'invalid-example',
    name: 'Texto vacío tras normalizar',
    description:
      'Sólo espacios y caracteres invisibles. Debe rechazarse en la validación, antes de gastar una sola llamada al servidor de inferencia.',
    // Espacios de ancho cero y separadores Unicode: parecen contenido y no lo
    // son. Es exactamente lo que la normalización debe neutralizar.
    text: '​​   ⁠  ​',
    expectsFailure: true,
  },
];

export function findSemanticFixture(code: string): SemanticFixture | undefined {
  return SEMANTIC_FIXTURES.find((fixture) => fixture.code === code);
}
