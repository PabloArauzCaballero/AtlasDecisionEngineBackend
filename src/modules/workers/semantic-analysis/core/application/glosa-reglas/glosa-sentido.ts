import { plegar } from './glosa-texto';

/** Raíces, por si el catálogo del tenant es plano y no sembró los cajones. */
export const RAICES = { SALIDA: 'GASTOS', ENTRADA: 'INGRESOS' } as const;

/** Marca de que un movimiento SALIÓ, tal como lo escriben los bancos. */
const SALIDA = /^(?:DEBITO|CARGO|RETIRO|PAGO|COMPRA|N\/D)\b|\bDEBITO\b/u;
/**
 * Marca de que un movimiento ENTRÓ.
 *
 * `COBRO FACTURA` está aquí y `COBRO` a secas NO, y la distinción es medida: quien
 * emite una factura y la cobra recibe dinero —es el ingreso de un trabajador
 * independiente—, mientras que «COBRO_SPB_202602» o «COBRO DE COMISIÓN», que
 * aparecen tal cual en extractos reales del BCP, son cargos que el banco hace.
 * Sin el anclaje, la misma palabra convertiría esos cargos en ingresos.
 *
 * El caso que lo destapó: «COBRO FACTURA 0012 SERVICIOS PROFESIONALES DE
 * CONSULTORIA» se archivaba como GASTO en servicios profesionales. La regla de
 * rubro ya distinguía los dos lados —tiene `entrada: INGRESOS.INDEPENDIENTE`—;
 * lo que fallaba era el sentido, que caía en su supuesto conservador. En una
 * capacidad de pago ese error cuenta doble: quita ingreso y suma gasto.
 */
const ENTRADA =
  /^(?:CREDITO|ABONO|DEPOSITO|N\/C)\b|\bCREDITO\b|\bABONO\b|^COBRO\s+(?:DE\s+)?FACTURA\b/u;

/**
 * Dónde una palabra contable NO es una marca contable, sino parte de un nombre.
 *
 * `CRÉDITO` y `DÉBITO` son las dos palabras con las que un banco declara el
 * sentido de un asiento, y son también parte del nombre de instituciones y
 * productos bolivianos. La colisión no es hipotética: el nombre legal del BCP es
 * **«Banco de Crédito de Bolivia S.A.»**, y toda transferencia ACH imprime el
 * banco de la contraparte en la glosa. Medido sobre los 473 movimientos de siete
 * extractos reales, 60 traían las DOS marcas encendidas a la vez y 60 de esos 65
 * eran exactamente esto:
 *
 *     DEBITO TRANSFERENCIA ACH 71329455 … BANCO DE CREDITO DE BOLIVIA S.A.
 *      ↑ marca real                        ↑ nombre propio leído como marca
 *
 * Con las dos encendidas el sentido deja de poder afirmarse, y `saleDinero` cae
 * en su supuesto conservador. Para un `DEBITO` acierta por casualidad —el
 * supuesto es salida—; para un `ABONO … BANCO DE CREDITO` se equivoca entero y
 * publica un ingreso como gasto.
 *
 * Se neutralizan por fragmento y no borrando la palabra suelta: `CRÉDITO` a
 * secas sí es una marca legítima, y quitarla dejaría sin leer los asientos que
 * de verdad la usan. Los cuatro fragmentos salen del padrón compilado de ASFI
 * —las dos cooperativas de ahorro y crédito y los dos bancos de crédito— más el
 * nombre del instrumento, que ningún banco usa para declarar el sentido.
 */
const NOMBRES_PROPIOS_CON_MARCA =
  /BANCO\s+DE\s+CREDITO(?:\s+(?:DE\s+BOLIVIA|DEL\s+PERU))?|COOPERATIVA\s+DE\s+AHORRO\s+Y\s+CREDITO|TARJETA\s+DE\s+(?:CREDITO|DEBITO)/gu;

/**
 * El texto sin los nombres propios que arrastran una palabra contable.
 *
 * Sólo se usa para LEER EL SENTIDO. La clasificación sigue viendo la glosa
 * entera: el nombre del banco de la contraparte es información útil para saber
 * qué fue el movimiento, y sólo estorba cuando lo que se pregunta es si el
 * dinero entró o salió.
 */
function sinNombresPropios(plegado: string): string {
  return plegado.replace(NOMBRES_PROPIOS_CON_MARCA, ' ');
}

/**
 * Las marcas con las que un banco rotula EL ASIENTO, no el concepto.
 *
 * Es un subconjunto estricto de `SALIDA` y `ENTRADA`, y la diferencia decide
 * quién puede contradecir al modelo. `DÉBITO`, `CRÉDITO`, `ABONO`, `CARGO`,
 * `N/D` y `N/C` son la etiqueta contable del apunte: cuando aparecen, el banco
 * está declarando de qué lado del libro cae, y eso no admite interpretación.
 *
 * `PAGO`, `COMPRA`, `RETIRO` y `DEPÓSITO` NO están aquí, y su ausencia está
 * medida. Describen lo que ocurrió, no el lado del libro, y el sentido que
 * sugieren se puede invertir: en el corpus real, «PAGO DE INTERES - SCZ/AGENCIA
 * CENTRAL» es el banco pagando intereses AL cliente —un ingreso— y el modelo lo
 * clasificó bien con 0,9991. Una compuerta que hubiera leído ese `PAGO` como
 * salida habría roto el único caso que ya estaba bien.
 */
const MARCA_CONTABLE_SALIDA = /^(?:DEBITO|CARGO|N\/D)\b|\bDEBITO\b/u;
const MARCA_CONTABLE_ENTRADA = /^(?:CREDITO|ABONO|N\/C)\b|\bCREDITO\b|\bABONO\b/u;

/** De qué lado del libro cae el apunte, o `null` si el banco no lo rotuló. */
export type SentidoDeclarado = 'SALIDA' | 'ENTRADA';

/**
 * El lado del libro que el banco IMPRIMIÓ, cuando lo imprimió.
 *
 * Devuelve `null` en cuanto hay la menor duda —ninguna marca, o las dos— porque
 * su única razón de existir es poder contradecir al modelo, y para eso hay que
 * estar seguro. No es `saleDinero`: aquélla siempre contesta, porque su trabajo
 * es colocar el movimiento en algún sitio; ésta se calla, porque el suyo es
 * vetar.
 *
 * Los nombres propios se retiran antes de mirar, por lo mismo que en
 * `saleDinero`: el `CRÉDITO` de «Banco de Crédito de Bolivia» es un apellido.
 */
export function sentidoDeclarado(texto: string): SentidoDeclarado | null {
  const marcas = sinNombresPropios(plegar(texto));
  const sale = MARCA_CONTABLE_SALIDA.test(marcas);
  const entra = MARCA_CONTABLE_ENTRADA.test(marcas);
  if (sale === entra) return null;
  return sale ? 'SALIDA' : 'ENTRADA';
}

/** La raíz del árbol donde cae un código: el lado del libro que afirma. */
export function ladoDelCodigo(codigo: string): SentidoDeclarado | null {
  if (codigo === RAICES.SALIDA || codigo.startsWith(`${RAICES.SALIDA}.`)) return 'SALIDA';
  if (codigo === RAICES.ENTRADA || codigo.startsWith(`${RAICES.ENTRADA}.`)) return 'ENTRADA';
  return null;
}

/**
 * El sentido del movimiento, leído del propio texto.
 *
 * El portal antepone `DEBITO`/`CREDITO` cuando la glosa no lo dice, así que
 * esta marca está presente siempre. Ante la duda se asume SALIDA: en un
 * extracto la mayoría de las filas lo son, y equivocarse hacia el gasto es el
 * error conservador cuando lo que se mide es capacidad de pago.
 */
export function saleDinero(plegado: string): boolean {
  const soloMarcas = sinNombresPropios(plegado);
  if (ENTRADA.test(soloMarcas) && !SALIDA.test(soloMarcas)) return false;
  return true;
}
