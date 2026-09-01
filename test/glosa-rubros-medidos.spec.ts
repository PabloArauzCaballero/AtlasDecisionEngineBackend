import { GlosaFallbackClassifier } from '../src/modules/workers/semantic-analysis/core/application/glosa-fallback';

/**
 * Los tres defectos de rubro que la calibración destapó, y que eran de tres
 * clases distintas pese a presentarse igual: una categoría equivocada.
 *
 * La calibración estaba en 17/21 y los cuatro fallos parecían «cosas del
 * catálogo». Sólo dos lo eran a medias; los otros dos eran defectos de código y
 * de expectativa. Se corrigieron y quedó en 21/21.
 */

const CATALOGO = new Set([
  'GASTOS',
  'GASTOS.OTROS',
  'GASTOS.VIVIENDA.SERVICIOS',
  'GASTOS.TRANSPORTE.COMBUSTIBLE',
  'GASTOS.PROFESIONALES',
  'GASTOS.ALIMENTACION.CAFETERIA',
  'GASTOS.ALIMENTACION.RESTAURANTES',
  'INGRESOS',
  'INGRESOS.OTROS',
  'INGRESOS.INDEPENDIENTE',
]);

describe('GlosaFallbackClassifier · rubros medidos contra extractos reales', () => {
  const clasificador = new GlosaFallbackClassifier();
  const categoria = (glosa: string): string | undefined =>
    clasificador.clasificar(glosa, CATALOGO)?.categoryCode;

  /*
   * YPFB vende gas domiciliario Y combustible de surtidor. La regla ya llevaba
   * una exclusión para el segundo caso, pero escrita como lookahead DESPUÉS del
   * nombre: sólo miraba hacia adelante, y en esta glosa las dos palabras que la
   * excluyen van ANTES de YPFB. Un repostaje se archivaba como servicio básico
   * de la vivienda.
   */
  it('no confunde repostar en un surtidor de YPFB con el gas de casa', () => {
    expect(categoria('COMPRA DE GASOLINA ESPECIAL EN SURTIDOR YPFB')).not.toBe(
      'GASTOS.VIVIENDA.SERVICIOS',
    );
  });

  it('sigue reconociendo el gas domiciliario de YPFB', () => {
    expect(categoria('PAGO YPFB GAS DOMICILIARIO MES DE JULIO')).toBe('GASTOS.VIVIENDA.SERVICIOS');
  });

  /*
   * Cobrar una factura por consultoría es el INGRESO de un trabajador
   * independiente. La regla ya distinguía los dos lados; lo que fallaba era el
   * sentido, que sin marca contable caía en su supuesto conservador —salida— y
   * publicaba el cobro como gasto. En una capacidad de pago eso cuenta doble:
   * quita ingreso y suma gasto.
   */
  it('lee el cobro de una factura por consultoría como ingreso', () => {
    expect(categoria('COBRO FACTURA 0012 SERVICIOS PROFESIONALES DE CONSULTORIA')).toBe(
      'INGRESOS.INDEPENDIENTE',
    );
  });

  /*
   * Y la mitad que impide que el arreglo se pase de listo: `COBRO` a secas NO es
   * una marca de entrada. «COBRO_SPB_202602» y «COBRO DE COMISIÓN» aparecen tal
   * cual en extractos reales del BCP y son cargos que el banco hace.
   */
  it.each(['COBRO SPB 202602', 'COBRO DE COMISION POR MANTENIMIENTO'])(
    'no convierte «%s» en un ingreso',
    (glosa) => {
      expect(categoria(glosa)?.startsWith('INGRESOS')).toBe(false);
    },
  );

  /*
   * Las cafeterías y restaurantes bolivianos medidos en extractos reales. Viven
   * en la regla y no sólo en el catálogo sembrado porque el catálogo vive en la
   * base y una instalación limpia lo pierde.
   */
  it.each([
    ['DEBITO COMPRA AGRICAFE S.A.S', 'GASTOS.ALIMENTACION.CAFETERIA'],
    ['DEBITO COMPRA COFI', 'GASTOS.ALIMENTACION.CAFETERIA'],
    ['DEBITO COMPRA CAFFE DEL BARRIO', 'GASTOS.ALIMENTACION.CAFETERIA'],
    ['DEBITO COMPRA LLAO LLAO AX B', 'GASTOS.ALIMENTACION.CAFETERIA'],
    ['DEBITO COMPRA CITRONNELLE SR', 'GASTOS.ALIMENTACION.RESTAURANTES'],
    ['DEBITO COMPRA ZUCCHINI DELI', 'GASTOS.ALIMENTACION.RESTAURANTES'],
  ])('reconoce «%s»', (glosa, esperada) => {
    expect(categoria(glosa)).toBe(esperada);
  });
});
