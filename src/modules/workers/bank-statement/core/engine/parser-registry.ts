import { Injectable } from '@nestjs/common';
import type { StatementParser } from '../domain/statement-parser';
import type { StatementContext } from './statement-context';
import {
  STRATEGY_PRIORITY,
  type ResolvedStrategy,
  type StatementParserStrategy,
} from './parser-strategy';
import { SpecializedParserStrategy } from './specialized-parser.strategy';

/**
 * Registro extensible de estrategias de análisis.
 *
 * El núcleo no importa ningún banco: recibe estrategias ya construidas y las
 * ordena por evidencia. Añadir una entidad es registrar una estrategia más
 * —compilada, cargada desde un perfil o aportada por el anfitrión— sin tocar
 * este archivo ni el worker.
 */
@Injectable()
export class StatementParserRegistry {
  private readonly strategies: StatementParserStrategy[] = [];

  /**
   * Construye el registro a partir de los analizadores especializados del
   * módulo. Es el punto de entrada que usa la configuración de Nest.
   */
  static fromSpecializedParsers(parsers: readonly StatementParser[]): StatementParserRegistry {
    const registry = new StatementParserRegistry();
    for (const parser of parsers) {
      registry.register(new SpecializedParserStrategy(parser));
    }
    return registry;
  }

  /**
   * @throws si el identificador ya está registrado. Dos estrategias con el
   * mismo `id` harían ambiguas las trazas y la resolución, que es justamente lo
   * que este registro existe para evitar.
   */
  register(strategy: StatementParserStrategy): void {
    if (this.strategies.some((candidate) => candidate.id === strategy.id)) {
      throw new Error(`Ya existe una estrategia registrada con id ${strategy.id}.`);
    }
    this.strategies.push(strategy);
  }

  list(): readonly StatementParserStrategy[] {
    return [...this.strategies];
  }

  /**
   * Todas las estrategias que aceptan el documento, de la más a la menos
   * apropiada. Devolver la lista completa —y no solo la ganadora— es lo que
   * permite la cascada: si la primera no produce un resultado utilizable, el
   * worker puede continuar con la siguiente en lugar de fallar.
   *
   * El orden es determinista: confianza, después especificidad del tipo y, a
   * igualdad de ambas, orden de registro. Sin el segundo criterio, un empate
   * fortuito dejaría que el motor generalista desplazara a un analizador
   * verificado.
   */
  async resolveAll(context: StatementContext): Promise<ResolvedStrategy[]> {
    const evaluated = await Promise.all(
      this.strategies.map(async (strategy, index) => ({
        strategy,
        detection: await strategy.canHandle(context),
        index,
      })),
    );

    return evaluated
      .filter((candidate) => candidate.detection.canHandle)
      .sort(
        (a, b) =>
          b.detection.confidence - a.detection.confidence ||
          STRATEGY_PRIORITY[b.strategy.kind] - STRATEGY_PRIORITY[a.strategy.kind] ||
          a.index - b.index,
      )
      .map(({ strategy, detection }) => ({ strategy, detection }));
  }

  async resolve(context: StatementContext): Promise<ResolvedStrategy | undefined> {
    const [best] = await this.resolveAll(context);
    return best;
  }
}
