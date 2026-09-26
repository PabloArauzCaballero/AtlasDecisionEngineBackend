/**
 * El generador corriendo SUELTO: no hay contratos de artefactos que consultar.
 *
 * No lanza al construirse ni finge una lista vacía. Declara `available: false`, y
 * el caso de uso convierte eso en un 503 que dice exactamente por qué. La
 * diferencia importa: una lista vacía se lee como «este motor no tiene
 * artefactos», que es una afirmación falsa sobre el motor; `available: false` dice
 * la verdad, que es que este proceso no puede saberlo.
 */
import { Injectable } from '@nestjs/common';
import type {
  ArtifactContractPort,
  ArtifactOutputContract,
  ArtifactSummary,
} from '../../application/ports/artifact-contract.port';

@Injectable()
export class NullArtifactContractAdapter implements ArtifactContractPort {
  readonly available = false;

  async list(): Promise<readonly ArtifactSummary[]> {
    return [];
  }

  async get(): Promise<ArtifactOutputContract | undefined> {
    return undefined;
  }
}
