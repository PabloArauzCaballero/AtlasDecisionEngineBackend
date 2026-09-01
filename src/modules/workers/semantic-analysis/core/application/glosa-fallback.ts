import { Injectable } from '@nestjs/common';

/**
 * La red de seguridad: qué es un movimiento cuando el modelo no lo sabe decir.
 *
 * ## Por qué existe
 *
 * El clasificador semántico entiende de COMERCIOS y de conceptos. Un extracto
 * real está lleno de movimientos que no nombran ninguno: `TRASPASO CA/CC CON QR
 * (MOVIL) Nota: TRASP.CTAS.TERCEROS ARAUZ CABALLERO PABLO` no dice qué se
 * compró, dice que se transfirió dinero a una persona. Pedirle al modelo que
 * adivine el concepto es pedirle lo que la glosa no trae; lo que la glosa SÍ
 * trae —el instrumento: traspaso, QR, ACH, retiro, depósito, comercio
 * electrónico— es un dato explícito, literal y estable en todos los bancos
 * bolivianos, y se lee con reglas, no con embeddings.
 *
 * ## Dos capas, y el orden entre ellas no es negociable
 *
 * - **RUBRO.** La glosa nombra el concepto: `YPFB`, `ELFEC`, `IMPUESTOS
 *   NACIONALES`, `AFP FUTURO`, `ALQUILER`, `NETFLIX`. Aquí el texto dice en qué
 *   se gastó, no sólo cómo se movió el dinero, y por eso es una afirmación
 *   fuerte: tan fuerte que se puede resolver SIN consultar al modelo (ver
 *   `certeza`). Gana siempre a la capa de instrumento porque `PAGO SERVICIO
 *   ELFEC` es electricidad antes que «un pago».
 * - **INSTRUMENTO.** La glosa sólo declara el vehículo: traspaso, QR, POS,
 *   retiro, comisión. Es cierto pero pobre, y sólo se usa cuando ningún rubro
 *   casó.
 *
 * ## Por qué reglas y no más ejemplos en el catálogo
 *
 * Se intentó por ahí y no basta, porque el problema no es de vocabulario: dos
 * glosas idénticas salvo el nombre del titular tienen que caer en el mismo sitio
 * SIEMPRE, y un modelo por similitud las deja rondando el umbral. Una regla
 * sobre el instrumento es determinista: el mismo texto da el mismo resultado hoy
 * y dentro de un año, y se puede leer y discutir sin ejecutar nada.
 *
 * ## Qué NO hace
 *
 * No compite con el modelo salvo donde es más fiable que él —los rubros de
 * `certeza: 'ALTA'`, que son nombres propios de empresas y trámites bolivianos—.
 * Y no finge precisión: `GASTOS.TRANSFERENCIAS` afirma «salió dinero por
 * transferencia», que es exactamente lo que consta, y no inventa que fuera
 * alquiler o comida. El resultado se marca con su `origen` para que nadie
 * confunda «lo dice el instrumento» con «lo entendió el modelo».
 *
 * ## El último escalón
 *
 * Si ninguna regla aplica, cae en `GASTOS.OTROS` / `INGRESOS.OTROS` según el
 * sentido. Eso es deliberado: «otros gastos» es una categoría que existe en
 * cualquier contabilidad y se puede sumar, mientras que «sin determinar» no es
 * nada y obliga a quien recibe el informe a decidir por su cuenta qué hacer con
 * la fila. Un movimiento sin concepto sigue siendo dinero que salió.
 */

/** Confianza de un rubro nombrado en la glosa. Alta a propósito: es literal. */
const CONFIANZA_RUBRO = 0.86;

/** Confianza que se publica para una decisión por instrumento. */
const CONFIANZA_REGLA = 0.75;

/** Confianza del último escalón: es un cajón, y se dice que lo es. */
const CONFIANZA_CAJON = 0.4;

/** Marca de que un movimiento SALIÓ, tal como lo escriben los bancos. */
const SALIDA = /^(?:DEBITO|CARGO|RETIRO|PAGO|COMPRA|N\/D)\b|\bDEBITO\b/u;
/** Marca de que un movimiento ENTRÓ. */
const ENTRADA = /^(?:CREDITO|ABONO|DEPOSITO|N\/C)\b|\bCREDITO\b|\bABONO\b/u;

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

interface Regla {
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

/**
 * Capa 1: RUBROS. Lo que la glosa nombra por su nombre.
 *
 * Están escritos con los proveedores, trámites y marcas que aparecen de verdad
 * en los extractos bolivianos. Un nombre propio no es ambiguo: `SAGUAPAC` es
 * agua en Santa Cruz y no puede ser otra cosa, y por eso estas reglas son las
 * únicas autorizadas a saltarse el modelo.
 *
 * El orden importa dentro de la lista: lo más específico primero.
 */
const RUBROS: readonly Regla[] = [
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
  {
    patron:
      /\b(?:YPFB|EMCOGAS|GAS\s+DOMICILIARIO|GARRAFA)\b(?!.*\b(?:GASOLINA|DIESEL|SURTIDOR)\b)/u,
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

  // --- Transporte ----------------------------------------------------------
  {
    patron:
      /\b(?:GASOLINA|DIESEL|SURTIDOR|ESTACION\s+DE\s+SERVICIO|COMBUSTIBLE|PETROBRAS|SHELL|GNV)\b/u,
    salida: ['GASTOS.TRANSPORTE.COMBUSTIBLE'],
    entrada: [],
    porque: 'la glosa declara la compra de combustible',
    certeza: 'ALTA',
  },
  {
    patron: /\bSOAT\b/u,
    salida: ['GASTOS.TRANSPORTE.SEGURO', 'GASTOS.FINANCIEROS.SEGUROS'],
    entrada: [],
    porque: 'la glosa nombra el seguro obligatorio de accidentes de tránsito',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:TAXI|YANGO|UBER|INDRIVE|TRUFI|MICRO|PUMAKATARI|TELEFERICO|MI\s+TELEFERICO)\b/u,
    salida: ['GASTOS.TRANSPORTE.PUBLICO'],
    entrada: [],
    porque: 'la glosa nombra un servicio de transporte de pasajeros',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:PARQUEO|ESTACIONAMIENTO|PARKING)\b/u,
    salida: ['GASTOS.TRANSPORTE.ESTACIONAMIENTO'],
    entrada: [],
    porque: 'la glosa declara un parqueo',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:TALLER|MECANIC|LUBRICENTRO|LLANTER|VULCANIZ|ALINEACION|BALANCEO)/u,
    salida: ['GASTOS.TRANSPORTE.TALLER'],
    entrada: [],
    porque: 'la glosa nombra un taller mecánico',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:REPUESTOS?|AUTOPARTES|ACCESORIOS\s+AUTOMOTRIZ)\b/u,
    salida: ['GASTOS.TRANSPORTE.REPUESTOS'],
    entrada: [],
    porque: 'la glosa nombra la compra de repuestos',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:ROSETA|INSPECCION\s+TECNICA|RUAT|PLACA|TRANSITO)\b/u,
    salida: ['GASTOS.TRANSPORTE.TRAMITES'],
    entrada: [],
    porque: 'la glosa declara un trámite vehicular',
    certeza: 'MEDIA',
  },

  // --- Alimentación --------------------------------------------------------
  {
    patron:
      /\b(?:HIPERMAXI|FIDALGA|IC\s*NORTE|KETAL|TIA\b|SUPERMERCADO|MERCADO|MINIMARKET|ABASTO)\b/u,
    salida: ['GASTOS.ALIMENTACION.SUPERMERCADO'],
    entrada: [],
    porque: 'la glosa nombra un supermercado o mercado de abasto',
    certeza: 'ALTA',
  },
  {
    patron:
      /\b(?:RESTAURANT|CHURRASQUERIA|PIZZER|BURGER|POLLOS?\s+COPACABANA|KFC|SUBWAY|PEDIDOSYA|YAIGO|DELIVERY|ALMUERZO)\b/u,
    salida: ['GASTOS.ALIMENTACION.RESTAURANTES'],
    entrada: [],
    porque: 'la glosa nombra un restaurante o un pedido de comida',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:CAFE|CAFETERIA|STARBUCKS|ALEXANDER\s+COFFEE|VAINILLA|HELADERIA|PANADERIA)\b/u,
    salida: ['GASTOS.ALIMENTACION.CAFETERIA'],
    entrada: [],
    porque: 'la glosa nombra una cafetería o panadería',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:LICORERIA|CERVECERIA|BODEGA\s+DE\s+VINOS|DESTILERIA)\b/u,
    salida: ['GASTOS.ALIMENTACION.LICORERIA'],
    entrada: [],
    porque: 'la glosa nombra una licorería',
    certeza: 'ALTA',
  },

  // --- Salud ---------------------------------------------------------------
  {
    patron: /\b(?:FARMACIA|FARMACORP|CHAVEZ|BOLIVIANA\s+DE\s+FARMACIAS|BOTICA|DROGUERIA)\b/u,
    salida: ['GASTOS.SALUD.FARMACIA'],
    entrada: [],
    porque: 'la glosa nombra una farmacia',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:CLINICA|HOSPITAL|CONSULTORIO|ODONTOLOG|DENTAL|MEDICO|LABORATORIO\s+CLINICO)\b/u,
    salida: ['GASTOS.SALUD.ATENCION'],
    entrada: [],
    porque: 'la glosa nombra una atención médica',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:OPTICA|LENTES|OFTALMOLOG)/u,
    salida: ['GASTOS.SALUD.OPTICA'],
    entrada: [],
    porque: 'la glosa nombra una óptica',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:ECOGRAFIA|TOMOGRAFIA|RESONANCIA|RADIOGRAFIA|IMAGENOLOGIA|RAYOS\s*X)\b/u,
    salida: ['GASTOS.SALUD.IMAGENOLOGIA'],
    entrada: [],
    porque: 'la glosa nombra un estudio por imágenes',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:FISIOTERAPIA|KINESIOLOG|PSICOLOG|TERAPIA|REHABILITACION)/u,
    salida: ['GASTOS.SALUD.TERAPIA'],
    entrada: [],
    porque: 'la glosa nombra una terapia',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:EMERGENCIA|AMBULANCIA|URGENCIAS)\b/u,
    salida: ['GASTOS.SALUD.EMERGENCIA'],
    entrada: [],
    porque: 'la glosa declara una atención de emergencia',
    certeza: 'MEDIA',
  },

  // --- Educación -----------------------------------------------------------
  {
    patron:
      /\b(?:COLEGIO|UNIVERSIDAD|UAGRM|UPSA|UCB|UMSA|UMSS|UNIFRANZ|UTEPSA|NUR\b|INSTITUTO|MENSUALIDAD|PENSION\s+ESCOLAR|MATRICULA|GUARDERIA|PREUNIVERSITARIO|CURSO|DIPLOMADO|MAESTRIA)\b/u,
    salida: ['GASTOS.EDUCACION'],
    entrada: [],
    porque: 'la glosa nombra una institución educativa o una cuota de estudios',
    certeza: 'ALTA',
  },

  // --- Ocio y suscripciones ------------------------------------------------
  {
    patron:
      /\b(?:NETFLIX|SPOTIFY|DISNEY|HBO|MAX\b|PRIME\s+VIDEO|YOUTUBE\s+PREMIUM|APPLE\.COM\/BILL|ICLOUD|GOOGLE\s*\*|MICROSOFT\s*\*|OPENAI|CHATGPT|CANVA|ADOBE|DROPBOX|SUSCRIPCION)\b/u,
    salida: ['GASTOS.OCIO.SUSCRIPCIONES', 'GASTOS.EMPRESARIALES.SOFTWARE'],
    entrada: [],
    porque: 'la glosa nombra una suscripción digital recurrente',
    certeza: 'ALTA',
  },
  {
    patron:
      /\b(?:AGENCIA\s+DE\s+VIAJES|BOA\b|AMASZONAS|ECOJET|LATAM|AVIANCA|COPA\s+AIRLINES|HOTEL|HOSTAL|BOOKING|DESPEGAR|PASAJE\s+AEREO|TICKET\s+AEREO)\b/u,
    salida: ['GASTOS.OCIO.VIAJES'],
    entrada: [],
    porque: 'la glosa nombra un viaje, un pasaje o un alojamiento',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:CINE|CINEMARK|MULTICINE|TEATRO|CONCIERTO|ENTRADAS?\s+EVENTO|ESTADIO)\b/u,
    salida: ['GASTOS.OCIO.EVENTOS'],
    entrada: [],
    porque: 'la glosa nombra un espectáculo o evento',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:STEAM|PLAYSTATION|XBOX|NINTENDO|FREE\s*FIRE|ROBLOX|EPIC\s*GAMES|VIDEOJUEGO)\b/u,
    salida: ['GASTOS.OCIO.VIDEOJUEGOS'],
    entrada: [],
    porque: 'la glosa nombra una plataforma de videojuegos',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:CASINO|BINGO|APUESTA|LOTERIA|BETANO|BET365|TRAGAMONEDAS)\b/u,
    salida: ['GASTOS.OCIO.AZAR'],
    entrada: ['INGRESOS.RECOMPENSA'],
    porque: 'la glosa nombra un juego de azar',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:GIMNASIO|GYM|SMARTFIT|CLUB\s+SOCIAL|CLUB\s+DEPORTIVO|MEMBRESIA)\b/u,
    salida: ['GASTOS.PERSONAL.MEMBRESIAS', 'GASTOS.OCIO.CLUB'],
    entrada: [],
    porque: 'la glosa nombra una membresía o club',
    certeza: 'ALTA',
  },

  // --- Compras -------------------------------------------------------------
  {
    patron: /\b(?:AMAZON|ALIEXPRESS|SHEIN|TEMU|MERCADOLIBRE|EBAY|WISH)\b/u,
    salida: ['GASTOS.COMPRAS.TARJETA'],
    entrada: ['INGRESOS.REVERSO'],
    porque: 'la glosa nombra un comercio electrónico internacional',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:BOUTIQUE|ZAPATERIA|CALZADOS?|VESTIMENTA|ROPA|TEXTIL|MODA)\b/u,
    salida: ['GASTOS.COMPRAS.VESTIMENTA'],
    entrada: [],
    porque: 'la glosa nombra una tienda de ropa o calzado',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:FERRETERIA|MUEBLERIA|ELECTROHOGAR|CASA\s+IDEAS|MULTICENTER|BAZAR)\b/u,
    salida: ['GASTOS.COMPRAS.HOGAR'],
    entrada: [],
    porque: 'la glosa nombra una tienda de artículos para el hogar',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:LIBRERIA|PAPELERIA|IMPRENTA|FOTOCOPIAS)\b/u,
    salida: ['GASTOS.COMPRAS.LIBRERIA'],
    entrada: [],
    porque: 'la glosa nombra una librería o papelería',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:COMPUTADORA|LAPTOP|CELULAR|SMARTPHONE|TECNOLOGIA|ELECTRONICA|INFORMATICA)\b/u,
    salida: ['GASTOS.COMPRAS.TECNOLOGIA'],
    entrada: [],
    porque: 'la glosa nombra la compra de tecnología',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:JOYERIA|RELOJERIA|ORFEBRERIA)\b/u,
    salida: ['GASTOS.COMPRAS.JOYERIA'],
    entrada: [],
    porque: 'la glosa nombra una joyería',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:JUGUETERIA|JUGUETES)\b/u,
    salida: ['GASTOS.COMPRAS.JUGUETERIA'],
    entrada: [],
    porque: 'la glosa nombra una juguetería',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:DEPORTES|MARATHON|ADIDAS|NIKE|PUMA\b|ARTICULOS\s+DEPORTIVOS)\b/u,
    salida: ['GASTOS.COMPRAS.DEPORTES'],
    entrada: [],
    porque: 'la glosa nombra una tienda deportiva',
    certeza: 'ALTA',
  },

  // --- Personal ------------------------------------------------------------
  {
    patron: /\b(?:PELUQUERIA|BARBERIA|SPA\b|SALON\s+DE\s+BELLEZA|ESTETICA|MANICURE)\b/u,
    salida: ['GASTOS.PERSONAL.CUIDADO'],
    entrada: [],
    porque: 'la glosa nombra un servicio de cuidado personal',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:VETERINARIA|PETSHOP|PET\s+SHOP|MASCOTAS|ALIMENTO\s+PARA\s+PERROS)\b/u,
    salida: ['GASTOS.PERSONAL.MASCOTAS'],
    entrada: [],
    porque: 'la glosa nombra un gasto de mascotas',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:LAVANDERIA|TINTORERIA|LAVASECO)\b/u,
    salida: ['GASTOS.PERSONAL.LAVANDERIA'],
    entrada: [],
    porque: 'la glosa nombra una lavandería',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:FUNERARIA|CEMENTERIO|SEPELIO|VELATORIO)\b/u,
    salida: ['GASTOS.PERSONAL.FUNERARIA'],
    entrada: [],
    porque: 'la glosa nombra un servicio funerario',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:DONACION|APORTE\s+VOLUNTARIO|FUNDACION|IGLESIA|DIEZMO|ONG\b)\b/u,
    salida: ['GASTOS.PERSONAL.DONACIONES'],
    entrada: ['INGRESOS.SUBVENCION'],
    porque: 'la glosa declara una donación o aporte voluntario',
    certeza: 'ALTA',
  },

  // --- Ingresos nombrados --------------------------------------------------
  {
    patron: /\b(?:SUELDO|SALARIO|HABERES|PLANILLA|NOMINA|REMUNERACION|AGUINALDO|BONO\s+ANUAL)\b/u,
    salida: ['GASTOS.NOMINA'],
    entrada: ['INGRESOS.SUELDO'],
    porque: 'la glosa declara el pago de haberes',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:FINIQUITO|INDEMNIZACION|DESAHUCIO|BENEFICIOS\s+SOCIALES)\b/u,
    salida: ['GASTOS.LABORALES.FINIQUITO'],
    entrada: ['INGRESOS.FINIQUITO'],
    porque: 'la glosa declara un finiquito o beneficios sociales',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:WESTERN\s+UNION|MONEYGRAM|RIA\b|REMESA|GIRO\s+DEL\s+EXTERIOR|MORE\s+MONEY)\b/u,
    salida: ['GASTOS.REMESA'],
    entrada: ['INGRESOS.REMESA'],
    porque: 'la glosa declara una remesa',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:VIATICO|VIATICOS)\b/u,
    salida: ['GASTOS.EMPRESARIALES.VIATICOS'],
    entrada: ['INGRESOS.VIATICOS'],
    porque: 'la glosa declara viáticos',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:BONO\s+JUANA\s+AZURDUY|RENTA\s+DIGNIDAD|BONO\s+JUANCITO|SUBSIDIO|SUBVENCION)\b/u,
    salida: ['GASTOS.SUBVENCIONES'],
    entrada: ['INGRESOS.SUBSIDIO', 'INGRESOS.SUBVENCION'],
    porque: 'la glosa declara un subsidio o subvención del Estado',
    certeza: 'ALTA',
  },

  // --- Financiero nombrado -------------------------------------------------
  {
    patron: /\b(?:DPF|DEPOSITO\s+A\s+PLAZO|AHORRO\s+PROGRAMADO|CAJA\s+DE\s+AHORRO\s+META)\b/u,
    salida: ['GASTOS.AHORRO'],
    entrada: ['INGRESOS.RESCATE', 'INGRESOS.FINANCIERO'],
    porque: 'la glosa declara un movimiento de ahorro a plazo',
    certeza: 'ALTA',
  },
  {
    patron:
      /\b(?:AMORTIZACION|CUOTA\s+PRESTAMO|CUOTA\s+CREDITO|CUOTA\s+HIPOTEC|CAPITAL\s+E\s+INTERES|PRESTAMO)\b/u,
    salida: ['GASTOS.FINANCIEROS.PRESTAMOS'],
    entrada: ['INGRESOS.PRESTAMO'],
    porque: 'la glosa declara la cuota de un préstamo',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:MORA|INTERES\s+PENAL|PENALIDAD\s+POR\s+ATRASO|GASTOS\s+DE\s+COBRANZA)\b/u,
    salida: ['GASTOS.FINANCIEROS.MORA'],
    entrada: [],
    porque: 'la glosa declara un cargo por mora',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:LEASING|ARRENDAMIENTO\s+FINANCIERO)\b/u,
    salida: ['GASTOS.FINANCIEROS.LEASING'],
    entrada: [],
    porque: 'la glosa declara un leasing',
    certeza: 'ALTA',
  },
  {
    patron:
      /\b(?:SEGURO|POLIZA|ASEGURADORA|ALIANZA\s+SEGUROS|BISA\s+SEGUROS|NACIONAL\s+SEGUROS|CREDINFORM)\b/u,
    salida: ['GASTOS.FINANCIEROS.SEGUROS'],
    entrada: ['INGRESOS.SEGURO'],
    porque: 'la glosa declara una prima o un siniestro de seguro',
    certeza: 'ALTA',
  },
  {
    patron:
      /\b(?:COMPRA\s+VENTA\s+DE\s+MONEDA|CAMBIO\s+DE\s+DIVISA|TIPO\s+DE\s+CAMBIO|MESA\s+DE\s+DINERO|FOREX)\b/u,
    salida: ['GASTOS.FINANCIEROS.CAMBIO'],
    entrada: ['INGRESOS.CAMBIO'],
    porque: 'la glosa declara una operación de cambio de divisa',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:BINANCE|CRIPTO|BITCOIN|USDT|BLOCKCHAIN|WALLET\s+CRIPTO)\b/u,
    salida: ['GASTOS.FINANCIEROS.CRIPTO'],
    entrada: [],
    porque: 'la glosa declara una operación con criptoactivos',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:CONTRACARGO|CHARGEBACK|CONTRA\s*CARGO)\b/u,
    salida: ['GASTOS.FINANCIEROS.CONTRACARGO'],
    entrada: ['INGRESOS.DISPUTA'],
    porque: 'la glosa declara un contracargo',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:EMBARGO|RETENCION\s+JUDICIAL|ORDEN\s+JUDICIAL|JUZGADO|ASISTENCIA\s+FAMILIAR)\b/u,
    salida: ['GASTOS.FINANCIEROS.JUDICIAL'],
    entrada: ['INGRESOS.JUDICIAL'],
    porque: 'la glosa declara una retención u orden judicial',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:LIQUIDACION\s+POS|LIQUIDACION\s+ADQUIRENCIA|ABONO\s+COMERCIO|SETTLEMENT)\b/u,
    salida: ['GASTOS.ADQUIRENCIA'],
    entrada: ['INGRESOS.ADQUIRENCIA'],
    porque: 'la glosa declara una liquidación del adquirente de tarjetas',
    certeza: 'ALTA',
  },

  // --- Empresa, obra y campo ----------------------------------------------
  {
    patron: /\b(?:PUBLICIDAD|MARKETING|FACEBOOK\s*ADS|GOOGLE\s*ADS|META\s+PLATFORMS|PAUTA)\b/u,
    salida: ['GASTOS.EMPRESARIALES.PUBLICIDAD'],
    entrada: [],
    porque: 'la glosa declara un gasto de publicidad',
    certeza: 'ALTA',
  },
  {
    patron:
      /\b(?:CEMENTO|FIERRO|LADRILLO|ARIDOS|CONSTRUCCION|MATERIALES\s+DE\s+OBRA|SOBOCE|FANCESA)\b/u,
    salida: ['GASTOS.CONSTRUCCION.MATERIALES'],
    entrada: [],
    porque: 'la glosa nombra materiales de construcción',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:CONTRATISTA|OBRA\s+CIVIL|SUPERVISION\s+DE\s+OBRA)\b/u,
    salida: ['GASTOS.CONSTRUCCION.CONTRATISTA'],
    entrada: [],
    porque: 'la glosa nombra a un contratista de obra',
    certeza: 'MEDIA',
  },
  {
    patron: /\b(?:FERTILIZANTE|AGROQUIMIC|SEMILLA|UREA|HERBICIDA|PLAGUICIDA|AGROPECUARI)/u,
    salida: ['GASTOS.AGRO.INSUMOS'],
    entrada: [],
    porque: 'la glosa nombra insumos agropecuarios',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:FLETE|TRANSPORTE\s+DE\s+CARGA|COURIER|DHL|FEDEX|LOGISTICA)\b/u,
    salida: ['GASTOS.EMPRESARIALES.LOGISTICA', 'GASTOS.COMEX.FLETE'],
    entrada: [],
    porque: 'la glosa declara un flete o envío de carga',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:HONORARIOS|CONSULTORIA|ASESORIA|ABOGADO|CONTADOR|NOTARIA|AUDITORIA)\b/u,
    salida: ['GASTOS.PROFESIONALES'],
    entrada: ['INGRESOS.INDEPENDIENTE'],
    porque: 'la glosa declara honorarios profesionales',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:PROVEEDOR|FACTURA\s+N|PAGO\s+A\s+PROVEEDORES|ORDEN\s+DE\s+COMPRA)\b/u,
    salida: ['GASTOS.PROVEEDORES'],
    entrada: [],
    porque: 'la glosa declara el pago a un proveedor',
    certeza: 'MEDIA',
  },
  {
    patron: /\b(?:REGALIA|REGALIAS\s+MINERAS|COMIBOL|SENARECOM)\b/u,
    salida: ['GASTOS.MINERIA.REGALIAS'],
    entrada: ['INGRESOS.REGALIAS'],
    porque: 'la glosa declara regalías mineras',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:EXPORTACION|EMBARQUE|BILL\s+OF\s+LADING|CARTA\s+DE\s+CREDITO)\b/u,
    salida: ['GASTOS.COMEX.DESPACHANTE'],
    entrada: ['INGRESOS.EXPORTACION'],
    porque: 'la glosa declara una operación de comercio exterior',
    certeza: 'MEDIA',
  },
  {
    patron: /\b(?:ALMACENAJE|DEPOSITO\s+ADUANERO|BODEGA\s+ALQUILER|WAREHOUSE)\b/u,
    salida: ['GASTOS.EMPRESARIALES.ALMACENAJE'],
    entrada: [],
    porque: 'la glosa declara almacenaje',
    certeza: 'MEDIA',
  },
];

/**
 * Capa 2: INSTRUMENTOS. Cómo se movió el dinero cuando la glosa no dice más.
 *
 * El orden importa: `RETIRO DE EFECTIVO` tiene que ganar a `EFECTIVO` a secas, y
 * `COMPRA EN COMERCIO ELECTRONICO` a `COMPRA`. Se recorre en orden y gana la
 * primera que case.
 */
const INSTRUMENTOS: readonly Regla[] = [
  {
    patron:
      /\bRETIRO\b.*\b(?:EFECTIVO|FONDOS)\b|\bRETIRO\s+(?:ATM|CAJERO)\b|\bATM\b|\bCAJERO\s+AUTOMATICO\b/u,
    salida: ['GASTOS.EFECTIVO'],
    entrada: [],
    porque: 'la glosa declara un retiro de efectivo',
    certeza: 'MEDIA',
  },
  {
    patron: /\bDEPOSITO\b.*\bEFECTIVO\b|\bEFECTIVO\b.*\bDEPOSITO\b/u,
    salida: ['GASTOS.EFECTIVO'],
    entrada: ['INGRESOS.EFECTIVO'],
    porque: 'la glosa declara un movimiento de efectivo por ventanilla o cajero',
    certeza: 'MEDIA',
  },
  {
    patron: /\bVENTANILLA\b|\bCAJA\s+\d+\b|\bATENCION\s+EN\s+CAJA\b/u,
    salida: ['GASTOS.VENTANILLA', 'GASTOS.EFECTIVO'],
    entrada: ['INGRESOS.VENTANILLA', 'INGRESOS.EFECTIVO'],
    porque: 'la glosa declara una operación por ventanilla',
    certeza: 'MEDIA',
  },
  {
    patron: /\bCHEQUE\b|\bN\/?\s*CHEQUE\b|\bCAMARA\s+DE\s+COMPENSACION\b/u,
    salida: ['GASTOS.TRANSFERENCIAS'],
    entrada: ['INGRESOS.CHEQUE'],
    porque: 'la glosa declara un movimiento por cheque',
    certeza: 'MEDIA',
  },
  {
    patron:
      /\bCOMERCIO\s+ELECTRONIC|\bECOMMERCE\b|\bCOMPRA\s+WEB\b|\bCOMPRA\s+ONLINE\b|\bINTERNET\s+PURCHASE\b/u,
    salida: ['GASTOS.COMPRAS.TARJETA'],
    entrada: ['INGRESOS.REVERSO'],
    porque: 'la glosa declara una compra en comercio electrónico',
    certeza: 'MEDIA',
  },
  {
    patron: /\bTIGO\s*MONEY\b|\bBILLETERA\s+MOVIL\b|\bMONEDERO\s+ELECTRONICO\b|\bE-?WALLET\b/u,
    salida: ['GASTOS.TRANSFERENCIAS'],
    entrada: ['INGRESOS.BILLETERA', 'INGRESOS.TRANSFERENCIA'],
    porque: 'la glosa declara un movimiento por billetera móvil',
    certeza: 'MEDIA',
  },
  {
    patron:
      /\bTRASPASO\b|\bTRANSFERENCIA\b|\bTRASP\.?CTAS\b|\bP2P\b|\bACH\b(?!\s*QR)|\bPAGO\s+INMEDIATO\b|\bLIP\b|\bGIRO\s+INTERBANCARIO\b/u,
    salida: ['GASTOS.TRANSFERENCIAS'],
    entrada: ['INGRESOS.TRANSFERENCIA'],
    porque: 'la glosa declara una transferencia entre cuentas',
    certeza: 'MEDIA',
  },
  {
    patron: /\bQR\b/u,
    salida: ['GASTOS.COMPRAS.QR'],
    entrada: ['INGRESOS.QR', 'INGRESOS.TRANSFERENCIA'],
    porque: 'la glosa declara un cobro o pago por QR',
    certeza: 'MEDIA',
  },
  {
    patron:
      /\bDEBITO\s+AUTOMATICO\b|\bPAGO\s+AUTOMATICO\b|\bSERVICIO\s+DE\s+COBRANZA\b|\bRECAUDACION\b/u,
    salida: ['GASTOS.VIVIENDA.SERVICIOS'],
    entrada: [],
    porque: 'la glosa declara un débito automático de servicios',
    certeza: 'MEDIA',
  },
  {
    patron: /\bPOS\b|\bCOMPRA\b|\bCONSUMO\b|\bTARJETA\s+DE\s+(?:DEBITO|CREDITO)\b/u,
    salida: ['GASTOS.COMPRAS.TARJETA'],
    entrada: ['INGRESOS.REVERSO'],
    porque: 'la glosa declara una compra con tarjeta',
    certeza: 'MEDIA',
  },
  {
    patron: /\bCOMISION\b|\bMANTENIMIENTO\b|\bIMPUESTO\b|\bCARGO\s+POR\b|\bPORTES\b|\bEXTRACTO\b/u,
    salida: ['GASTOS.FINANCIEROS.COMISIONES'],
    entrada: ['INGRESOS.REVERSO'],
    porque: 'la glosa declara un cargo del propio banco',
    certeza: 'MEDIA',
  },
  {
    patron: /\bINTERES\b|\bRENDIMIENTO\b|\bCAPITALIZACION\b/u,
    salida: ['GASTOS.FINANCIEROS.PRESTAMOS'],
    entrada: ['INGRESOS.FINANCIERO'],
    porque: 'la glosa declara intereses',
    certeza: 'MEDIA',
  },
  {
    patron: /\bREVERSO\b|\bREVERSION\b|\bANULACION\b|\bDEVOLUCION\b|\bEXTORNO\b/u,
    salida: ['GASTOS.OTROS'],
    entrada: ['INGRESOS.REVERSO'],
    porque: 'la glosa declara la reversión de un movimiento anterior',
    certeza: 'MEDIA',
  },
];

/**
 * Todos los códigos que las reglas pueden proponer, sin repetir.
 *
 * Se exporta para que una prueba pueda comprobarlos contra el árbol sembrado.
 * Es el fallo más fácil de introducir aquí y el más difícil de notar: una regla
 * con `GASTOS.SALUD.FARMACIAS` en plural no casa con nada, no rompe ninguna
 * compilación y sólo se manifiesta como un movimiento que acaba en el cajón sin
 * que nadie sepa por qué.
 */
export function codigosPropuestosPorReglas(): readonly string[] {
  return [
    ...new Set(
      [...RUBROS, ...INSTRUMENTOS].flatMap((regla) => [...regla.salida, ...regla.entrada]),
    ),
  ];
}

export interface DecisionPorRegla {
  readonly categoryCode: string;
  readonly confidence: number;
  readonly rationale: string;
  readonly evidence: string;
  /** Qué capa decidió. La traza no debería tener que deducirlo del texto. */
  readonly origen: OrigenDeRegla;
  /** Si puede resolver sin consultar al modelo. Sólo los rubros literales. */
  readonly certeza: CertezaDeRegla;
  /**
   * `true` cuando el catálogo del tenant no tenía la hoja que la regla pedía y
   * se publicó una alternativa. La decisión sigue siendo válida, pero es menos
   * fina de lo que la regla sabía decir, y quien lea la traza debe saberlo.
   */
  readonly degradado: boolean;
}

/** Cajones del último escalón, por sentido. */
const CAJONES = { SALIDA: 'GASTOS.OTROS', ENTRADA: 'INGRESOS.OTROS' } as const;

/** Raíces, por si el catálogo del tenant es plano y no sembró los cajones. */
const RAICES = { SALIDA: 'GASTOS', ENTRADA: 'INGRESOS' } as const;

/**
 * Mayúsculas y sin tildes.
 *
 * Se pliega UNA vez y todas las reglas se escriben contra el texto plegado. La
 * alternativa —`[óo]` en cada patrón— multiplica los sitios donde olvidarse de
 * una tilde, y ya pasó: `comisión` casaba y `COMISION` no, según qué banco
 * imprimiera el extracto en mayúsculas.
 */
function plegar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toUpperCase();
}

@Injectable()
export class GlosaFallbackClassifier {
  /**
   * Qué es este movimiento según lo que la glosa declara sin lugar a dudas.
   *
   * Devuelve `null` sólo si el catálogo del tenant no tiene NINGUNA categoría
   * utilizable para el sentido del movimiento —ni la hoja de la regla, ni sus
   * ancestros, ni el cajón, ni la raíz—. Eso ya no es una glosa que no se supo
   * leer: es un catálogo sin rama de gastos, y colocar ahí un código inventado
   * sería peor que no clasificar.
   */
  clasificar(texto: string, codigosDisponibles: ReadonlySet<string>): DecisionPorRegla | null {
    const plegado = plegar(texto);
    const sentidoSalida = this.saleDinero(plegado);

    for (const capa of [RUBROS, INSTRUMENTOS]) {
      const origen: OrigenDeRegla = capa === RUBROS ? 'RUBRO' : 'INSTRUMENTO';
      for (const regla of capa) {
        if (!regla.patron.test(plegado)) continue;
        const preferidas = sentidoSalida
          ? regla.salida
          : regla.entrada.length > 0
            ? regla.entrada
            : regla.salida;
        const resuelto = this.resolver(preferidas, codigosDisponibles);
        // Una regla que casó pero cuyo catálogo no tiene dónde ponerla no
        // descarta al resto: puede haber otra regla, más general, que sí encaje.
        if (resuelto === null) continue;
        return {
          categoryCode: resuelto.codigo,
          confidence: origen === 'RUBRO' ? CONFIANZA_RUBRO : CONFIANZA_REGLA,
          rationale: this.explicar(origen, regla, resuelto),
          evidence: this.recorte(texto),
          origen,
          certeza: resuelto.degradado ? 'MEDIA' : regla.certeza,
          degradado: resuelto.degradado,
        };
      }
    }

    const cajon = this.resolver(
      sentidoSalida
        ? [CAJONES.SALIDA, RAICES.SALIDA]
        : [CAJONES.ENTRADA, RAICES.ENTRADA, CAJONES.SALIDA],
      codigosDisponibles,
    );
    if (cajon === null) return null;
    return {
      categoryCode: cajon.codigo,
      confidence: CONFIANZA_CAJON,
      rationale:
        'Ninguna regla de rubro ni de instrumento aplica y el modelo no alcanzó su umbral. Se coloca en «otros» del sentido correspondiente: el concepto no consta, pero el movimiento y su signo sí.',
      evidence: this.recorte(texto),
      origen: 'CAJON',
      certeza: 'MEDIA',
      degradado: false,
    };
  }

  /**
   * El primer código publicable de una lista de preferencias.
   *
   * Prueba cada preferencia y, si no está, sus ANCESTROS por la ruta punteada:
   * un catálogo poco profundo puede tener `GASTOS.VIVIENDA` como hoja aunque no
   * tenga `GASTOS.VIVIENDA.SERVICIOS`, y clasificar en el padre sigue siendo
   * cierto —sólo menos fino—. Lo que nunca hace es bajar ni saltar de rama: un
   * hermano no es una aproximación, es otra afirmación.
   */
  private resolver(
    preferidas: readonly string[],
    disponibles: ReadonlySet<string>,
  ): { codigo: string; degradado: boolean } | null {
    let primera = true;
    for (const preferida of preferidas) {
      const partes = preferida.split('.');
      for (let corte = partes.length; corte > 0; corte -= 1) {
        const codigo = partes.slice(0, corte).join('.');
        if (!disponibles.has(codigo)) continue;
        return { codigo, degradado: !(primera && corte === partes.length) };
      }
      primera = false;
    }
    return null;
  }

  private explicar(
    origen: OrigenDeRegla,
    regla: Regla,
    resuelto: { codigo: string; degradado: boolean },
  ): string {
    const base =
      origen === 'RUBRO'
        ? `Decidido por regla de rubro: ${regla.porque}. Es lo que la glosa nombra literalmente.`
        : `Decidido por regla de instrumento: ${regla.porque}. El modelo no alcanzó su umbral, y esto es lo que la glosa afirma por sí sola.`;
    return resuelto.degradado
      ? `${base} El catálogo de este tenant no tiene ${regla.salida[0] ?? 'la hoja esperada'}, así que se publica ${resuelto.codigo}, que la contiene.`
      : base;
  }

  /**
   * El sentido del movimiento, leído del propio texto.
   *
   * El portal antepone `DEBITO`/`CREDITO` cuando la glosa no lo dice, así que
   * esta marca está presente siempre. Ante la duda se asume SALIDA: en un
   * extracto la mayoría de las filas lo son, y equivocarse hacia el gasto es el
   * error conservador cuando lo que se mide es capacidad de pago.
   */
  private saleDinero(plegado: string): boolean {
    const soloMarcas = sinNombresPropios(plegado);
    if (ENTRADA.test(soloMarcas) && !SALIDA.test(soloMarcas)) return false;
    return true;
  }

  private recorte(texto: string): string {
    return texto.length <= 120 ? texto : `${texto.slice(0, 117)}…`;
  }
}
