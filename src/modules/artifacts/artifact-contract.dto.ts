/**
 * Contratos de autoría para las variables intermedias del grafo (§2) y para el
 * contrato de salida explícito del artefacto (§4).
 *
 * Viven fuera de `artifact.dto.ts` para no concentrar toda la autoría en un archivo:
 * son un eje distinto del contrato (alcance y gobierno del dato), con sus propias
 * reglas de validación.
 */
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { DATA_TYPES } from '../../common/contracts/data-types';
import { DATABASE_ID_PATTERN } from '../../common/http/id';

const VARIABLE_CODE = /^[a-zA-Z][a-zA-Z0-9_]{1,119}$/;
const NODE_KEY = /^[A-Za-z0-9_\-]{2,120}$/;
/** Mismo formato que `decision_reason_code.reason_code` (VarChar(120)). */
const REASON_CODE = /^[A-Za-z0-9_\-]{2,120}$/;

/**
 * Qué SIGNIFICA económicamente cada salida del artefacto.
 *
 * ## Por qué faltaba, y por qué importa
 *
 * La columna existía en la base, el gate de despliegue la leía y el guardián de decisiones la
 * validaba — pero NINGÚN camino de autoría la escribía. Es decir: el motor exigía a un artefacto de
 * originación declarar su probabilidad de incumplimiento para llegar a producción, y no ofrecía
 * ninguna forma de declararla. Todos los contratos quedaban en `NONE`, así que la política de
 * crédito real no podía publicarse en PROD por un requisito que era imposible de cumplir.
 *
 * ## Por qué el gate está bien y lo que estaba mal era el hueco
 *
 * Un artefacto que decide quién recibe crédito y no dice cuál es su probabilidad de incumplimiento
 * no se puede calibrar contra lo que realmente pasó, así que nadie podrá saber nunca si acierta.
 * La salida correcta no era relajar el gate: era permitir cumplirlo.
 */
const SEMANTIC_ROLES = [
  'NONE',
  'PROBABILITY_OF_DEFAULT',
  'LOSS_GIVEN_DEFAULT',
  'EXPOSURE_AT_DEFAULT',
  'EXPECTED_LOSS',
  'RISK_GRADE',
  'PRICED_RATE',
  'APPROVED_LIMIT',
  'APPROVED_TERM',
] as const;

export type SemanticRoleDto = (typeof SEMANTIC_ROLES)[number];

const SENSITIVITY = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'PII',
  'SENSITIVE_PII',
  'SECRET',
] as const;
const TRACE_POLICIES = ['FULL', 'MASKED', 'REDACTED', 'EXCLUDED'] as const;

export class IntermediateVariableDto {
  @IsString() @Matches(VARIABLE_CODE) code!: string;
  @IsString() @MaxLength(160) name!: string;
  @IsString() @MaxLength(4_000) description!: string;
  @IsIn([...DATA_TYPES]) dataType!: string;

  /** Nodo que la crea. Sin productor no hay disponibilidad calculable (§2.3). */
  @IsString() @Matches(NODE_KEY) producerNodeKey!: string;

  /** Vacío = cualquier nodo alcanzable después del productor puede leerla. */
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @Matches(NODE_KEY, { each: true })
  consumerNodeKeys!: string[];

  @IsOptional() initialValue?: unknown;
  @IsOptional() @IsObject() constraints?: Record<string, unknown>;
  @IsBoolean() nullable!: boolean;
  @IsIn(['SINGLE_WRITE', 'OVERWRITE', 'ACCUMULATE'])
  updatePolicy!: 'SINGLE_WRITE' | 'OVERWRITE' | 'ACCUMULATE';
  @IsOptional() @IsObject() availabilityCondition?: Record<string, unknown>;
  @IsIn([...SENSITIVITY]) sensitivityClass!: string;
  @IsIn([...TRACE_POLICIES]) tracePolicy!: 'FULL' | 'MASKED' | 'REDACTED' | 'EXCLUDED';
}

export class OutputContractFieldDto {
  @IsString() @Matches(VARIABLE_CODE) code!: string;
  @IsString() @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(4_000) description?: string;

  @IsIn(['NODE', 'EXPRESSION', 'INTERMEDIATE', 'CONSTANT', 'REFERENCE'])
  sourceKind!: 'NODE' | 'EXPRESSION' | 'INTERMEDIATE' | 'CONSTANT' | 'REFERENCE';
  /**
   * Referencia al origen, interpretada según `sourceKind`: clave de nodo, expresión
   * serializada, código de intermedia, literal JSON o `nodeKey:outputCode`.
   */
  @IsString() @MaxLength(500) sourceRef!: string;

  @IsOptional() @IsObject() valueMapping?: Record<string, unknown>;

  /** Motivos válidos de ausencia; solo tienen sentido en campos opcionales (§4). */
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  absenceReasons!: string[];

  /**
   * Motivos estructurados que la decisión puede devolver junto a este campo (§4).
   *
   * Van por CÓDIGO, no por id: es lo que el autor conoce y lo que hace que un
   * contrato siga significando lo mismo al moverlo entre entornos. El backend los
   * resuelve contra el catálogo del tenant y rechaza los que no existen.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Matches(REASON_CODE, { each: true })
  reasonCodes?: string[];

  @IsOptional() example?: unknown;
  @IsString() @MaxLength(20) contractVersion!: string;
  @IsIn([...SENSITIVITY]) sensitivityClass!: string;
  @IsIn([...TRACE_POLICIES]) tracePolicy!: 'FULL' | 'MASKED' | 'REDACTED' | 'EXCLUDED';

  /**
   * Qué representa este campo en términos de riesgo.
   *
   * Opcional y con `NONE` por defecto: la inmensa mayoría de las salidas de un artefacto no son
   * magnitudes económicas —un motivo, una etiqueta, un identificador— y obligar a clasificarlas
   * todas convertiría una declaración significativa en un trámite que se rellena sin mirar.
   *
   * Pero un artefacto de ORIGINACIÓN sí tiene que declarar su `PROBABILITY_OF_DEFAULT` antes de
   * llegar a producción, y hasta ahora no había manera de hacerlo: la columna sólo se leía.
   */
  @IsOptional() @IsIn([...SEMANTIC_ROLES]) semanticRole?: SemanticRoleDto;
}

/** Origen de una entrada de campo calculado dentro del grafo (§5.1). */
export class CalculatedFieldInputSourceDto {
  @IsIn(['VARIABLE', 'INTERMEDIATE', 'LITERAL', 'EXPRESSION'])
  source!: 'VARIABLE' | 'INTERMEDIATE' | 'LITERAL' | 'EXPRESSION';
  @IsOptional() @IsString() @MaxLength(300) path?: string;
  @IsOptional() value?: unknown;
  @IsOptional() @IsObject() expression?: Record<string, unknown>;
}

/**
 * Invocación de un campo calculado desde un nodo.
 *
 * El autor manda QUÉ versión invocar y CÓMO alimentarla; la definición ejecutable la
 * resuelve y congela el backend. Aceptarla del cliente sería aceptar código arbitrario
 * disfrazado de configuración.
 */
export class CalculatedFieldCallDto {
  @IsString() @Matches(/^[a-zA-Z][a-zA-Z0-9_]{1,119}$/) callKey!: string;
  @IsString() @Matches(DATABASE_ID_PATTERN) calculatedFieldVersionId!: string;

  /** `{ [inputId]: origen }`. */
  @IsObject() inputMapping!: Record<string, CalculatedFieldInputSourceDto>;

  @IsIn(['INTERMEDIATE', 'OUTPUT']) targetKind!: 'INTERMEDIATE' | 'OUTPUT';
  @IsString() @Matches(VARIABLE_CODE) targetCode!: string;
}

/** Fragmento que `ReplaceGraphDto` compone para no crecer sin límite. */
export class ContractExtensionsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => IntermediateVariableDto)
  intermediates?: IntermediateVariableDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OutputContractFieldDto)
  outputContract?: OutputContractFieldDto[];
}
