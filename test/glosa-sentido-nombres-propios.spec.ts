import { GlosaFallbackClassifier } from '../src/modules/workers/semantic-analysis/core/application/glosa-fallback';

/**
 * Que el nombre de un banco no se lea como el sentido del asiento.
 *
 * ## El defecto
 *
 * `CRÉDITO` y `DÉBITO` son las dos palabras con las que un banco declara si el
 * dinero entró o salió. Son también parte del nombre legal de instituciones
 * bolivianas —el BCP se llama **«Banco de Crédito de Bolivia S.A.»**— y del
 * nombre de un instrumento —«tarjeta de débito»—. Toda transferencia ACH imprime
 * el banco de la contraparte dentro de la glosa, así que la colisión es
 * rutinaria, no rebuscada.
 *
 * Medido sobre los 473 movimientos de siete extractos bolivianos reales: 65
 * traían las dos marcas encendidas a la vez, y **seis cambiaban de lado del
 * libro** por esta causa. Los seis son transferencias QR salientes —el importe
 * impreso en la propia glosa es negativo— y tres de ellas acababan clasificadas
 * como INGRESO tributario:
 *
 *     TRANSF. QR ACH Nro. 974233681 -2,730.00 BANCO DE CREDITO 70151372058354 …
 *                                              ↑ nombre propio leído como marca
 *
 * ## Por qué se prueba por el destino y no por el sentido
 *
 * `saleDinero` es privado, y con razón: nadie fuera necesita el booleano. Lo que
 * sí se observa es dónde cae el movimiento, que es lo que la persona ve. Un
 * gasto leído como ingreso aterriza en `INGRESOS.*` y eso es visible.
 *
 * Se afirma sobre la RAÍZ y no sobre la hoja a propósito: qué hoja sale depende
 * de qué tenga sembrado el catálogo, y eso no es lo que aquí se juzga. Atar la
 * prueba a la hoja la haría fallar cada vez que alguien siembre una categoría,
 * sin que nada se hubiera roto.
 */

/** Sólo cajones y raíces: se prueba el SENTIDO, no el acierto fino. */
const CATALOGO = new Set(['GASTOS', 'GASTOS.OTROS', 'INGRESOS', 'INGRESOS.OTROS']);

/** La mitad del árbol donde cayó el movimiento: lo único que esta prueba juzga. */
function raiz(codigo: string | undefined): string | undefined {
  return codigo?.split('.')[0];
}

describe('GlosaFallbackClassifier · el nombre del banco no es el sentido', () => {
  const clasificador = new GlosaFallbackClassifier();

  /*
   * Los tres casos reales del corpus. No llevan ninguna marca de salida —no
   * empiezan por DEBITO ni por PAGO—, así que la ÚNICA marca que el motor
   * encontraba era el `CREDITO` del nombre del banco de la contraparte, y con
   * ella daba por hecho que el dinero había entrado.
   */
  it.each([
    'TRANSF. QR ACH Nro. 974233681 -2,730.00 BANCO DE CREDITO 70151372058354 Roda Bagnoli Santiago',
    'TRANSF. QR ACH Nro. 1013467590 BANCO DE CREDITO 7015095543367 GASCO SRL bio CAJA 400B2',
    'TRANSF. QR ACH Nro. 980705053 -1,718.10 BANCO DE CREDITO 75028317 RENNY SILVESTRE RODRIGUEZ',
  ])('no convierte en ingreso una transferencia saliente por nombrar al BCP', (glosa) => {
    expect(raiz(clasificador.clasificar(glosa, CATALOGO)?.categoryCode)).toBe('GASTOS');
  });

  /*
   * El mismo defecto en el otro sentido, y con el otro nombre propio. Aquí la
   * marca real es `ABONO` y la espuria es el `DEBITO` de «tarjeta de débito»:
   * con las dos encendidas el motor cae en su supuesto conservador —salida— y
   * publica como gasto una devolución que fue un ingreso.
   */
  it('no convierte en gasto una devolución por nombrar la tarjeta de débito', () => {
    const glosa = 'ABONO POR DEVOLUCION DE COMPRA CON TARJETA DE DEBITO COMERCIO';
    expect(raiz(clasificador.clasificar(glosa, CATALOGO)?.categoryCode)).toBe('INGRESOS');
  });

  it.each([
    ['COOPERATIVA DE AHORRO Y CREDITO ABIERTA JESUS NAZARENO', 'la cooperativa del padrón'],
    ['BANCO DE CREDITO DEL PERU', 'el banco extranjero del padrón'],
  ])('tampoco lee como marca el nombre de %s', (nombre) => {
    const glosa = `TRANSF. QR ACH Nro. 111 ${nombre} 700123 JUAN PEREZ`;
    expect(raiz(clasificador.clasificar(glosa, CATALOGO)?.categoryCode)).toBe('GASTOS');
  });

  /*
   * La palabra suelta SÍ es una marca legítima. Si el arreglo hubiera borrado
   * `CREDITO` en vez de los fragmentos donde es un nombre, los asientos que de
   * verdad la usan se habrían quedado sin sentido que leer, y el defecto sólo
   * habría cambiado de sitio.
   */
  it('conserva CREDITO como marca cuando no es parte de un nombre', () => {
    const decision = clasificador.clasificar('CREDITO POR REVERSO DE COMISION', CATALOGO);
    expect(raiz(decision?.categoryCode)).toBe('INGRESOS');
  });

  it('sigue leyendo un DEBITO como gasto aunque nombre al mismo banco', () => {
    const glosa = 'DEBITO TRANSFERENCIA ACH 71329455 SINFOROSA ARCIBIA BANCO DE CREDITO DE BOLIVIA';
    expect(raiz(clasificador.clasificar(glosa, CATALOGO)?.categoryCode)).toBe('GASTOS');
  });

  it('mantiene el supuesto conservador cuando la glosa no declara nada', () => {
    expect(clasificador.clasificar('MOVIMIENTO VARIOS REF 000918237', CATALOGO)?.categoryCode).toBe(
      'GASTOS.OTROS',
    );
  });
});
