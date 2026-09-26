#!/usr/bin/env node
/**
 * Calibración del clasificador de gastos contra el motor real.
 *
 * Los umbrales del adaptador de transformers son valores de COSENO y pertenecen
 * al modelo servido, no al dominio: `SIMILARITY_FLOOR` en 0,78 está medido sobre
 * la familia e5 y no se puede heredar al cambiar de modelo. Este script es la
 * medición que respalda ese número.
 *
 * Recorre un conjunto de evaluación con la categoría esperada escrita al lado y
 * reporta tres cosas por caso: qué salió, con cuánta confianza y si coincide.
 * Al final da la exactitud y las confusiones, que es lo que dice si el catálogo
 * separa bien las categorías o si hay dos hojas que el modelo no distingue.
 *
 * **Un fallo aquí casi nunca es del código.** Es del catálogo —una hoja con
 * ejemplos pobres o un contraejemplo que falta— o del umbral. Por eso el informe
 * enseña la confianza y la explicación, no sólo el veredicto.
 *
 *   node scripts/semantic-calibration.mjs
 *   SEMANTIC_BASE_URL=http://localhost:3000 node scripts/semantic-calibration.mjs
 */
import { readFileSync } from 'node:fs';

function loadEnv() {
  try {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // Sin .env se depende de las variables ya exportadas: es el caso de CI.
  }
}
loadEnv();

const BASE_URL =
  process.env.SEMANTIC_BASE_URL ?? process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const API_KEY = process.env.MANAGEMENT_API_KEY;
const TENANT_ID = process.env.BOOTSTRAP_TENANT_ID ?? '1';
const MAX_ESPERA = Number(process.env.SEMANTIC_CALIBRATION_TIMEOUT_SECONDS ?? 60);

if (!API_KEY) {
  console.error('Falta MANAGEMENT_API_KEY.');
  process.exit(2);
}

const headers = { 'x-api-key': API_KEY, 'x-tenant-id': TENANT_ID };
const TERMINALES = ['SUCCEEDED', 'SUCCEEDED_WITH_WARNINGS', 'FAILED', 'CANCELLED'];

/**
 * Conjunto de evaluación.
 *
 * Descripciones tal como las escribe un banco, con la hoja que les corresponde.
 * `null` significa que lo correcto es ABSTENERSE: son los casos que miden que el
 * suelo de similitud hace su trabajo, y sin ellos la exactitud se mediría sólo
 * sobre textos que sí encajan, que es la mitad fácil del problema.
 */
const CASOS = [
  // --- Gasto, categoría inequívoca ---------------------------------------
  ['COMPRA EN SUPERMERCADO HIPERMAXI SUCURSAL NORTE BS 487,90', 'GASTOS.ALIMENTACION.SUPERMERCADO'],
  ['CONSUMO RESTAURANTE LA CASONA ALMUERZO BS 120,00', 'GASTOS.ALIMENTACION.RESTAURANTES'],
  ['PAGO ALQUILER DEPARTAMENTO MES DE JULIO BS 2.800,00', 'GASTOS.VIVIENDA.ALQUILER'],
  ['PAGO FACTURA DE ENERGIA ELECTRICA CRE JULIO', 'GASTOS.VIVIENDA.SERVICIOS'],
  ['PAGO PLAN DE INTERNET FIBRA OPTICA TIGO', 'GASTOS.VIVIENDA.TELECOMUNICACIONES'],
  ['COMPRA DE GASOLINA ESPECIAL EN SURTIDOR YPFB', 'GASTOS.TRANSPORTE.COMBUSTIBLE'],
  ['PAGO VIAJE EN TAXI APLICACION YANGO', 'GASTOS.TRANSPORTE.PUBLICO'],
  ['COMPRA EN FARMACIA CHAVEZ MEDICAMENTOS', 'GASTOS.SALUD.FARMACIA'],
  ['PAGO CONSULTA MEDICA ESPECIALISTA CARDIOLOGIA', 'GASTOS.SALUD.ATENCION'],
  ['PAGO PENSION ESCOLAR COLEGIO SAN CALIXTO MAYO', 'GASTOS.EDUCACION'],
  ['PAGO SUSCRIPCION MENSUAL NETFLIX', 'GASTOS.OCIO.SUSCRIPCIONES'],
  ['COMPRA DE PASAJES AEREOS BOA VACACIONES', 'GASTOS.OCIO.VIAJES'],
  ['COMISION POR MANTENIMIENTO DE CUENTA JULIO', 'GASTOS.FINANCIEROS.COMISIONES'],
  ['PAGO IMPUESTO A LA PROPIEDAD DE INMUEBLES GAMSC', 'GASTOS.IMPUESTOS'],

  // --- Ingreso ------------------------------------------------------------
  ['ABONO DE HABERES NOMINA JUNIO 2026 BS 8.450,00', 'INGRESOS.SUELDO'],
  ['COBRO FACTURA 0012 SERVICIOS PROFESIONALES DE CONSULTORIA', 'INGRESOS.INDEPENDIENTE'],
  ['TRANSFERENCIA RECIBIDA DE JUAN PEREZ BS 300,00', 'INGRESOS.TRANSFERENCIA'],
  ['ABONO INTERESES CAJA DE AHORRO TRIMESTRE', 'INGRESOS.FINANCIERO'],

  // --- El par difícil: misma rama, mismo vocabulario ----------------------
  ['PAGO CUOTA PRESTAMO HIPOTECARIO VIVIENDA CUOTA 24/180', 'GASTOS.FINANCIEROS.PRESTAMOS'],

  /*
   * --- El CAJÓN: no hay concepto que nombrar, pero sí un movimiento ---------
   *
   * Estos dos esperaban abstención (`null`), y esa expectativa se escribió antes
   * de que existiera el último escalón. Hoy el motor NO se abstiene nunca por
   * diseño: una glosa sin concepto reconocible cae en «otros gastos» del sentido
   * que corresponda, marcada para revisión y con `decidedBy: BIN`. La razón está
   * en `glosa-fallback.ts` y se sostiene: «otros gastos» es una categoría que
   * existe en cualquier contabilidad y se puede sumar, mientras que «sin
   * determinar» no es nada y deja a quien recibe el informe resolviendo fila por
   * fila.
   *
   * Así que la expectativa se corrige, PERO no se afloja: el tercer elemento
   * exige que la decisión venga del cajón. Sin él, esta prueba daría por bueno
   * que el modelo eligiera «Otros gastos» con toda su confianza, que es una
   * afirmación muy distinta —y la que de verdad habría que vigilar—.
   */
  ['MOVIMIENTO VARIOS REF 000918237 OP 4471', 'GASTOS.OTROS', 'BIN'],
  ['AJUSTE CONTABLE INTERNO 99213', 'GASTOS.OTROS', 'BIN'],
];

function items(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.items) ? payload.items : [];
}

async function api(path, init = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function clasificar(texto, indice) {
  const creada = await api('/v1/workers/semantic-analysis/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // La clave de idempotencia lleva el instante: reutilizarla devolvería la
    // ejecución anterior y la calibración mediría una corrida vieja.
    body: JSON.stringify({ text: texto, idempotencyKey: `calib-${Date.now()}-${indice}` }),
  });
  if (creada.status !== 202) {
    return { error: `alta devolvió ${creada.status}` };
  }

  for (let i = 0; i < MAX_ESPERA; i += 1) {
    const { status, body } = await api(
      `/v1/workers/semantic-analysis/runs/${creada.body.requestId}`,
    );
    if (status === 200 && TERMINALES.includes(body.status)) {
      return body.status.startsWith('SUCCEEDED')
        ? { resultado: body.result }
        : { error: `${body.status}: ${body.errorMessage ?? body.errorCode ?? 'sin detalle'}` };
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return { error: 'no alcanzó un estado terminal' };
}

/** La hoja aceptada con más confianza, o `null` si el motor se abstuvo. */
function ganadora(resultado) {
  const aceptadas = (resultado?.matches ?? []).filter((m) => m.supported && !m.contradicted);
  return aceptadas.sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}

function pad(texto, ancho) {
  return texto.length > ancho ? `${texto.slice(0, ancho - 1)}…` : texto.padEnd(ancho);
}

async function main() {
  console.log(`\nCalibración del clasificador contra ${BASE_URL}\n`);

  const catalogo = await api('/v1/workers');
  const descriptor = items(catalogo.body).find((w) => w.code === 'semantic-analysis');
  if (descriptor?.available !== true) {
    console.log('  El worker semántico está apagado en este motor. Nada que calibrar.\n');
    return 0;
  }

  let aciertos = 0;
  const confusiones = [];

  for (const [indice, [texto, esperada, decididoPor]] of CASOS.entries()) {
    const { resultado, error } = await clasificar(texto, indice);
    if (error) {
      console.log(` ERROR ${pad(texto, 52)} ${error}`);
      confusiones.push({ texto, esperada, obtenida: `error: ${error}` });
      continue;
    }

    const mejor = ganadora(resultado);
    const obtenida = mejor?.categoryCode ?? null;
    // Un caso puede exigir además QUIÉN decidió: no es lo mismo que el cajón
    // coloque una glosa sin concepto que el modelo elija «otros» convencido.
    const decidioBien = decididoPor === undefined || resultado?.decidedBy === decididoPor;
    const acierta = obtenida === esperada && decidioBien;
    if (acierta) aciertos += 1;
    else
      confusiones.push({
        texto,
        esperada: decididoPor === undefined ? esperada : `${esperada} (por ${decididoPor})`,
        obtenida: decidioBien ? obtenida : `${obtenida} (por ${String(resultado?.decidedBy)})`,
        rationale: mejor?.rationale,
      });

    const confianza = mejor ? `${(mejor.confidence * 100).toFixed(0)}%` : '  —';
    const ruta = (resultado?.categoryPaths?.[obtenida] ?? []).join(' › ');
    console.log(
      `${acierta ? '  OK  ' : ' FALLO'} ${pad(texto, 52)} ${confianza.padStart(4)}  ` +
        `${resultado?.status ?? '?'}  ${ruta || '(abstención)'}`,
    );
  }

  const exactitud = ((aciertos / CASOS.length) * 100).toFixed(1);
  console.log(`\n  Exactitud: ${aciertos}/${CASOS.length} (${exactitud}%)`);

  if (confusiones.length > 0) {
    console.log('\n  Confusiones — casi siempre son del catálogo, no del código:\n');
    for (const c of confusiones) {
      console.log(`    «${c.texto}»`);
      console.log(`      esperada: ${c.esperada ?? '(abstención)'}`);
      console.log(`      obtenida: ${c.obtenida ?? '(abstención)'}`);
      if (c.rationale) console.log(`      ${c.rationale}`);
      console.log('');
    }
  }

  console.log('');
  // Se exige 85% y no 100%: un clasificador por similitud con veintitantas hojas
  // no acierta siempre, y fijar el listón en la perfección convertiría esta
  // medición en una prueba que nadie puede dejar en verde.
  return aciertos / CASOS.length >= 0.85 ? 0 : 1;
}

process.exitCode = await main();
