import type { Regla } from './glosa-regla';

/**
 * Rubros de la capa 1 — Vivienda, impuestos, aportes y trámites del Estado.
 * Ver `glosa-rubros.ts` para el orden entre grupos, que importa.
 */
export const RUBROS_VIVIENDA_Y_ESTADO: readonly Regla[] = [
  // --- Vivienda y servicios básicos ---------------------------------------
  {
    patron:
      /\b(?:ELFEC|CRE\s*LTDA|COOPERATIVA\s+RURAL\s+DE\s+ELECTRIFICACION|DELAPAZ|ELECTROPAZ|CESSA|SEPSA|ENDE|SETAR)\b/u,
    salida: ['GASTOS.VIVIENDA.SERVICIOS'],
    entrada: [],
    porque: 'la glosa nombra a una distribuidora de electricidad',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:SAGUAPAC|EPSAS|SEMAPA|COSMOL|COATRI|ELAPAS|AGUA\s+POTABLE)\b/u,
    salida: ['GASTOS.VIVIENDA.SERVICIOS'],
    entrada: [],
    porque: 'la glosa nombra a una empresa de agua potable',
    certeza: 'ALTA',
  },
  /*
   * YPFB vende las DOS cosas: gas domiciliario y combustible de surtidor. Lo que
   * decide es si la glosa nombra el surtidor, y por eso la regla lleva una
   * exclusión.
   *
   * Estaba escrita como `(?!...)` DESPUÉS del nombre, así que sólo miraba hacia
   * adelante: en «COMPRA DE GASOLINA ESPECIAL EN SURTIDOR YPFB» las dos palabras
   * que la excluyen van ANTES de YPFB y no había nada que mirar detrás. El
   * repostaje se archivaba como servicio básico de la vivienda.
   *
   * El lookahead va ahora anclado al principio, que es lo que hace que examine
   * la línea entera y no dependa del orden en que cada banco redacte la glosa.
   */
  {
    patron:
      /^(?!.*\b(?:GASOLINA|DIESEL|SURTIDOR|ESTACION\s+DE\s+SERVICIO)\b).*\b(?:YPFB|EMCOGAS|GAS\s+DOMICILIARIO|GARRAFA)\b/u,
    salida: ['GASTOS.VIVIENDA.SERVICIOS'],
    entrada: [],
    porque: 'la glosa nombra el suministro de gas domiciliario',
    certeza: 'ALTA',
  },
  {
    patron:
      /\b(?:ENTEL|TIGO(?!\s*MONEY)|VIVA|NUEVATEL|COTAS|COTEL|COMTECO|AXS|CABLEVISION|INTERNET|MEGALINK|WIFI|TELEFONIA)\b/u,
    salida: ['GASTOS.VIVIENDA.TELECOMUNICACIONES'],
    entrada: [],
    porque: 'la glosa nombra a un operador de telecomunicaciones',
    certeza: 'ALTA',
  },
  {
    patron: /\bANTICRETICO\b/u,
    salida: ['GASTOS.VIVIENDA.ANTICRETICO'],
    entrada: ['INGRESOS.ANTICRETICO'],
    porque: 'la glosa declara un anticrético',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:ALQUILER|ARRIENDO|RENTA\s+MENSUAL|CANON\s+DE\s+ARRENDAMIENTO)\b/u,
    salida: ['GASTOS.VIVIENDA.ALQUILER'],
    entrada: ['INGRESOS.ALQUILER'],
    porque: 'la glosa declara un alquiler',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:EXPENSAS|CUOTA\s+CONDOMINIO|ADMINISTRACION\s+EDIFICIO|GASTOS\s+COMUNES)\b/u,
    salida: ['GASTOS.VIVIENDA.EXPENSAS'],
    entrada: [],
    porque: 'la glosa declara expensas o cuota de condominio',
    certeza: 'ALTA',
  },

  // --- Impuestos, aportes y trámites del Estado ----------------------------
  /*
   * El RC-IVA se escribe de CUATRO formas distintas según el banco, y la regla
   * sólo reconocía dos. Medido sobre 497 movimientos de diez extractos reales:
   * `RC-IVA` y `RCIVA` casaban; `RC IVA` —con espacio, del Banco Unión— y
   * `RETENCIONRCIVA` —todo pegado, del BCP— se iban al cajón de «otros gastos».
   *
   * Que la retención vaya pegada es lo que rompía el `\b` inicial: en
   * `RETENCIONRCIVA` no hay frontera de palabra delante de `RC`, así que la
   * alternativa no llegaba ni a evaluarse. Por eso el prefijo se nombra en vez
   * de confiar en la frontera.
   *
   * Es el mismo impuesto en los tres casos, y va a la misma categoría. Un
   * separador no cambia lo que es un tributo.
   */
  {
    patron:
      /\b(?:IMPUESTOS\s+NACIONALES|SERVICIO\s+DE\s+IMPUESTOS|SIN\b|RETENCION\s*RC[\s.-]?IVA|RC[\s.-]?IVA|IUE|FORM(?:ULARIO)?\s*\d{3}|BOLETA\s+DE\s+PAGO\s+\d{4}|DECLARACION\s+JURADA)\b/u,
    salida: ['GASTOS.IMPUESTOS'],
    entrada: ['INGRESOS.TRIBUTARIO'],
    porque: 'la glosa declara un pago al servicio de impuestos',
    certeza: 'ALTA',
  },
  /*
   * `ITFAP` es como el BCP rotula el mismo impuesto —`BT-ITFAP TRA 0000`—, y el
   * `\b` final impedía reconocerlo: dentro de `ITFAP` no hay frontera después de
   * `ITF`. Se nombra el sufijo en lugar de aflojar la frontera, que es lo que
   * habría hecho que la regla saltara con cualquier palabra que llevara «itf»
   * dentro.
   */
  {
    patron: /\bBT[-\s]?ITFAP\b|\bITF(?:AP)?\b/u,
    salida: ['GASTOS.FINANCIEROS.ITF', 'GASTOS.FINANCIEROS.COMISIONES'],
    entrada: ['INGRESOS.REVERSO'],
    porque: 'la glosa declara el impuesto a las transacciones financieras',
    certeza: 'ALTA',
  },
  {
    patron:
      /\b(?:AFP|GESTORA\s+PUBLICA|FUTURO\s+DE\s+BOLIVIA|PREVISION\s+BBVA|APORTES?\s+JUBILAC)/u,
    salida: ['GASTOS.LABORALES.PENSIONES'],
    entrada: [],
    porque: 'la glosa declara un aporte al sistema de pensiones',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:CNS|CAJA\s+NACIONAL\s+DE\s+SALUD|CAJA\s+PETROLERA|CORDES|SEGURO\s+SOCIAL)\b/u,
    salida: ['GASTOS.LABORALES.SALUD'],
    entrada: [],
    porque: 'la glosa declara un aporte al seguro social de corto plazo',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:ADUANA|ANB|DUI\b|POLIZA\s+DE\s+IMPORTACION|TRIBUTO\s+ADUANERO)\b/u,
    salida: ['GASTOS.COMEX.ADUANA'],
    entrada: [],
    porque: 'la glosa declara un tributo o trámite aduanero',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:MULTA|INFRACCION|SANCION|BOLETA\s+DE\s+TRANSITO)\b/u,
    salida: ['GASTOS.MULTAS'],
    entrada: [],
    porque: 'la glosa declara una multa o sanción',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:SEGIP|SERECI|DERECHOS\s+REALES|TRAMITE\s+MUNICIPAL|ALCALDIA|GAMSC|GAMLP)\b/u,
    salida: ['GASTOS.IMPUESTOS'],
    entrada: [],
    porque: 'la glosa declara una tasa o trámite estatal',
    certeza: 'MEDIA',
  },
];
