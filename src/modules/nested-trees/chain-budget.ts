/**
 * Presupuesto de una cadena de artefactos encadenados (§9.3).
 *
 * La profundidad ya estaba acotada, pero sola no basta: una cadena de profundidad 3
 * puede invocar cincuenta artefactos en abanico, tardar un minuto o devolver un
 * resultado de megabytes. Este objeto acompaña a UNA ejecución raíz y se agota conforme
 * la cadena avanza, de modo que el coste total queda acotado y no solo el de cada salto.
 */
import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';

export interface ChainLimits {
  /** Cuántos artefactos puede invocar la cadena completa. */
  maxArtifacts: number;
  /** Milisegundos para toda la cadena, no por salto. */
  maxTotalMs: number;
  /** Tamaño máximo, en bytes de JSON, de un resultado intermedio. */
  maxResultBytes: number;
  /**
   * Bytes acumulados que la cadena puede llegar a retener sumando todos sus resultados
   * intermedios. Es el límite de memoria de §9.3.
   *
   * Se mide así, y no leyendo el montículo, por una razón de fondo: `process.memoryUsage()`
   * es de todo el proceso y depende del recolector de basura y de la carga de las peticiones
   * vecinas, así que una decisión pasaría o fallaría por motivos ajenos a sus datos — es
   * decir, dejaría de ser reproducible, que es justo lo que el motor promete. Lo que sí es
   * determinista, y además es el que crece de verdad, es lo que la cadena **retiene**: cada
   * entrada de la traza anidada guarda su `output`, así que el coste real de una cadena es
   * la suma de sus resultados, no el pico del montículo.
   *
   * El tope por resultado no basta: 25 artefactos a 256 KiB cada uno pasan uno a uno y suman
   * 6,4 MiB retenidos, tanto en memoria como en la respuesta.
   */
  maxRetainedBytes: number;
}

export const DEFAULT_CHAIN_LIMITS: ChainLimits = {
  maxArtifacts: 25,
  maxTotalMs: 10_000,
  maxResultBytes: 262_144,
  maxRetainedBytes: 1_048_576,
};

export class ChainBudget {
  private invocations = 0;
  private retainedBytes = 0;
  private readonly startedAt: number;

  constructor(
    private readonly limits: ChainLimits = DEFAULT_CHAIN_LIMITS,
    now: () => number = () => Date.now(),
  ) {
    this.now = now;
    this.startedAt = now();
  }

  private readonly now: () => number;

  /** Consume una invocación. Falla cerrado cuando la cadena excede lo permitido. */
  consumeInvocation(nodeKey: string): void {
    this.invocations += 1;
    if (this.invocations > this.limits.maxArtifacts) {
      throw new DomainException(
        'NESTED_TREE_MAX_ARTIFACTS_EXCEEDED',
        `La cadena supera los ${this.limits.maxArtifacts} artefactos encadenados (nodo ${nodeKey})`,
        HttpStatus.CONFLICT,
        { invocations: this.invocations, maxArtifacts: this.limits.maxArtifacts },
      );
    }
  }

  /** Tiempo que le queda a la cadena; nunca más que el timeout del salto. */
  remainingMs(stepTimeoutMs: number): number {
    const elapsed = this.now() - this.startedAt;
    const remaining = this.limits.maxTotalMs - elapsed;
    if (remaining <= 0) {
      throw new DomainException(
        'NESTED_TREE_TOTAL_TIMEOUT_EXCEEDED',
        `La cadena superó el tiempo total de ${this.limits.maxTotalMs} ms`,
        HttpStatus.GATEWAY_TIMEOUT,
      );
    }
    return Math.min(stepTimeoutMs, remaining);
  }

  /**
   * Cobra un resultado intermedio contra el presupuesto: primero su tamaño propio y luego
   * lo que la cadena lleva retenido en total.
   *
   * El orden importa. Un único resultado desmesurado debe decir que ES desmesurado
   * (`NESTED_TREE_RESULT_TOO_LARGE`) y no que la cadena se quedó sin memoria: el autor tiene
   * que saber qué salto arreglar.
   */
  consumeResult(nodeKey: string, output: unknown): void {
    const bytes = Buffer.byteLength(JSON.stringify(output ?? null), 'utf8');
    if (bytes > this.limits.maxResultBytes) {
      throw new DomainException(
        'NESTED_TREE_RESULT_TOO_LARGE',
        `El resultado de ${nodeKey} ocupa ${bytes} bytes y el máximo es ${this.limits.maxResultBytes}`,
        HttpStatus.CONFLICT,
        { bytes, maxResultBytes: this.limits.maxResultBytes },
      );
    }
    this.retainedBytes += bytes;
    if (this.retainedBytes > this.limits.maxRetainedBytes) {
      throw new DomainException(
        'NESTED_TREE_MEMORY_EXCEEDED',
        `La cadena retiene ${this.retainedBytes} bytes de resultados y el máximo es ${this.limits.maxRetainedBytes} (nodo ${nodeKey})`,
        HttpStatus.CONFLICT,
        {
          retainedBytes: this.retainedBytes,
          maxRetainedBytes: this.limits.maxRetainedBytes,
          nodeKey,
        },
      );
    }
  }

  get usedInvocations(): number {
    return this.invocations;
  }

  /** Bytes de resultados intermedios que la cadena lleva retenidos. */
  get usedRetainedBytes(): number {
    return this.retainedBytes;
  }
}
