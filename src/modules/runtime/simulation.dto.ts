import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Input accepted by the management-only, non-persistent decision simulator. */
export class SimulateDecisionDto {
  @IsString() @IsNotEmpty() @MaxLength(120) requestId!: string;
  @IsString() @Matches(/^[A-Z0-9_\-]{2,40}$/) environmentCode!: string;
  @IsObject() variables!: Record<string, unknown>;
  @IsOptional() @IsObject() context?: Record<string, unknown>;
  /**
   * Ejecuta además el artefacto activo en PROD con las MISMAS entradas ya resueltas y
   * compara los dos resultados (§12, `atlas_dev_prod_result_diff_total`).
   *
   * Sigue sin persistir nada y sin llamar a proveedores externos: es una segunda pasada del
   * motor sobre otro artefacto compilado. Es opcional porque duplica el coste de la
   * simulación, y esa decisión es de quien la lanza.
   */
  @IsOptional() @IsBoolean() compareWithProduction?: boolean;
}

/**
 * Genera valores de prueba a partir del contrato REAL del artefacto desplegado.
 *
 * Se resuelve por el mismo despliegue que usa la simulación, no por el catálogo: si los
 * valores se generaran contra otro contrato, el botón produciría entradas que el
 * simulador rechaza acto seguido, y sería peor que no tenerlo.
 */
export class GenerateSampleInputsDto {
  @IsString() @Matches(/^[A-Z0-9_\-]{2,40}$/) environmentCode!: string;
  /** VALID respeta el contrato; BOUNDARY va al límite; INVALID debe ser rechazado. */
  @IsOptional() @IsIn(['VALID', 'BOUNDARY', 'INVALID']) kind?: 'VALID' | 'BOUNDARY' | 'INVALID';
  @IsOptional() @IsInt() @Min(1) @Max(50) count?: number;
  /** Semilla explícita: la misma semilla devuelve exactamente los mismos valores. */
  @IsOptional() @IsString() @MaxLength(64) seed?: string;
}
