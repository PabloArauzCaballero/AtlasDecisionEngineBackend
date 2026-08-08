/**
 * Capacidades declaradas por motor.
 *
 * Existen para que el arranque falle cuando una ruta exige algo que su motor no ofrece,
 * en vez de descubrirlo en producción con una transacción que nunca fue atómica. No se
 * simula ninguna capacidad ausente: si Redis no tiene transacciones multi-clave con
 * rollback, la ruta que las pida no arranca (§15).
 */
import type { DataEngine } from './data-source.types';

export interface AdapterCapabilities {
  readonly transactions: boolean;
  readonly fullTextSearch: boolean;
  readonly optimisticLocking: boolean;
  readonly changeStreams: boolean;
  readonly rowLevelSecurity: boolean;
  readonly nativeJson: boolean;
  readonly readReplica: boolean;
  readonly distributedTransactions: boolean;
}

export type CapabilityName = keyof AdapterCapabilities;

const NONE: AdapterCapabilities = {
  transactions: false,
  fullTextSearch: false,
  optimisticLocking: false,
  changeStreams: false,
  rowLevelSecurity: false,
  nativeJson: false,
  readReplica: false,
  distributedTransactions: false,
};

/**
 * Nadie ofrece transacciones distribuidas: ningún motor de esta tabla las da por sí
 * mismo, y fingirlas es exactamente el error que este modelo existe para impedir. La
 * coordinación entre motores va por outbox/saga (§30).
 */
export const ENGINE_CAPABILITIES: Readonly<Record<DataEngine, AdapterCapabilities>> = {
  postgresql: {
    ...NONE,
    transactions: true,
    fullTextSearch: true,
    optimisticLocking: true,
    rowLevelSecurity: true,
    nativeJson: true,
    readReplica: true,
  },
  mysql: {
    ...NONE,
    transactions: true,
    fullTextSearch: true,
    optimisticLocking: true,
    nativeJson: true,
    readReplica: true,
  },
  // MULTI/EXEC agrupa comandos pero no deshace los ya aplicados si uno falla: no es una
  // transacción en el sentido que este contrato promete, así que se declara ausente.
  redis: { ...NONE, changeStreams: true, nativeJson: false, readReplica: true },
  mongodb: {
    ...NONE,
    transactions: true,
    fullTextSearch: true,
    optimisticLocking: true,
    changeStreams: true,
    nativeJson: true,
    readReplica: true,
  },
  opensearch: { ...NONE, fullTextSearch: true, nativeJson: true, readReplica: true },
  clickhouse: { ...NONE, nativeJson: true, readReplica: true },
};

export function capabilitiesOf(engine: DataEngine): AdapterCapabilities {
  return ENGINE_CAPABILITIES[engine];
}

/** Devuelve las capacidades pedidas que el motor NO ofrece. Vacío = ruta viable. */
export function missingCapabilities(
  engine: DataEngine,
  required: readonly CapabilityName[],
): CapabilityName[] {
  const available = capabilitiesOf(engine);
  return required.filter((capability) => !available[capability]);
}
