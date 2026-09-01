import { GlosaFallbackClassifier } from '../src/modules/workers/semantic-analysis/core/application/glosa-fallback';

/**
 * Que un impuesto boliviano se reconozca lo escriba como lo escriba su banco.
 *
 * ## El defecto
 *
 * El RC-IVA y el ITF son dos tributos que aparecen en casi cualquier extracto
 * boliviano, y cada banco los rotula a su manera. La regla reconocía la forma
 * canónica y se le escapaban las variantes, que son la mayoría:
 *
 *   RC-IVA            ✓ reconocido      RC IVA            ✗ al cajón (Banco Unión)
 *   RCIVA             ✓ reconocido      RETENCIONRCIVA    ✗ al cajón (BCP)
 *   ITF               ✓ reconocido      BT-ITFAP          ✗ al cajón (BCP)
 *
 * Las dos causas son de frontera de palabra, y las dos son sistemáticas: en
 * `RETENCIONRCIVA` no hay frontera ANTES de `RC`, y en `ITFAP` no la hay DESPUÉS
 * de `ITF`. Así que la alternativa no llegaba ni a evaluarse y el movimiento
 * caía en «otros gastos» con confianza 0,40.
 *
 * Es la clase de fallo que no se ve mirando el código —la expresión parece
 * cubrirlo— y sólo aparece midiendo contra extractos reales de varios bancos.
 */

const CATALOGO = new Set([
  'GASTOS',
  'GASTOS.OTROS',
  'GASTOS.IMPUESTOS',
  'GASTOS.FINANCIEROS.ITF',
  'GASTOS.FINANCIEROS.COMISIONES',
  'INGRESOS',
  'INGRESOS.OTROS',
  'INGRESOS.TRIBUTARIO',
]);

describe('GlosaFallbackClassifier · impuestos bolivianos y sus variantes', () => {
  const clasificador = new GlosaFallbackClassifier();

  /** Las cuatro formas del RC-IVA medidas en extractos reales. */
  it.each([
    ['DEBITO RC-IVA', 'la forma canónica'],
    ['DEBITO RCIVA', 'sin separador'],
    ['DEBITO RC IVA', 'con espacio, como lo imprime el Banco Unión'],
    ['DEBITO RETENCIONRCIVA', 'pegado a la retención, como lo imprime el BCP'],
  ])('reconoce «%s» (%s) como impuesto', (glosa) => {
    const decision = clasificador.clasificar(glosa, CATALOGO);
    expect(decision?.categoryCode).toBe('GASTOS.IMPUESTOS');
    expect(decision?.origen).toBe('RUBRO');
  });

  it.each([
    ['DEBITO ITF', 'la sigla suelta'],
    ['DEBITO BT-ITFAP TRA 0000', 'como lo imprime el BCP'],
    ['DEBITO ITFAP', 'el sufijo sin prefijo'],
  ])('reconoce «%s» (%s) como impuesto a las transacciones', (glosa) => {
    const decision = clasificador.clasificar(glosa, CATALOGO);
    expect(decision?.categoryCode).toBe('GASTOS.FINANCIEROS.ITF');
    expect(decision?.origen).toBe('RUBRO');
  });

  /*
   * La devolución del RC-IVA es un INGRESO, y con este impuesto pasa de verdad:
   * el crédito fiscal se compensa contra el salario. La regla ya lo contemplaba
   * y las variantes nuevas tienen que heredarlo, no sólo el lado del gasto.
   */
  it('manda la devolución al lado de los ingresos', () => {
    const decision = clasificador.clasificar('CREDITO DEVOLUCION RC IVA', CATALOGO);
    expect(decision?.categoryCode).toBe('INGRESOS.TRIBUTARIO');
  });

  /*
   * Y lo que la regla NO debe hacer: dispararse por una palabra que lleve las
   * letras dentro. Aflojar la frontera para reconocer `ITFAP` era la solución
   * fácil y habría convertido cualquier glosa con «itf» en un impuesto.
   */
  it.each(['DEBITO COMPRA EN GITFONE SRL', 'DEBITO PAGO A RCIVAL SRL'])(
    'no confunde «%s» con un impuesto',
    (glosa) => {
      const decision = clasificador.clasificar(glosa, CATALOGO);
      expect(decision?.categoryCode).not.toBe('GASTOS.IMPUESTOS');
      expect(decision?.categoryCode).not.toBe('GASTOS.FINANCIEROS.ITF');
    },
  );
});
