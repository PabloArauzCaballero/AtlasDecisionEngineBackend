import { Prisma } from '@prisma/client';
import type { TraceCarrier } from '../observability/telemetry.types';

/**
 * Traduce un portador de traza a lo que se persiste en una columna `Json?`.
 *
 * Un portador vacío —telemetría apagada, trabajo interno sin traza— se guarda como **NULL** y
 * no como `{}`. Los dos se leerían igual al consumir, pero significan cosas distintas para
 * quien inspecciona la tabla durante un incidente: `{}` parece un portador que se escribió y
 * perdió su contenido, mientras que NULL dice exactamente lo que pasó, que no había contexto
 * que capturar. Es también lo que documenta la migración `20260804160000_trace_carrier_propagation`.
 *
 * Vive en `common/events` y no en `common/observability` a propósito: `Prisma.DbNull` es un
 * detalle del ORM, y la capa de observabilidad no debe conocer con qué se persiste.
 */
export function persistableCarrier(
  carrier: TraceCarrier,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return Object.keys(carrier).length > 0 ? carrier : Prisma.DbNull;
}
