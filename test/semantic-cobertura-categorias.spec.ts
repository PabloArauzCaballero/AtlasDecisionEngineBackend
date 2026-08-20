/**
 * La garantía de que ninguna glosa se queda sin categoría.
 *
 * Este fichero vigila la política que sostiene el informe de gastos: un extracto
 * puede traer movimientos que el modelo no entienda, que lleguen con el
 * presupuesto agotado o que tarden más de la cuenta, y ninguno de esos tres
 * casos puede producir una fila vacía. «Sin determinar» no es una categoría: no
 * se suma, no se audita y traslada el problema entero a quien lee el informe.
 *
 * Se mide contra el catálogo REAL —el árbol sembrado, no una lista de juguete—
 * porque el defecto que se quiere impedir es precisamente el desacople entre lo
 * que una regla propone y lo que el catálogo tiene: una regla que apunta a una
 * hoja inexistente compila, no rompe nada y sólo se nota como movimientos que
 * caen al cajón sin explicación.
 */
import {
  GlosaFallbackClassifier,
  codigosPropuestosPorReglas,
} from '../src/modules/workers/semantic-analysis/core/application/glosa-fallback';
import { expenseCategoryTree } from '../src/modules/seeding/data/expense-category-tree.data';

/** Las hojas del árbol sembrado: lo único sobre lo que se puede clasificar. */
const HOJAS: ReadonlySet<string> = (() => {
  const padres = new Set(
    expenseCategoryTree
      .map((categoria) => categoria.parentCode)
      .filter((codigo): codigo is string => codigo !== null && codigo !== ''),
  );
  return new Set(
    expenseCategoryTree
      .filter((categoria) => !padres.has(categoria.code))
      .map((categoria) => categoria.code),
  );
})();

const clasificador = new GlosaFallbackClassifier();

/**
 * Glosas como las escriben los bancos bolivianos, con el rubro que les toca.
 *
 * Están en el formato que llega al clasificador: mayúsculas, abreviado y sin los
 * identificadores, que es lo que `forClassification` entrega.
 */
const RUBROS_ESPERADOS: readonly [string, string][] = [
  ['PAGO SERVICIO ELFEC COD 4471', 'GASTOS.VIVIENDA.SERVICIOS'],
  ['DEBITO AUTOMATICO SAGUAPAC', 'GASTOS.VIVIENDA.SERVICIOS'],
  ['PAGO ENTEL PLAN POSTPAGO', 'GASTOS.VIVIENDA.TELECOMUNICACIONES'],
  ['PAGO ALQUILER DEPARTAMENTO', 'GASTOS.VIVIENDA.ALQUILER'],
  ['COMPRA YPFB SURTIDOR LOS TAJIBOS', 'GASTOS.TRANSPORTE.COMBUSTIBLE'],
  ['PAGO SOAT 2026', 'GASTOS.TRANSPORTE.SEGURO'],
  ['COMPRA HIPERMAXI SUCURSAL NORTE', 'GASTOS.ALIMENTACION.SUPERMERCADO'],
  ['CONSUMO FARMACORP CENTRO', 'GASTOS.SALUD.FARMACIA'],
  ['PAGO MENSUALIDAD COLEGIO SAN CALIXTO', 'GASTOS.EDUCACION'],
  ['COMPRA NETFLIX.COM', 'GASTOS.OCIO.SUSCRIPCIONES'],
  ['PAGO IMPUESTOS NACIONALES FORM 200', 'GASTOS.IMPUESTOS'],
  ['DEBITO ITF SEGUN LEY', 'GASTOS.FINANCIEROS.ITF'],
  ['APORTE AFP FUTURO DE BOLIVIA', 'GASTOS.LABORALES.PENSIONES'],
  ['ABONO SUELDO MES DE JULIO', 'INGRESOS.SUELDO'],
  ['ABONO REMESA WESTERN UNION', 'INGRESOS.REMESA'],
  ['CREDITO POR ANTICRETICO DEVUELTO', 'INGRESOS.ANTICRETICO'],
  ['PAGO CUOTA PRESTAMO HIPOTECARIO', 'GASTOS.FINANCIEROS.PRESTAMOS'],
  ['CARGO POR MORA CUOTA VENCIDA', 'GASTOS.FINANCIEROS.MORA'],
  ['COMPRA AMAZON MKTPLACE', 'GASTOS.COMPRAS.TARJETA'],
  ['PAGO VETERINARIA HUELLITAS', 'GASTOS.PERSONAL.MASCOTAS'],
];

/** Glosas que sólo declaran el vehículo del dinero. */
const INSTRUMENTOS_ESPERADOS: readonly [string, string][] = [
  ['TRASPASO CA/CC CON QR (MOVIL) TRASP.CTAS.TERCEROS', 'GASTOS.TRANSFERENCIAS'],
  ['DEBITO RETIRO DE EFECTIVO CAJERO AUTOMATICO', 'GASTOS.EFECTIVO'],
  ['CREDITO DEPOSITO EN EFECTIVO VENTANILLA', 'INGRESOS.EFECTIVO'],
  ['DEBITO COMISION MANTENIMIENTO DE CUENTA', 'GASTOS.FINANCIEROS.COMISIONES'],
  ['CREDITO INTERES GANADO CAJA DE AHORRO', 'INGRESOS.FINANCIERO'],
  ['COMPRA POS COMERCIO 9931', 'GASTOS.COMPRAS.TARJETA'],
];

describe('las reglas y el catálogo hablan del mismo árbol', () => {
  it('toda categoría que una regla puede proponer existe como hoja sembrada', () => {
    const inexistentes = codigosPropuestosPorReglas().filter((codigo) => !HOJAS.has(codigo));

    expect(inexistentes).toEqual([]);
  });
});

describe('lo que la glosa nombra, la regla lo lee', () => {
  it.each(RUBROS_ESPERADOS)('«%s» es %s', (glosa, esperado) => {
    const decision = clasificador.clasificar(glosa, HOJAS);

    expect(decision).not.toBeNull();
    expect(decision?.categoryCode).toBe(esperado);
    // Un rubro nombrado no necesita al modelo: es lo que autoriza el atajo.
    expect(decision?.origen).toBe('RUBRO');
    expect(decision?.certeza).toBe('ALTA');
  });

  it.each(INSTRUMENTOS_ESPERADOS)('«%s» se resuelve por instrumento como %s', (glosa, esperado) => {
    const decision = clasificador.clasificar(glosa, HOJAS);

    expect(decision?.categoryCode).toBe(esperado);
    expect(decision?.origen).toBe('INSTRUMENTO');
  });

  it('no le importan las tildes ni las mayúsculas', () => {
    const mayusculas = clasificador.clasificar('PAGO COMISION POR MANTENIMIENTO', HOJAS);
    const minusculas = clasificador.clasificar('pago comisión por mantenimiento', HOJAS);

    expect(minusculas?.categoryCode).toBe(mayusculas?.categoryCode);
    expect(minusculas?.categoryCode).toBe('GASTOS.FINANCIEROS.COMISIONES');
  });
});

describe('ninguna glosa se queda sin categoría', () => {
  /*
   * El caso límite de verdad: texto que no nombra nada. Es lo que ponen los
   * bancos cuando no ponen nada, y es exactamente la fila que antes acababa
   * «sin determinar» y obligaba a decidir a mano.
   */
  const SIN_CONCEPTO = [
    'DEBITO VARIOS',
    'MOVIMIENTO 00293381',
    'N/D REF 8891',
    'AJUSTE',
    '.',
    'CREDITO OPERACION 771',
  ];

  it.each(SIN_CONCEPTO)('«%s» cae en el cajón de su sentido, nunca en nada', (glosa) => {
    const decision = clasificador.clasificar(glosa, HOJAS);

    expect(decision).not.toBeNull();
    expect(HOJAS.has(decision?.categoryCode ?? '')).toBe(true);
    expect(decision?.origen).toBe('CAJON');
  });

  it('el cajón respeta el sentido del movimiento', () => {
    expect(clasificador.clasificar('DEBITO VARIOS', HOJAS)?.categoryCode).toBe('GASTOS.OTROS');
    expect(clasificador.clasificar('CREDITO VARIOS', HOJAS)?.categoryCode).toBe('INGRESOS.OTROS');
  });

  it('ante la duda de sentido asume salida, que es el error conservador', () => {
    // En un extracto la mayoría de las filas son gastos, y equivocarse hacia el
    // gasto es lo prudente cuando lo que se mide es capacidad de pago.
    expect(clasificador.clasificar('AJUSTE CONTABLE', HOJAS)?.categoryCode).toBe('GASTOS.OTROS');
  });
});

describe('un catálogo más pobre degrada la decisión, no la pierde', () => {
  /** Un tenant que sólo sembró el primer nivel del árbol. */
  const CATALOGO_PLANO = new Set(['GASTOS.VIVIENDA', 'GASTOS.OTROS', 'INGRESOS.OTROS']);

  it('publica el ancestro cuando la hoja fina no existe, y lo dice', () => {
    const decision = clasificador.clasificar('PAGO SERVICIO ELFEC', CATALOGO_PLANO);

    expect(decision?.categoryCode).toBe('GASTOS.VIVIENDA');
    expect(decision?.degradado).toBe(true);
    // Degradada deja de ser inequívoca: el atajo ya no puede saltarse el modelo.
    expect(decision?.certeza).toBe('MEDIA');
  });

  it('una regla sin sitio en el catálogo no descarta a las demás', () => {
    // `YPFB` no tiene dónde caer aquí, pero `COMPRA` sí: la clasificación baja
    // de rubro a instrumento en vez de desplomarse hasta el cajón.
    const soloTarjeta = new Set(['GASTOS.COMPRAS.TARJETA', 'GASTOS.OTROS']);
    const decision = clasificador.clasificar('COMPRA YPFB SURTIDOR', soloTarjeta);

    expect(decision?.categoryCode).toBe('GASTOS.COMPRAS.TARJETA');
    expect(decision?.origen).toBe('INSTRUMENTO');
  });

  it('sin ninguna categoría utilizable se abstiene en vez de inventar un código', () => {
    expect(clasificador.clasificar('DEBITO VARIOS', new Set())).toBeNull();
  });
});
