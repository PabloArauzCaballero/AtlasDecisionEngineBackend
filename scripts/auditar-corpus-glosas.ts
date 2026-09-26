/**
 * QUÉ HAY DE VERDAD EN EL CORPUS DE GLOSAS, Y QUÉ LE FALTA AL CATÁLOGO.
 *
 * ## Para qué existe
 *
 * La pregunta que contesta no es «¿cuántas categorías tengo?» sino «¿contra qué
 * texto se midió lo que tengo?». Son cosas distintas y se confunden con
 * facilidad, porque la base no distingue entre una glosa que imprimió un banco y
 * una que escribió un sembrador: las dos son filas de la misma tabla, las dos
 * pasaron por el worker de verdad y las dos tienen su `decidedBy` y su
 * confianza.
 *
 * Medido el 2026-09-08 sobre la base local, la diferencia era casi todo el
 * corpus: de 2.841 clasificaciones, 293 tenían detrás un documento real. Un
 * informe de cobertura que no separe las dos poblaciones dice que el catálogo va
 * espléndido, y lo que está midiendo es al sembrador acertando con el texto que
 * él mismo escribió para ser acertado.
 *
 * ## El discriminante, y por qué NO es la procedencia
 *
 * `requested_by` no sirve: `bootstrap-management` sembró glosas inventadas Y las
 * 293 reales en la misma tanda. Lo que sí sirve es exacto y no es heurística:
 *
 *   **una glosa es REAL si aparece, letra por letra, como `description` de un
 *   movimiento de un extracto que se SUBIÓ** (`input_source = UPLOAD`).
 *
 * Detrás de esa cadena hay un PDF que emitió un banco. Detrás de cualquier otra,
 * alguien la escribió.
 *
 * ## Lo que mide, en siete cortes
 *
 * 1. **Procedencia.** El censo, con las tres poblaciones separadas y la cuarta
 *    que nadie cuenta: las glosas CORROMPIDAS por el corrimiento de columna del
 *    BCP, que son texto real de un documento real y aun así no dicen lo que
 *    parece que dicen (la columna que se leyó era el canal).
 * 2. **Cobertura por hoja**, con la evidencia real separada de la sembrada. La
 *    cifra que importa es cuántas hojas no han visto NUNCA un documento.
 * 3. **Quién decidió**: regla, modelo o cajón, y con qué confianza, por población.
 * 4. **Grafo de competencia**, reconstruido de `evaluatedCategoryCodes`: qué
 *    hoja se presenta como candidata una y otra vez y no gana jamás.
 * 5. **Colisión léxica del catálogo**, sin modelo y sin red: qué par de hojas
 *    comparte tanto vocabulario en sus ejemplos que se van a confundir aunque
 *    todavía no lo hayan hecho. Es el detector del caso `PAGO SERVICIOS
 *    CONTABLES`, que se perdía por tres milésimas.
 * 6. **Hueco de vocabulario**: las palabras que los bancos imprimen y el
 *    catálogo no nombra, ordenadas por lo que cuestan. Es la lista accionable.
 * 7. **Veredicto**: qué añadir, a qué hoja, y qué NO añadir.
 *
 * ## Lo que NO hace
 *
 * No escribe nada, ni en la base ni en el catálogo. No llama a ningún modelo ni
 * necesita el servidor de embeddings: todo lo que calcula es aritmética sobre lo
 * que ya está guardado. Eso es a propósito — un informe que necesita la
 * infraestructura arriba se deja de correr justo cuando hace falta.
 *
 * Tampoco INVENTA ejemplos. Lo que propone son cadenas que un banco imprimió, y
 * la razón está medida: lo que a una hoja le falta no es una descripción mejor
 * del concepto, es la forma literal en que su banco lo escribe.
 *
 *   yarn ts-node -P tsconfig.json -T scripts/auditar-corpus-glosas.ts
 *   DATABASE_URL=postgresql://… yarn ts-node -P tsconfig.json -T scripts/auditar-corpus-glosas.ts --json informe.json
 *   … --markdown informe.md --top 40
 */
import { writeFileSync } from 'node:fs';
import { Client } from 'pg';
import { BOLIVIA_INSTITUTIONS } from '../src/modules/workers/bank-statement/core/institutions/bolivia-institutions';

// --- Tipos -----------------------------------------------------------------

interface Categoria {
  readonly code: string;
  readonly name: string;
  readonly parentCode: string | null;
  readonly positiveExamples: readonly string[];
  readonly counterExamples: readonly string[];
  readonly acceptanceThreshold: number;
  readonly esHoja: boolean;
}

interface Clasificacion {
  readonly texto: string;
  readonly requestedBy: string;
  readonly decidedBy: string | null;
  readonly status: string | null;
  readonly categoria: string | null;
  readonly confianza: number | null;
  readonly requiereRevision: boolean;
  readonly motivoRevision: string | null;
  readonly modelo: string | null;
  readonly candidatas: readonly string[];
}

interface MovimientoReal {
  readonly glosa: string;
  readonly institucion: string;
  readonly canal: string | null;
  readonly sentido: string | null;
  readonly fuente: string;
}

// --- Utilidades deterministas ----------------------------------------------

/**
 * Las palabras de una glosa, normalizadas como las normaliza el catálogo.
 *
 * Se tiran los números sueltos y las palabras de menos de tres letras: un
 * importe o una referencia no son vocabulario, son datos de la fila, y dejarlos
 * llenaría el hueco de vocabulario con las 400 referencias distintas de un
 * extracto.
 */
const VACIAS = new Set([
  'del', 'las', 'los', 'por', 'para', 'con', 'sin', 'una', 'que', 'the', 'and',
  'sus', 'esta', 'este', 'entre', 'desde', 'hasta',
]);

/**
 * Donde empieza la CONTRAPARTE de un movimiento, que no es vocabulario.
 *
 * Una glosa de transferencia tiene dos partes con dueños distintos: el concepto,
 * que lo escribe el banco y es lo que el catálogo tiene que aprender, y el
 * bloque de contraparte —nombre, cuenta, banco destino—, que lo escribe el
 * cliente y cambia en cada fila.
 *
 * Separarlas no es higiene, es la medida correcta. Sin este corte, la primera
 * versión de este informe daba como «palabras que le faltan al catálogo»
 * CECILIA, CESPEDES, VILLARROEL, ROMY, JAVIER y FRANCISCO: apellidos de personas
 * reales, propuestos como ejemplos a añadir. Habrían empeorado el catálogo —un
 * apellido no clasifica nada— y de paso habrían metido datos personales en un
 * archivo del repositorio.
 *
 * Se corta por la primera de estas marcas, que es donde todos los formatos
 * medidos abren el bloque: una tirada larga de dígitos (una cuenta o una
 * referencia), o uno de los rótulos con los que el banco lo encabeza.
 *
 * **El corte no puede ser perfecto, y conviene saberlo antes de copiar una
 * palabra al catálogo.** Cuando el titular escribe el nombre en el hueco del
 * concepto —«Transferencia Pago Elenita»— no hay nada posicional que distinga
 * ese nombre de un rubro: ocupa el mismo sitio que ocuparía «Farmacia». El
 * informe los deja pasar a propósito, en vez de inventar una heurística que
 * también se comería rubros legítimos; lo que se propone es una lista para que
 * una persona la mire, no un parche que se aplique solo.
 */
/**
 * El bloque `Nota: NOMBRE (B. BANCO)` del Banco Económico y del Mercantil.
 *
 * Es el segundo formato de contraparte, y no lo cubre el corte por dígitos
 * porque el nombre va DELANTE y el concepto DETRÁS: en «DEBITO ACH QR Nota:
 * RICARDO … TERAN (B. MERCANTIL) Cafe Yande Venta cafe», cortar por la primera
 * marca se llevaría «Cafe Yande», que es justo lo único que clasifica.
 *
 * Se quita el bloque entero y se conserva lo de los dos lados.
 */
const NOTA_CON_CONTRAPARTE = /\bnota\s*:\s*[^()]*\([^)]*\)/giu;

/**
 * La otra forma del mismo bloque: `Nota:` y un nombre en VERSALES, sin banco.
 *
 * «DEPOSITO DE EFECTIVO Nota: CABALLERO ARDAYA KATIA». Se distingue del concepto
 * que escribe un cliente porque va entero en mayúsculas —el nombre lo copia el
 * sistema del titular de la cuenta—, mientras que lo que teclea una persona
 * viene en minúsculas o capitalizado: «Nota: pago alquiler», «Cafe Yande Venta
 * cafe». Es una regularidad del corpus medido, no una ley, y por eso se limita a
 * entre dos y cuatro palabras: un bloque mayor ya no es un nombre.
 */
// Sin la bandera `i`, y a propósito: el rótulo se escribe `Nota` o `NOTA`, pero
// lo que sigue tiene que ir en VERSALES para contar como nombre. Con `i`, el
// patrón se comería también «Nota: pago alquiler», que es un concepto.
const NOTA_CON_NOMBRE_EN_VERSALES =
  /\b[Nn][Oo][Tt][Aa]\s*:\s*(?:[A-ZÁÉÍÓÚÑ]{2,}\s+){1,3}[A-ZÁÉÍÓÚÑ]{2,}\s*$/gu;

/**
 * Los nombres del padrón de ASFI, que no son vocabulario de gasto.
 *
 * Toda transferencia interbancaria imprime el banco de la contraparte, así que
 * `MERCANTIL`, `GANADERO` y `ECONOMICO` salen entre las palabras más frecuentes
 * que el catálogo no nombra — y añadirlas como ejemplos enseñaría a clasificar
 * por el banco del vecino. Se leen del padrón compilado y no de una lista
 * escrita aquí: si mañana entra una cooperativa nueva, entra sola.
 */
const PALABRAS_DE_INSTITUCION = new Set(
  BOLIVIA_INSTITUTIONS.flatMap((institucion) => palabras(institucion.name)),
);

const INICIO_DE_CONTRAPARTE =
  /\d{6,}|\bcuenta\s+destino\b|\bnombre\s*\(?s?\)?\s*:|\bbanco\s*:|\s-\s*banco\s|\bdato\s+adicional\b|\bbeneficiario\b/iu;

export function sinContraparte(glosa: string): string {
  const sinNota = glosa
    .replace(NOTA_CON_CONTRAPARTE, ' ')
    .replace(NOTA_CON_NOMBRE_EN_VERSALES, ' ');
  const marca = INICIO_DE_CONTRAPARTE.exec(sinNota);
  return marca === null ? sinNota : sinNota.slice(0, marca.index);
}

/**
 * La glosa como se puede imprimir en un informe: sin cuentas ni referencias.
 *
 * Este archivo se corre sobre datos de producción y su salida acaba pegada en un
 * ticket. Una tirada de seis dígitos o más es una cuenta o una referencia, y
 * ninguna de las dos hace falta para entender por qué una glosa se clasificó mal.
 */
function enmascarar(glosa: string, largo = 110): string {
  const limpio = glosa.replace(/\d{6,}/gu, (encontrado) => '•'.repeat(Math.min(8, encontrado.length)));
  return limpio.length <= largo ? limpio : `${limpio.slice(0, largo)}…`;
}

function palabras(texto: string): string[] {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/u)
    .filter((palabra) => palabra.length >= 3 && !/^\d+$/u.test(palabra))
    .filter((palabra) => !VACIAS.has(palabra.toLowerCase()));
}

/**
 * Cuánto se parece esto a lo que imprime un banco, entre 0 y 1.
 *
 * NO decide la procedencia —esa se sabe con exactitud cruzando contra los
 * extractos— y **está medido que tampoco podría**: el 2026-09-08 el texto
 * sembrado puntúa 0,314 y el real 0,296. El sembrador imita bien la FORMA, con
 * sus DEBITO, sus ACH y sus referencias largas.
 *
 * Se conserva justamente por eso, y el resultado es la mitad del argumento: si
 * la forma no distingue, mirar la glosa no basta para saber si un corpus es
 * real, y quien quiera ampliarlo generando texto va a producir algo que pasa
 * esta prueba y no enseña nada. Lo único que separa las dos poblaciones es
 * tener detrás un PDF que emitió un banco.
 */
const SENAS_DE_BANCO: readonly (readonly [RegExp, number])[] = [
  [/\bN\/[DC]\b/u, 3], // las marcas contables
  [/\b(ACH|POS|QR|ATM|KSC|CTA|CA\/CC)\b/u, 3], // códigos de canal e instrumento
  [/\b(DEBITO|CREDITO|ABONO|CARGO|TRASPASO)\b/u, 2],
  [/\d{6,}/u, 2], // referencias largas
  [/\b[A-Z]{2,}\/[A-Z]{2,}/u, 2], // WEB/MOV
  [/\b[BCDFGHJKLMNPQRSTVWXYZ]{4,}\b/u, 1], // abreviaturas sin vocales: COMIS, TRANSF
  [/^[A-Z0-9 .,\/\-]+$/u, 1], // todo en mayúsculas, como sale del sistema del banco
];

function dialectoBancario(texto: string): number {
  const total = SENAS_DE_BANCO.reduce((suma, [, peso]) => suma + peso, 0);
  const suma = SENAS_DE_BANCO.reduce(
    (acumulado, [patron, peso]) => acumulado + (patron.test(texto) ? peso : 0),
    0,
  );
  return Number((suma / total).toFixed(3));
}

/**
 * Una glosa que sólo nombra el CANAL no describe el movimiento.
 *
 * Es el residuo del corrimiento de columna del BCP: texto real, de un documento
 * real, que aun así no dice en qué se gastó. Cuentan aparte porque inflan la
 * cobertura sin aportar ni una decisión correcta — y porque si vuelven a
 * aparecer, el parser se rompió otra vez.
 */
const SOLO_CANAL =
  /^(DEBITO|CREDITO)?\s*(AGENCIA|BANCA MOVIL|TARJETA DE DEBITO|CAJERO( AUTOMATICO)?|WEB|MOVIL|AUTOMATICO|DE:\s*BANCA MOVIL|TRANSFERENCIA( INTERBANCARIA)?)\s*$/iu;

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let comunes = 0;
  for (const item of a) if (b.has(item)) comunes += 1;
  return comunes / (a.size + b.size - comunes);
}

function porcentaje(parte: number, total: number): string {
  return total === 0 ? '—' : `${((parte / total) * 100).toFixed(1)} %`;
}

// --- Lectura ---------------------------------------------------------------

async function leerCatalogo(db: Client): Promise<Categoria[]> {
  const { rows } = await db.query<{
    code: string;
    name: string;
    parent_code: string | null;
    positive_examples: unknown;
    counter_examples: unknown;
    acceptance_threshold: string;
  }>(
    `select code, name, parent_code, positive_examples, counter_examples, acceptance_threshold
       from decision_semantic_category where is_active order by code`,
  );
  const conHijos = new Set(rows.map((fila) => fila.parent_code).filter((x): x is string => x !== null));
  return rows.map((fila) => ({
    code: fila.code,
    name: fila.name,
    parentCode: fila.parent_code,
    positiveExamples: comoTextos(fila.positive_examples),
    counterExamples: comoTextos(fila.counter_examples),
    acceptanceThreshold: Number(fila.acceptance_threshold),
    esHoja: !conHijos.has(fila.code),
  }));
}

function comoTextos(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor
    .map((item) => (typeof item === 'string' ? item : (item as { text?: unknown })?.text))
    .filter((item): item is string => typeof item === 'string');
}

async function leerClasificaciones(db: Client): Promise<Clasificacion[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `select input_text, requested_by,
            result_json->>'decidedBy'      as decided_by,
            result_json->>'status'         as status,
            result_json->'matches'->0->>'categoryCode' as categoria,
            result_json->'matches'->0->>'confidence'   as confianza,
            result_json->>'requiresReview' as requiere_revision,
            result_json->>'reviewReason'   as motivo_revision,
            result_json->>'model'          as modelo,
            result_json->'evaluatedCategoryCodes' as candidatas
       from decision_semantic_analysis_run
      where result_json is not null`,
  );
  return rows.map((fila) => ({
    texto: String(fila.input_text ?? ''),
    requestedBy: String(fila.requested_by ?? ''),
    decidedBy: (fila.decided_by as string | null) ?? null,
    status: (fila.status as string | null) ?? null,
    categoria: (fila.categoria as string | null) ?? null,
    confianza: fila.confianza === null ? null : Number(fila.confianza),
    requiereRevision: fila.requiere_revision === 'true',
    motivoRevision: (fila.motivo_revision as string | null) ?? null,
    modelo: (fila.modelo as string | null) ?? null,
    candidatas: Array.isArray(fila.candidatas) ? (fila.candidatas as string[]) : [],
  }));
}

async function leerMovimientosReales(db: Client): Promise<MovimientoReal[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `select coalesce(r.institution_id, '—') as institucion,
            r.input_source::text            as fuente,
            t->>'description'               as glosa,
            t->>'channel'                   as canal,
            t->>'movementType'              as sentido
       from decision_bank_statement_run r,
            lateral jsonb_array_elements((r.result_json->'transactions')::jsonb) t
      where r.transaction_count > 0 and t->>'description' is not null`,
  );
  return rows.map((fila) => ({
    glosa: String(fila.glosa ?? ''),
    institucion: String(fila.institucion ?? '—'),
    canal: (fila.canal as string | null) ?? null,
    sentido: (fila.sentido as string | null) ?? null,
    fuente: String(fila.fuente ?? ''),
  }));
}

// --- Los siete cortes -------------------------------------------------------

interface Informe {
  readonly procedencia: ReturnType<typeof cortarProcedencia>;
  readonly cobertura: ReturnType<typeof cortarCobertura>;
  readonly decisiones: ReturnType<typeof cortarDecisiones>;
  readonly competencia: ReturnType<typeof cortarCompetencia>;
  readonly colisiones: ReturnType<typeof cortarColisiones>;
  readonly vocabulario: ReturnType<typeof cortarVocabulario>;
}

/**
 * 1. Procedencia — quién escribió cada glosa del corpus.
 *
 * El corte que sostiene todos los demás. `reales` son las cadenas atestiguadas
 * en un PDF que alguien subió; `sembradas`, todo lo demás. `corrompidas` es el
 * subconjunto de las reales que sólo nombra el canal: son de un documento de
 * verdad y aun así no describen nada.
 */
function cortarProcedencia(
  clasificaciones: readonly Clasificacion[],
  movimientos: readonly MovimientoReal[],
) {
  const subidas = movimientos.filter((m) => m.fuente === 'UPLOAD');
  const glosasReales = new Set(subidas.map((m) => m.glosa));

  const reales = clasificaciones.filter((c) => glosasReales.has(c.texto));
  const sembradas = clasificaciones.filter((c) => !glosasReales.has(c.texto));
  const corrompidas = clasificaciones.filter((c) => SOLO_CANAL.test(c.texto));

  const media = (lista: readonly { texto: string }[]): number =>
    lista.length === 0
      ? 0
      : Number(
          (lista.reduce((s, item) => s + dialectoBancario(item.texto), 0) / lista.length).toFixed(3),
        );

  const porInstitucion = new Map<string, { movimientos: number; glosasDistintas: Set<string> }>();
  for (const mov of subidas) {
    const entrada = porInstitucion.get(mov.institucion) ?? {
      movimientos: 0,
      glosasDistintas: new Set<string>(),
    };
    entrada.movimientos += 1;
    entrada.glosasDistintas.add(mov.glosa);
    porInstitucion.set(mov.institucion, entrada);
  }

  return {
    clasificacionesTotales: clasificaciones.length,
    movimientosReales: subidas.length,
    movimientosDeFixture: movimientos.length - subidas.length,
    glosasRealesDistintas: glosasReales.size,
    glosasRealesClasificadas: new Set(reales.map((c) => c.texto)).size,
    clasificadasSobreTextoReal: reales.length,
    clasificadasSobreTextoSembrado: sembradas.length,
    /** La cifra que decide si el corpus vale: qué fracción se midió contra un banco. */
    fraccionReal: Number((reales.length / Math.max(1, clasificaciones.length)).toFixed(4)),
    corrompidasSoloCanal: corrompidas.length,
    dialectoMedioReal: media(reales),
    dialectoMedioSembrado: media(sembradas),
    porRequestedBy: agrupar(clasificaciones, (c) => c.requestedBy),
    porInstitucion: [...porInstitucion.entries()]
      .map(([institucion, datos]) => ({
        institucion,
        movimientos: datos.movimientos,
        glosasDistintas: datos.glosasDistintas.size,
      }))
      .sort((a, b) => b.movimientos - a.movimientos),
  };
}

/**
 * 2. Cobertura por hoja, con la evidencia real separada de la sembrada.
 *
 * «Hoja muerta» no significa hoja inútil: significa hoja cuya definición nadie
 * ha contrastado nunca con un documento. Puede estar perfecta; lo que no puede
 * es presentarse como probada.
 */
function cortarCobertura(
  catalogo: readonly Categoria[],
  clasificaciones: readonly Clasificacion[],
  glosasReales: ReadonlySet<string>,
) {
  const hojas = catalogo.filter((c) => c.esHoja);
  const conteo = new Map<string, { real: number; sembrada: number }>();
  for (const hoja of hojas) conteo.set(hoja.code, { real: 0, sembrada: 0 });

  for (const item of clasificaciones) {
    if (item.categoria === null) continue;
    const entrada = conteo.get(item.categoria);
    if (entrada === undefined) continue;
    if (glosasReales.has(item.texto)) entrada.real += 1;
    else entrada.sembrada += 1;
  }

  const filas = hojas
    .map((hoja) => ({
      code: hoja.code,
      name: hoja.name,
      ejemplos: hoja.positiveExamples.length,
      contraejemplos: hoja.counterExamples.length,
      umbral: hoja.acceptanceThreshold,
      ...(conteo.get(hoja.code) ?? { real: 0, sembrada: 0 }),
    }))
    .sort((a, b) => b.real - a.real || b.sembrada - a.sembrada);

  const conReal = filas.filter((f) => f.real > 0);
  const totalReal = filas.reduce((s, f) => s + f.real, 0);
  const acumulado = [...filas].sort((a, b) => b.real - a.real);
  let suma = 0;
  let hojasParaLaMitad = 0;
  for (const fila of acumulado) {
    if (suma >= totalReal / 2) break;
    suma += fila.real;
    hojasParaLaMitad += 1;
  }

  return {
    hojas: hojas.length,
    hojasConEvidenciaReal: conReal.length,
    hojasMuertas: hojas.length - conReal.length,
    movimientosRealesClasificados: totalReal,
    /** Concentración: cuántas hojas se reparten la mitad de la evidencia real. */
    hojasQueConcentranLaMitad: hojasParaLaMitad,
    /** Hojas sin un solo ejemplo o sin un solo contraejemplo: deuda del catálogo. */
    hojasSinContraejemplos: filas.filter((f) => f.contraejemplos === 0).map((f) => f.code),
    filas,
  };
}

/** 3. Quién decidió, con qué confianza y cuánto se escaló, población por población. */
function cortarDecisiones(
  clasificaciones: readonly Clasificacion[],
  glosasReales: ReadonlySet<string>,
) {
  const resumir = (lista: readonly Clasificacion[]) => {
    const confianzas = lista
      .map((c) => c.confianza)
      .filter((c): c is number => c !== null)
      .sort((a, b) => a - b);
    return {
      total: lista.length,
      porDecisor: agrupar(lista, (c) => c.decidedBy ?? 'SIN_DECISOR'),
      porEstado: agrupar(lista, (c) => c.status ?? 'SIN_ESTADO'),
      requierenRevision: lista.filter((c) => c.requiereRevision).length,
      porMotivoRevision: agrupar(
        lista.filter((c) => c.motivoRevision !== null),
        (c) => c.motivoRevision ?? '',
      ),
      /** El atajo: cuántas se resolvieron sin preguntarle a un modelo. */
      atajoDeRegla: lista.filter((c) => c.modelo === 'rule-fast-path').length,
      confianzaMediana: confianzas.length === 0 ? null : confianzas[Math.floor(confianzas.length / 2)],
      confianzaP10: confianzas.length === 0 ? null : confianzas[Math.floor(confianzas.length * 0.1)],
    };
  };

  return {
    real: resumir(clasificaciones.filter((c) => glosasReales.has(c.texto))),
    sembrada: resumir(clasificaciones.filter((c) => !glosasReales.has(c.texto))),
  };
}

/**
 * 4. Grafo de competencia, reconstruido de `evaluatedCategoryCodes`.
 *
 * El resultado guardado solo conserva a la GANADORA. `matches` nunca trae mas de
 * una, asi que la distancia entre la primera y la segunda no se puede recuperar.
 * Lo que si queda es quienes competian, y eso ya contesta dos preguntas que
 * valen dinero:
 *
 * - **La perdedora cronica.** Una hoja que se presenta veinte veces como
 *   candidata y no gana nunca no es una hoja: es vocabulario que pertenece a
 *   otra. Fusionarla, o convertir sus ejemplos en contraejemplos de quien le
 *   gana, quita una colision sin perder nada.
 * - **El par que siempre aparece junto.** Dos hojas que se citan en casi todas
 *   sus candidaturas comparten dominio. Ahi es donde un ejemplo nuevo ayuda
 *   menos y un contraejemplo ayuda mas.
 */
function cortarCompetencia(clasificaciones: readonly Clasificacion[]) {
  const candidaturas = new Map<string, number>();
  const victorias = new Map<string, number>();
  const pares = new Map<string, number>();

  for (const item of clasificaciones) {
    if (item.candidatas.length === 0) continue;
    for (const codigo of item.candidatas) {
      candidaturas.set(codigo, (candidaturas.get(codigo) ?? 0) + 1);
    }
    if (item.categoria !== null) {
      victorias.set(item.categoria, (victorias.get(item.categoria) ?? 0) + 1);
      for (const codigo of item.candidatas) {
        if (codigo === item.categoria) continue;
        const clave = `${item.categoria} ${codigo}`;
        pares.set(clave, (pares.get(clave) ?? 0) + 1);
      }
    }
  }

  const perdedorasCronicas = [...candidaturas.entries()]
    .map(([code, veces]) => ({ code, candidaturas: veces, victorias: victorias.get(code) ?? 0 }))
    .filter((fila) => fila.candidaturas >= 5 && fila.victorias === 0)
    .sort((a, b) => b.candidaturas - a.candidaturas);

  const rivalidades = [...pares.entries()]
    .map(([clave, veces]) => {
      const [ganadora, perdedora] = clave.split(' ');
      return { ganadora: ganadora ?? '', perdedora: perdedora ?? '', veces };
    })
    .sort((a, b) => b.veces - a.veces);

  const conCandidatas = clasificaciones.filter((c) => c.candidatas.length > 0);
  return {
    clasificacionesConCandidatas: conCandidatas.length,
    candidatasPorGlosa: Number(
      (
        clasificaciones.reduce((s, c) => s + c.candidatas.length, 0) /
        Math.max(1, conCandidatas.length)
      ).toFixed(2),
    ),
    perdedorasCronicas,
    rivalidades,
  };
}

/**
 * 5. Colision lexica del catalogo, sin modelo, sin red y sin esperar al fallo.
 *
 * Los cortes anteriores miran lo que YA paso. Este mira lo que va a pasar: dos
 * hojas cuyos ejemplos comparten la mayor parte del vocabulario van a puntuar
 * casi igual ante la misma glosa, la vayan a ver o no. Es exactamente el caso
 * medido de `PAGO SERVICIOS CONTABLES` (0,9167 contra 0,9140, tres milesimas, y
 * el movimiento perdido) y se puede detectar antes de perder ninguno.
 *
 * Se compara con Jaccard sobre el vocabulario de los EJEMPLOS, que es lo que el
 * recuperador ve. Los contraejemplos no entran: su trabajo es justamente separar
 * lo que aqui sale junto, asi que contarlos taparia el sintoma. Lo que si se
 * mira es SI EXISTEN, porque un par que colisiona sin contraejemplos en ninguno
 * de los dos lados es el que se va a perder.
 */
function cortarColisiones(catalogo: readonly Categoria[], umbral: number) {
  const hojas = catalogo
    .filter((c) => c.esHoja)
    .map((hoja) => ({
      code: hoja.code,
      vocabulario: new Set(hoja.positiveExamples.flatMap((ejemplo) => palabras(ejemplo))),
      contraejemplos: hoja.counterExamples.length,
    }))
    .filter((hoja) => hoja.vocabulario.size > 0);

  const colisiones: {
    a: string;
    b: string;
    solape: number;
    palabrasComunes: string[];
    seDefienden: boolean;
  }[] = [];

  for (let i = 0; i < hojas.length; i += 1) {
    for (let j = i + 1; j < hojas.length; j += 1) {
      const primera = hojas[i];
      const segunda = hojas[j];
      if (primera === undefined || segunda === undefined) continue;
      const solape = jaccard(primera.vocabulario, segunda.vocabulario);
      if (solape < umbral) continue;
      const comunes = [...primera.vocabulario].filter((palabra) => segunda.vocabulario.has(palabra));
      colisiones.push({
        a: primera.code,
        b: segunda.code,
        solape: Number(solape.toFixed(3)),
        palabrasComunes: comunes.slice(0, 12),
        seDefienden: primera.contraejemplos > 0 && segunda.contraejemplos > 0,
      });
    }
  }
  return colisiones.sort((a, b) => b.solape - a.solape);
}

/**
 * 6. El hueco de vocabulario: la salida accionable.
 *
 * Que palabras imprimen los bancos y el catalogo no nombra en ningun ejemplo ni
 * contraejemplo de ninguna hoja. Ordenadas por lo que CUESTAN, no por lo
 * frecuentes que son: una palabra que aparece cuarenta veces y cuyas glosas se
 * clasifican todas bien no le falta a nadie.
 *
 * El coste es el numero de movimientos que la contienen y acabaron mal, donde
 * mal es haber caido en el cajon, haber pedido revision, haber salido UNKNOWN o
 * no haberse clasificado nunca. Cada linea trae el banco que la imprime, la hoja
 * a la que fueron a parar sus glosas y hasta tres glosas literales, que es lo
 * que se copia y pega en `glosa-vocabulary.data.ts`.
 */
function cortarVocabulario(
  catalogo: readonly Categoria[],
  clasificaciones: readonly Clasificacion[],
  movimientos: readonly MovimientoReal[],
  top: number,
) {
  const enCatalogo = new Set(
    catalogo.flatMap((hoja) =>
      [...hoja.positiveExamples, ...hoja.counterExamples, hoja.name, hoja.code].flatMap((texto) =>
        palabras(texto),
      ),
    ),
  );

  const porTexto = new Map<string, Clasificacion>();
  for (const item of clasificaciones) porTexto.set(item.texto, item);

  interface Acumulado {
    apariciones: number;
    malas: number;
    sinClasificar: number;
    bancos: Set<string>;
    hojas: Map<string, number>;
    ejemplos: Set<string>;
  }
  const huecos = new Map<string, Acumulado>();
  const subidos = movimientos.filter((mov) => mov.fuente === 'UPLOAD');

  for (const mov of subidos) {
    const clasificacion = porTexto.get(mov.glosa);
    const mala =
      clasificacion === undefined ||
      clasificacion.decidedBy === 'BIN' ||
      clasificacion.requiereRevision ||
      clasificacion.status === 'UNKNOWN';

    for (const palabra of new Set(palabras(sinContraparte(mov.glosa)))) {
      if (enCatalogo.has(palabra) || PALABRAS_DE_INSTITUCION.has(palabra)) continue;
      const entrada = huecos.get(palabra) ?? {
        apariciones: 0,
        malas: 0,
        sinClasificar: 0,
        bancos: new Set<string>(),
        hojas: new Map<string, number>(),
        ejemplos: new Set<string>(),
      };
      entrada.apariciones += 1;
      if (mala) entrada.malas += 1;
      if (clasificacion === undefined) entrada.sinClasificar += 1;
      entrada.bancos.add(mov.institucion);
      if (clasificacion?.categoria != null) {
        entrada.hojas.set(
          clasificacion.categoria,
          (entrada.hojas.get(clasificacion.categoria) ?? 0) + 1,
        );
      }
      if (entrada.ejemplos.size < 3) entrada.ejemplos.add(enmascarar(mov.glosa));
      huecos.set(palabra, entrada);
    }
  }

  const filas = [...huecos.entries()]
    .map(([palabra, datos]) => ({
      palabra,
      apariciones: datos.apariciones,
      malas: datos.malas,
      sinClasificar: datos.sinClasificar,
      bancos: [...datos.bancos].sort(),
      hojaDominante: [...datos.hojas.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '(ninguna)',
      ejemplos: [...datos.ejemplos],
    }))
    .sort((a, b) => b.malas - a.malas || b.apariciones - a.apariciones);

  return {
    palabrasDistintasEnGlosasReales: new Set(
      subidos.flatMap((mov) => palabras(sinContraparte(mov.glosa))),
    ).size,
    palabrasDelCatalogo: enCatalogo.size,
    huecosDistintos: filas.length,
    accionables: filas.filter((fila) => fila.malas > 0).slice(0, top),
    masFrecuentesAunqueNoCuesten: [...filas]
      .sort((a, b) => b.apariciones - a.apariciones)
      .slice(0, top),
  };
}

/**
 * La propuesta de ampliacion, en la forma que come `POST …/categories/import`.
 *
 * ## Por que se ESCRIBE y no se aplica
 *
 * El catalogo del motor no vive en el repositorio: son filas de la base, y la
 * copia duradera esta en la rama Neon de semillas. O sea que «ampliar el
 * catalogo» no es un commit, es un import contra un entorno vivo — y despues una
 * instantanea nueva, o el cambio no sobrevive a una instalacion limpia. Nada de
 * eso lo decide un guion de auditoria.
 *
 * ## Por que el archivo NO va al repositorio
 *
 * Cada ejemplo propuesto es una glosa que imprimio un banco para una persona. Se
 * recorta el bloque de contraparte —el nombre y la cuenta salen con `sinContraparte`—
 * pero lo que queda sigue siendo texto de un extracto real, y un archivo asi no
 * se commitea. Se escribe fuera del arbol, se revisa y se aplica.
 *
 * ## Por que no hay un detector de nombres, y no es por falta de intentarlo
 *
 * Se probaron cuatro y fallaron los cuatro, cada uno por su lado:
 *
 * 1. **Por forma capitalizada.** «Solicitud De Copias Digitales» tiene la misma
 *    forma que «Renny Silvestre Rodriguez»: tres palabras capitalizadas ajenas
 *    al catalogo. Una nombra un servicio y la otra a una persona, y eso no esta
 *    en la cadena.
 * 2. **Por tramos en versales.** 1.229 positivos sobre 2.256 ejemplos: el
 *    catalogo entero esta escrito en mayusculas.
 * 3. **Por frecuencia** (palabras unicas en todo el catalogo). 101 positivos, y
 *    eran «SEMILLA CERTIFICADA» e «INSEMINACION ARTIFICIAL»: vocabulario raro y
 *    legitimo puntua igual que un apellido.
 * 4. **Por copia literal** de una glosa real. Exacto pero ciego: encuentra 7
 *    ejemplos, los 7 limpios, y no encuentra el unico contaminado que si existe
 *    —`TRANSF. QR ACH RENNY RODRIGUEZ BARBERY Sin referencia`, en
 *    `GASTOS.COMPRAS.QR`—, porque alguien lo edito al copiarlo.
 *
 * Es el mismo criterio que gobierna los tres cableados de OpenRouter de este
 * repositorio: donde no hay verificador, no se automatiza. Un detector con 101
 * falsos positivos no protege el catalogo, entrena a quien lo lee para
 * ignorarlo. Por eso esto marca de mas y lo resuelve una persona.
 *
 * ## Lo que hay que mirar antes de aplicarlo
 *
 * La lista trae candidatos, no decisiones. En el corpus medido, de las catorce
 * palabras que costaban algo solo cuatro eran CONCEPTOS —una solicitud de copias
 * al Servicio Plurinacional de Registro, unos servicios de clinica, una
 * billetera, una devolucion de prestamo—; las otras diez eran codigos de comercio
 * (`FMC`, `B1B`, `4SCZ`) y nombres que el titular escribio en el hueco del
 * concepto. Anadir un codigo de comercio como ejemplo no ensena nada; anadir un
 * nombre, tampoco. Por eso `sospechoso` marca las que lo parecen, y por eso esto
 * lo revisa una persona.
 *
 * El import REEMPLAZA la fila entera, asi que cada categoria viaja completa con
 * sus ejemplos actuales mas los propuestos. Aplicar primero con `dryRun`.
 */
function proponerImport(
  catalogo: readonly Categoria[],
  vocabulario: ReturnType<typeof cortarVocabulario>,
  movimientos: readonly MovimientoReal[],
) {
  const porCodigo = new Map(catalogo.map((hoja) => [hoja.code, hoja]));
  const vocabularioDelCatalogo = new Set(
    catalogo.flatMap((hoja) =>
      [...hoja.positiveExamples, ...hoja.counterExamples, hoja.name].flatMap((texto) =>
        palabras(texto),
      ),
    ),
  );
  const propuestos = new Map<string, { glosas: Set<string>; palabras: Set<string> }>();

  for (const hueco of vocabulario.accionables) {
    if (hueco.hojaDominante === '(ninguna)') continue;
    const entrada = propuestos.get(hueco.hojaDominante) ?? {
      glosas: new Set<string>(),
      palabras: new Set<string>(),
    };
    entrada.palabras.add(hueco.palabra);
    for (const mov of movimientos) {
      if (mov.fuente !== 'UPLOAD') continue;
      const concepto = sinContraparte(mov.glosa).trim();
      if (concepto.length >= 8 && palabras(concepto).includes(hueco.palabra)) {
        entrada.glosas.add(concepto);
      }
    }
    propuestos.set(hueco.hojaDominante, entrada);
  }

  return [...propuestos.entries()].flatMap(([code, datos]) => {
    const hoja = porCodigo.get(code);
    if (hoja === undefined) return [];
    const nuevos = [...datos.glosas].filter(
      (glosa) => !hoja.positiveExamples.some((existente) => existente.trim() === glosa),
    );
    if (nuevos.length === 0) return [];
    return [
      {
        code: hoja.code,
        name: hoja.name,
        parentCode: hoja.parentCode,
        acceptanceThreshold: hoja.acceptanceThreshold,
        counterExamples: hoja.counterExamples,
        positiveExamples: [...hoja.positiveExamples, ...nuevos],
        /** Sólo para el revisor: no forma parte del contrato del import. */
        _revisar: {
          palabrasQueLoMotivaron: [...datos.palabras],
          ejemplosNuevos: nuevos,
          aRevisar: nuevos.filter((glosa) => necesitaRevision(glosa, vocabularioDelCatalogo)),
        },
      },
    ];
  });
}

/**
 * Marca lo que NO se puede añadir al catálogo sin que una persona lo mire.
 *
 * La primera versión de esto era más lista y estaba mal. Marcaba los códigos de
 * comercio (`FMC`, `B1B`, `4SCZ`) y dejaba pasar como buenos «Transferencia Qr
 * Bm Qr Yape - Billetera - Renny Silvestre Rodriguez Barbery», o sea el nombre
 * completo de una persona propuesto como ejemplo del catálogo. Un ejemplo así no
 * clasifica nada y además publica a quien cobró.
 *
 * No hay arreglo automático, y conviene decirlo en vez de intentarlo: en
 * «Transferencia Qr Bm Qr 17093 2026 - Solicitud De Copias Digitales» el
 * fragmento que hay que conservar tiene exactamente la misma forma que el
 * fragmento que hay que tirar en el caso de arriba —tres palabras
 * capitalizadas, ninguna en el catálogo—. Lo que las distingue es que una nombra
 * un servicio y la otra a un ser humano, y eso no está en la cadena.
 *
 * Así que la regla se invierte: en vez de colar lo que parece limpio, se marca
 * todo lo que traiga un tramo capitalizado ajeno al catálogo. Marca de más, a
 * propósito. El coste de un falso positivo es que alguien lea una línea; el de
 * un falso negativo es un apellido en el repositorio.
 */
function necesitaRevision(glosa: string, vocabularioDelCatalogo: ReadonlySet<string>): boolean {
  const fichas = palabras(glosa);
  // Demasiado corta para ser un concepto, o con una ficha alfanumérica: código.
  if (fichas.length <= 3) return true;
  if (fichas.some((ficha) => /\d/u.test(ficha) && /[A-Z]/u.test(ficha))) return true;

  // Un tramo de dos o más palabras seguidas que el catálogo no conoce. Es la
  // forma de un nombre propio, y también la de un rubro que falta: por eso se
  // marca y no se descarta.
  let seguidasDesconocidas = 0;
  for (const ficha of fichas) {
    seguidasDesconocidas = vocabularioDelCatalogo.has(ficha) ? 0 : seguidasDesconocidas + 1;
    if (seguidasDesconocidas >= 2) return true;
  }
  return false;
}

function agrupar<T>(lista: readonly T[], clave: (item: T) => string): Record<string, number> {
  const salida: Record<string, number> = {};
  for (const item of lista) {
    const k = clave(item);
    salida[k] = (salida[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(salida).sort((a, b) => b[1] - a[1]));
}

// --- 7. Veredicto y presentacion -------------------------------------------

/**
 * Lo que hay que hacer, en orden, deducido de los seis cortes.
 *
 * No es un resumen: es la traduccion de cada medida a la accion que la cambia, y
 * a la que NO la cambia. La linea mas util suele ser la ultima de cada bloque:
 * lo que parece la solucion obvia y esta medido que no lo es.
 */
function veredicto(informe: Informe): string[] {
  const lineas: string[] = [];
  const { procedencia: p, cobertura: c, colisiones, vocabulario: v, competencia } = informe;

  if (p.fraccionReal < 0.2) {
    lineas.push(
      `El ${porcentaje(p.clasificadasSobreTextoReal, p.clasificacionesTotales)} del corpus se ` +
        `midio contra texto de un banco; el resto lo escribio un sembrador. El dialecto medio ` +
        `lo confirma: ${p.dialectoMedioReal} en lo real contra ${p.dialectoMedioSembrado} en lo ` +
        `sembrado. ANTES de tocar el catalogo, no ampliar el corpus sembrado: no mide lo que ` +
        `hay que medir.`,
    );
  }
  if (p.corrompidasSoloCanal > 0) {
    lineas.push(
      `${String(p.corrompidasSoloCanal)} glosas solo nombran el CANAL ("DEBITO AGENCIA", ` +
        `"CREDITO DE: BANCA MOVIL"). Son texto real de documentos reales y aun asi no describen ` +
        `nada: es el residuo del corrimiento de columna. No cuentan como cobertura, y si vuelven ` +
        `a crecer, el parser se rompio otra vez.`,
    );
  }
  lineas.push(
    `${String(c.hojasMuertas)} de ${String(c.hojas)} hojas no han visto NUNCA un movimiento de ` +
      `un documento real. No estan mal: estan sin contrastar, y no pueden presentarse como ` +
      `probadas. ${String(c.hojasQueConcentranLaMitad)} hojas se reparten la mitad de la ` +
      `evidencia real que hay.`,
  );

  const sinDefensa = colisiones.filter((par) => !par.seDefienden);
  if (colisiones.length > 0) {
    lineas.push(
      `${String(colisiones.length)} pares de hojas comparten vocabulario por encima del umbral, ` +
        `y ${String(sinDefensa.length)} de ellos SIN contraejemplos en ninguno de los dos lados. ` +
        `Ahi es donde un ejemplo nuevo empeora las cosas y un contraejemplo las arregla: anadir ` +
        `ejemplos a dos hojas que ya se parecen las acerca mas.`,
    );
  }
  if (competencia.perdedorasCronicas.length > 0) {
    const peor = competencia.perdedorasCronicas[0];
    lineas.push(
      `${String(competencia.perdedorasCronicas.length)} hojas se presentan como candidatas y no ` +
        `ganan jamas (la peor, ${peor?.code ?? ''}, ${String(peor?.candidaturas ?? 0)} veces). ` +
        `Eso no se arregla con ejemplos: o su vocabulario pertenece a la hoja que le gana, o le ` +
        `falta el rasgo que la distingue. Fusionar o contraejemplificar, no ampliar.`,
    );
  }
  lineas.push(
    `${String(v.huecosDistintos)} palabras aparecen en glosas reales y en ningun ejemplo del ` +
      `catalogo; ${String(v.accionables.length)} de ellas en movimientos que acabaron mal. Esa es ` +
      `la lista de la compra, y son cadenas que un banco imprimio, no texto generado.`,
  );
  lineas.push(
    `La FORMA no distingue las dos poblaciones: el texto sembrado puntua ${String(
      p.dialectoMedioSembrado,
    )} en senas de dialecto bancario y el real ${String(p.dialectoMedioReal)}. O sea que el ` +
      `sembrador ya imita bien el estilo, y por tanto mirar la glosa NO permite auditar un ` +
      `corpus: lo unico que separa es tener detras un PDF de un banco.`,
  );
  lineas.push(
    `Lo que NO hay que hacer, medido: generar ejemplos. Lo que a una hoja le falta no es una ` +
      `descripcion mejor del concepto, que el modelo ya tiene, sino la forma literal en que su ` +
      `banco lo escribe, que es justo lo que no puede inventar.`,
  );
  return lineas;
}

function imprimir(informe: Informe, top: number): void {
  const { procedencia: p, cobertura: c, decisiones: d, competencia, colisiones, vocabulario: v } = informe;
  const linea = (): void => console.log('-'.repeat(78));

  console.log('\nAUDITORIA DEL CORPUS DE GLOSAS');
  linea();
  console.log('\n1. PROCEDENCIA');
  console.log(`   clasificaciones                ${String(p.clasificacionesTotales)}`);
  console.log(
    `   sobre texto de un banco       ${String(p.clasificadasSobreTextoReal)}  (${porcentaje(
      p.clasificadasSobreTextoReal,
      p.clasificacionesTotales,
    )})`,
  );
  console.log(`   sobre texto sembrado          ${String(p.clasificadasSobreTextoSembrado)}`);
  console.log(`   solo nombran el canal         ${String(p.corrompidasSoloCanal)}`);
  console.log(
    `   dialecto bancario medio       real ${String(p.dialectoMedioReal)} / sembrado ${String(
      p.dialectoMedioSembrado,
    )}`,
  );
  console.log(
    `   movimientos de documento      ${String(p.movimientosReales)} subidos, ${String(
      p.movimientosDeFixture,
    )} de fixture`,
  );
  console.log(
    `   glosas reales distintas       ${String(p.glosasRealesDistintas)}, de ellas clasificadas ${String(
      p.glosasRealesClasificadas,
    )}`,
  );
  console.log(`   por solicitante               ${JSON.stringify(p.porRequestedBy)}`);
  console.log('   por institucion:');
  for (const fila of p.porInstitucion) {
    console.log(
      `     ${fila.institucion.padEnd(6)} ${String(fila.movimientos).padStart(4)} movimientos, ${String(
        fila.glosasDistintas,
      ).padStart(4)} glosas distintas`,
    );
  }

  console.log('\n2. COBERTURA POR HOJA');
  console.log(`   hojas                         ${String(c.hojas)}`);
  console.log(`   con evidencia REAL            ${String(c.hojasConEvidenciaReal)}`);
  console.log(`   sin verla nunca               ${String(c.hojasMuertas)}`);
  console.log(`   concentran la mitad           ${String(c.hojasQueConcentranLaMitad)} hojas`);
  console.log(`   sin contraejemplos            ${String(c.hojasSinContraejemplos.length)}`);
  console.log('   hojas con mas evidencia real:');
  for (const fila of c.filas.filter((f) => f.real > 0).slice(0, top)) {
    console.log(
      `     ${fila.code.padEnd(42)} real ${String(fila.real).padStart(4)}  sembrada ${String(
        fila.sembrada,
      ).padStart(4)}  ej ${String(fila.ejemplos).padStart(3)}/ct ${String(fila.contraejemplos).padStart(3)}`,
    );
  }

  console.log('\n3. QUIEN DECIDIO');
  for (const [nombre, corte] of [
    ['sobre texto real    ', d.real],
    ['sobre texto sembrado', d.sembrada],
  ] as const) {
    console.log(
      `   ${nombre}  n=${String(corte.total).padStart(5)}  ${JSON.stringify(corte.porDecisor)}`,
    );
    console.log(
      `                         atajo de regla ${String(corte.atajoDeRegla)}, revision ${String(
        corte.requierenRevision,
      )}, mediana ${String(corte.confianzaMediana ?? '—')}, p10 ${String(corte.confianzaP10 ?? '—')}`,
    );
  }

  console.log('\n4. COMPETENCIA ENTRE HOJAS');
  console.log(
    `   glosas con candidatas         ${String(competencia.clasificacionesConCandidatas)} ` +
      `(${String(competencia.candidatasPorGlosa)} candidatas por glosa)`,
  );
  console.log(`   perdedoras cronicas           ${String(competencia.perdedorasCronicas.length)}`);
  for (const fila of competencia.perdedorasCronicas.slice(0, top)) {
    console.log(`     ${fila.code.padEnd(42)} candidata ${String(fila.candidaturas).padStart(4)} veces, 0 victorias`);
  }
  console.log('   rivalidades mas frecuentes (gana <- pierde):');
  for (const fila of competencia.rivalidades.slice(0, top)) {
    console.log(`     ${String(fila.veces).padStart(4)}x  ${fila.ganadora}  <-  ${fila.perdedora}`);
  }

  console.log('\n5. COLISION LEXICA DEL CATALOGO');
  console.log(`   pares por encima del umbral   ${String(colisiones.length)}`);
  for (const par of colisiones.slice(0, top)) {
    console.log(
      `     ${String(par.solape.toFixed(3))}  ${par.a}  ~  ${par.b}${par.seDefienden ? '' : '   [SIN CONTRAEJEMPLOS]'}`,
    );
    console.log(`            comparten: ${par.palabrasComunes.join(', ')}`);
  }

  console.log('\n6. HUECO DE VOCABULARIO');
  console.log(
    `   palabras en glosas reales     ${String(v.palabrasDistintasEnGlosasReales)}, del catalogo ${String(
      v.palabrasDelCatalogo,
    )}`,
  );
  console.log(`   ausentes del catalogo         ${String(v.huecosDistintos)}`);
  console.log('   las que cuestan (palabra, apariciones, malas, bancos, hoja donde cayeron):');
  for (const fila of v.accionables) {
    console.log(
      `     ${fila.palabra.padEnd(22)} ${String(fila.apariciones).padStart(3)}  mal ${String(
        fila.malas,
      ).padStart(3)}  ${fila.bancos.join('/').padEnd(14)} ${fila.hojaDominante}`,
    );
    console.log(`            p.ej. "${fila.ejemplos[0] ?? ''}"`);
  }

  console.log('\n7. VEREDICTO');
  for (const [indice, texto] of veredicto(informe).entries()) {
    console.log(`   ${String(indice + 1)}. ${texto}`);
  }
  console.log('');
}

// --- Entrada ---------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const valorDe = (bandera: string): string | undefined => {
    const indice = args.indexOf(bandera);
    return indice >= 0 ? args[indice + 1] : undefined;
  };
  const top = Number(valorDe('--top') ?? 25);
  const umbralColision = Number(valorDe('--umbral-colision') ?? 0.35);
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === '') {
    console.error('Falta DATABASE_URL. Contra el postgres local del motor:');
    console.error('  DATABASE_URL=postgresql://atlas:...@localhost:5452/atlas_decision');
    process.exitCode = 1;
    return;
  }

  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    const [catalogo, clasificaciones, movimientos] = await Promise.all([
      leerCatalogo(db),
      leerClasificaciones(db),
      leerMovimientosReales(db),
    ]);
    const glosasReales = new Set(
      movimientos.filter((mov) => mov.fuente === 'UPLOAD').map((mov) => mov.glosa),
    );

    const informe: Informe = {
      procedencia: cortarProcedencia(clasificaciones, movimientos),
      cobertura: cortarCobertura(catalogo, clasificaciones, glosasReales),
      decisiones: cortarDecisiones(clasificaciones, glosasReales),
      competencia: cortarCompetencia(clasificaciones),
      colisiones: cortarColisiones(catalogo, umbralColision),
      vocabulario: cortarVocabulario(catalogo, clasificaciones, movimientos, top),
    };

    imprimir(informe, top);

    const proponer = valorDe('--proponer');
    if (proponer !== undefined) {
      const propuesta = proponerImport(catalogo, informe.vocabulario, movimientos);
      writeFileSync(proponer, JSON.stringify({ categories: propuesta }, null, 2));
      const nuevos = propuesta.reduce((suma, fila) => suma + fila._revisar.ejemplosNuevos.length, 0);
      const aRevisar = propuesta.reduce((suma, fila) => suma + fila._revisar.aRevisar.length, 0);
      console.log(
        `Propuesta de import en ${proponer}: ${String(propuesta.length)} categorias, ` +
          `${String(nuevos)} ejemplos nuevos, ${String(aRevisar)} que NO se aplican sin leerlos.`,
      );
      console.log('   NO se commitea: son glosas de extractos reales. Aplicar con dryRun primero.');
    }

    const json = valorDe('--json');
    if (json !== undefined) {
      writeFileSync(json, JSON.stringify({ ...informe, veredicto: veredicto(informe) }, null, 2));
      console.log(`Informe completo en ${json}`);
    }
  } finally {
    await db.end();
  }
}

void main();
