/**
 * Cuatro medidas sobre el DINERO, no sobre el archivo.
 *
 * Las compuertas de autenticidad preguntan si el PDF es el que emitió un banco.
 * Éstas preguntan otra cosa, que un PDF perfectamente auténtico puede fallar:
 * **si lo que el extracto describe es una vida económica o una puesta en
 * escena**. Un extracto real de una cuenta real, en la que alguien movió el
 * mismo dinero en círculo durante tres meses, pasa todas las comprobaciones de
 * estructura y produce un ingreso que no existe.
 *
 * ## Ninguna de las cuatro tiene umbral, y es a propósito
 *
 * El corpus las especifica con `threshold: null` en las cuatro, y enumera para
 * cada una sus confusores LEGÍTIMOS: un reembolso familiar, un préstamo entre
 * conocidos, la tesorería entre cuentas propias, el sueldo que siempre cae a fin
 * de mes, la cuota fija que se repite idéntica, la cuenta de ahorro donde nadie
 * gasta. Cada confusor es una persona honesta a la que un corte mal puesto le
 * cierra el crédito.
 *
 * Así que esto **mide y publica**; no puntúa, no marca y no rechaza. El día que
 * haya cartera con mora observada, estos números serán las variables candidatas
 * de un modelo — y entonces el corte saldrá de los datos en vez de salir de
 * nuestra intuición.
 *
 * ## La ventana de concentración se declara
 *
 * `PRE_CLOSE_CONCENTRATION` exige que la `k` sea explícita y esté sometida a
 * sensibilidad. Siete días es lo que se publica, y viaja en el resultado
 * (`concentrationWindowDays`) para que nadie tenga que leer este archivo para
 * saber sobre qué se midió.
 */

import type { ClassifiedMovement } from './monthly-series';
import { RECOGNIZED_INFLOWS } from './movement-lexicon';
import { round2, round4 } from './statistics';

/** Días antes del cierre del periodo que mide la concentración de abonos. */
export const CONCENTRATION_WINDOW_DAYS = 7;

export interface EconomicPlausibility {
  /**
   * Parte del abono total que tiene un cargo PAREADO con la misma contraparte.
   *
   * Es la huella del circuito: entra 5.000 de alguien y salen 5.000 hacia el
   * mismo sitio, tres meses seguidos. Confusores legítimos: reembolsos, caja
   * familiar, devoluciones. **La coincidencia de importe por sí sola no prueba
   * nada** — el corpus lo dice con esas palabras.
   */
  readonly pairedCounterpartyRatio: number;
  /** Cuántas contrapartes tienen flujo en los dos sentidos. */
  readonly bidirectionalCounterparties: number;
  /** Ventana sobre la que se midió la concentración. Declarada, no implícita. */
  readonly concentrationWindowDays: number;
  /**
   * Abonos elegibles de los últimos `k` días sobre los del periodo.
   *
   * Un extracto preparado concentra los abonos justo antes de pedirlo. Y un
   * sueldo de fin de mes también, que es exactamente por qué esto no tiene
   * umbral.
   */
  readonly preCloseInflowRatio: number;
  /**
   * Movimientos repetidos: misma fecha, importe, sentido y glosa.
   *
   * Puede ser una descarga con páginas solapadas, un pago fijo que de verdad se
   * repite, o una fila duplicada a mano. Se cuenta lo que se repite, no se
   * decide por qué.
   */
  readonly duplicateMovements: number;
  /**
   * Cargos totales sobre abonos totales.
   *
   * Cerca de cero describe una cuenta donde entra dinero y no sale nada, que
   * puede ser una cuenta de ahorro, una cuenta exclusivamente receptora, o la
   * mitad de una escena. `null` cuando no hubo abonos: sin denominador no hay
   * ratio, y cero no es «no salió nada».
   */
  readonly outflowToInflowRatio: number | null;
}

const VACIO: EconomicPlausibility = {
  pairedCounterpartyRatio: 0,
  bidirectionalCounterparties: 0,
  concentrationWindowDays: CONCENTRATION_WINDOW_DAYS,
  preCloseInflowRatio: 0,
  duplicateMovements: 0,
  outflowToInflowRatio: null,
};

/**
 * Mide las cuatro sobre los movimientos ya clasificados.
 *
 * @param window La ventana observada del extracto. Sin ella no se puede medir la
 * concentración, porque «los últimos siete días» exige saber cuál es el último.
 */
export function assessEconomicPlausibility(
  movements: readonly ClassifiedMovement[],
  window: { from: Date; to: Date } | null,
): EconomicPlausibility {
  if (movements.length === 0) return VACIO;

  let inflowTotal = 0;
  let outflowTotal = 0;
  const inByLabel = new Map<string, number>();
  const outByLabel = new Map<string, number>();

  for (const movement of movements) {
    if (movement.direction === 'INFLOW') {
      inflowTotal += movement.amount;
      inByLabel.set(movement.label, (inByLabel.get(movement.label) ?? 0) + movement.amount);
    } else {
      outflowTotal += movement.amount;
      outByLabel.set(movement.label, (outByLabel.get(movement.label) ?? 0) + movement.amount);
    }
  }

  /*
   * La contraparte se identifica por la ETIQUETA del movimiento, que es la
   * glosa sin números ni fechas. Es una aproximación y hay que decirlo: la
   * glosa no siempre nombra a la contraparte, y dos personas distintas pueden
   * compartir etiqueta. El corpus lo advierte —«sin contrapartes o sin otras
   * cuentas no puede probarse un circuito completo»— y por eso lo que sale de
   * aquí es una descripción, no una acusación.
   */
  let paired = 0;
  let bidirectional = 0;
  for (const [label, entrante] of inByLabel) {
    if (label.length === 0) continue;
    const saliente = outByLabel.get(label);
    if (saliente === undefined || saliente <= 0) continue;
    bidirectional += 1;
    paired += Math.min(entrante, saliente);
  }

  const cierre = window?.to ?? null;
  let recientes = 0;
  let elegibles = 0;
  if (cierre) {
    const desde = new Date(cierre.getTime() - CONCENTRATION_WINDOW_DAYS * 86_400_000);
    for (const movement of movements) {
      if (movement.direction !== 'INFLOW') continue;
      if (!RECOGNIZED_INFLOWS.has(movement.kind as never)) continue;
      elegibles += movement.amount;
      const fecha = movement.date ? new Date(`${movement.date.slice(0, 10)}T00:00:00Z`) : null;
      if (fecha && fecha >= desde) recientes += movement.amount;
    }
  }

  const vistos = new Map<string, number>();
  let duplicados = 0;
  for (const movement of movements) {
    const clave = `${movement.date ?? ''}|${movement.direction}|${movement.amount}|${movement.label}`;
    const veces = (vistos.get(clave) ?? 0) + 1;
    vistos.set(clave, veces);
    if (veces > 1) duplicados += 1;
  }

  return {
    pairedCounterpartyRatio: inflowTotal > 0 ? round4(paired / inflowTotal) : 0,
    bidirectionalCounterparties: bidirectional,
    concentrationWindowDays: CONCENTRATION_WINDOW_DAYS,
    preCloseInflowRatio: elegibles > 0 ? round4(recientes / elegibles) : 0,
    duplicateMovements: duplicados,
    outflowToInflowRatio: inflowTotal > 0 ? round4(outflowTotal / inflowTotal) : null,
  };
}

/** Los totales que acompañan a las medidas cuando alguien quiere auditarlas. */
export function plausibilityTotals(movements: readonly ClassifiedMovement[]): {
  inflow: number;
  outflow: number;
} {
  let inflow = 0;
  let outflow = 0;
  for (const movement of movements) {
    if (movement.direction === 'INFLOW') inflow += movement.amount;
    else outflow += movement.amount;
  }
  return { inflow: round2(inflow), outflow: round2(outflow) };
}
