import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../common/http/pagination';
import { DISTRIBUTION_SHAPES, type DistributionShape } from './seeded-random';

/**
 * Distribución de valores de una variable dentro de su rango (§10.4).
 *
 * `shape` sesga un rango numérico; `valueWeights` sesga una enumeración o un booleano.
 * Que la variable exista en el contrato de entradas NO se comprueba aquí sino en el
 * servicio, que es quien tiene el contrato delante: un código mal escrito debe fallar,
 * no quedarse callado sin sesgar nada.
 */
export class VariableDistributionDto {
  @IsString() @Matches(/^[A-Za-z0-9_.-]{1,120}$/) variableCode!: string;

  @IsOptional() @IsIn(DISTRIBUTION_SHAPES) shape?: DistributionShape;

  @IsOptional() @IsObject() valueWeights?: Record<string, number>;
}

export class GenerateQaRunDto {
  /** Ambiente destino. PROD queda excluido: QA nunca ejecuta contra producción. */
  @IsString() @Matches(/^[A-Z0-9_]{2,40}$/) environmentCode!: string;

  @IsInt() @Min(1) @Max(5_000) caseCount!: number;

  /**
   * Semilla explícita para reproducir una corrida anterior.
   *
   * El alfabeto se acota porque la semilla se archiva y se vuelve a mostrar junto a cada
   * contraejemplo (`replayPath`): dejarla libre metía saltos de línea y separadores en un
   * campo que la gente lee y copia para reproducir el fallo.
   */
  @IsOptional() @IsString() @MaxLength(64) @Matches(/^[A-Za-z0-9_.:-]+$/) seed?: string;

  @IsOptional() @IsInt() @Min(0) @Max(100) validPercent?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) invalidPercent?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) boundaryPercent?: number;

  /** Casos ejecutados a la vez. Acota la carga que una corrida puede meter al motor. */
  @IsOptional() @IsInt() @Min(1) @Max(32) concurrency?: number;

  /** Milisegundos máximos para la corrida completa. */
  @IsOptional() @IsInt() @Min(1_000) @Max(600_000) timeoutMs?: number;

  /** Detenerse en el primer contraejemplo en vez de recorrer el lote completo. */
  @IsOptional() @IsBoolean() stopOnFirstFailure?: boolean;

  /** Ejecutar cada caso dos veces para comprobar el determinismo. */
  @IsOptional() @IsBoolean() checkDeterminism?: boolean;

  /**
   * Distribución de valores por variable (§10.4). Sin esto el lote reparte uniformemente
   * dentro de cada rango, lo que infrarrepresenta las colas donde viven los casos raros.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => VariableDistributionDto)
  distributions?: VariableDistributionDto[];

  /**
   * Cómo se reparte la porción VÁLIDA del lote entre los desenlaces del grafo (§10.4).
   *
   * Las claves son `nodeKey` de nodos terminales alcanzables; los valores, pesos
   * relativos que se normalizan (no hace falta que sumen 100). Sin esto los válidos se
   * generan a ciegas y la mezcla real la decide el contrato: con un rango de score de
   * 300 a 900 y un corte en 750, cuatro de cada cinco casos «válidos» caen en la misma
   * rama y las otras se prueban de milagro. `validPercent` sigue decidiendo CUÁNTOS son
   * válidos; esto decide DÓNDE acaban.
   *
   * Una clave que no sea un desenlace de esta versión se rechaza en vez de ignorarse:
   * un peso que no se aplica deja una corrida verde presumiendo de un reparto que nunca
   * ocurrió.
   */
  @IsOptional() @IsObject() outcomeWeights?: Record<string, number>;

  /**
   * Añade a la tanda un caso por cada DESENLACE del grafo, además de los que salen de la
   * mezcla. Activo por omisión: una corrida de mil casos válidos puede recorrer siempre
   * la misma rama, y entonces el informe dice «mil pasaron» sobre un algoritmo cuya
   * mitad de decisiones no se ejecutó nunca. Estos casos NO consumen `caseCount`; se
   * suman, porque cuántos hay lo decide el grafo, no quien lanza la corrida.
   */
  @IsOptional() @Type(() => Boolean) @IsBoolean() coverOutcomes?: boolean;
}

export class QaRunQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() @Matches(/^\d{1,19}$/) artifactVersionId?: string;
  @IsOptional() @IsIn(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED']) status?: string;
}

export class ReplayCounterexampleDto {
  @IsOptional() @Type(() => Boolean) @IsBoolean() markResolved?: boolean;
}

/**
 * Valores de prueba para una versión concreta, sin ejecutarlos.
 *
 * A diferencia de una corrida, aquí no hay ambiente: el contrato sale de la versión
 * COMPILADA, que es la que la suite va a probar. Pedir un ambiente daría a elegir entre
 * dos contratos que pueden no coincidir, y el caso guardado quedaría contra el equivocado.
 */
export class GenerateSampleCasesDto {
  /** `OUTCOMES` genera un caso por cada desenlace del grafo; ver `outcome-coverage.ts`. */
  @IsOptional()
  @IsIn(['VALID', 'BOUNDARY', 'INVALID', 'OUTCOMES'])
  kind?: 'VALID' | 'BOUNDARY' | 'INVALID' | 'OUTCOMES';
  @IsOptional() @IsInt() @Min(1) @Max(50) count?: number;
  /** Semilla explícita: la misma semilla devuelve exactamente los mismos valores. */
  @IsOptional() @IsString() @MaxLength(64) seed?: string;
}
