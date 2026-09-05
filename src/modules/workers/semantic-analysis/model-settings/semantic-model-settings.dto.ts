import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Superficie de la configuración del proveedor de modelo del worker semántico.
 *
 * Lo que se elige aquí es QUIÉN atiende el escalón remoto —el gateway propio o
 * OpenRouter— y con qué modelo en cada nivel. Lo que NO se elige aquí es el
 * modo (codificador local, cascada o directo): eso depende de qué contenedores
 * existen en el despliegue y sigue en el entorno.
 *
 * Ninguna credencial pasa por esta superficie, ni de entrada ni de salida. El
 * portal sólo puede saber si un gateway TIENE credencial, no cuál.
 */

export const MODEL_GATEWAYS = ['litellm', 'openrouter'] as const;
export type ModelGateway = (typeof MODEL_GATEWAYS)[number];

export class UpdateSemanticModelSettingsDto {
  @IsIn(MODEL_GATEWAYS)
  @ApiProperty({ enum: MODEL_GATEWAYS, example: 'openrouter' })
  gateway!: ModelGateway;

  /** Alias lógico con LiteLLM; `proveedor/modelo` con OpenRouter. La forma se valida según el gateway. */
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  @ApiProperty({ example: 'openai/gpt-4.1-mini' })
  fastModel!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  @ApiProperty({ example: 'anthropic/claude-sonnet-4.5' })
  deepModel!: string;
}

export class GatewayEnvironmentDto {
  @ApiProperty({
    description:
      'Si el proceso tiene la credencial de este gateway. Sin ella no se puede elegir: arrancaría sano y convertiría cada glosa en un pendiente de revisión.',
  })
  available!: boolean;

  @ApiProperty({ description: 'Modelo del nivel rápido declarado en el entorno.' })
  fastModel!: string;

  @ApiProperty({ description: 'Modelo del nivel profundo declarado en el entorno.' })
  deepModel!: string;
}

export class EffectiveModelSettingsDto {
  @ApiProperty({ enum: MODEL_GATEWAYS }) gateway!: ModelGateway;
  @ApiProperty() fastModel!: string;
  @ApiProperty() deepModel!: string;

  @ApiProperty({
    enum: ['environment', 'portal'],
    description: '`environment` cuando manda el entorno; `portal` cuando alguien lo eligió aquí.',
  })
  source!: 'environment' | 'portal';

  @ApiProperty({ description: '0 cuando manda el entorno; sube con cada cambio desde el portal.' })
  version!: number;

  @ApiPropertyOptional({ nullable: true }) updatedBy!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  updatedAt!: string | null;
}

export class SemanticModelSettingsDto {
  @ApiProperty({
    description:
      'Modo del despliegue (`SEMANTIC_ANALYSIS_PROVIDER`). La elección de gateway sólo tiene efecto en `litellm`, `openrouter` y `cascade`.',
    example: 'cascade',
  })
  mode!: string;

  @ApiProperty({
    description: 'Si la configuración elegida aquí tiene efecto en este despliegue.',
  })
  applies!: boolean;

  @ApiProperty({ type: EffectiveModelSettingsDto }) effective!: EffectiveModelSettingsDto;

  @ApiProperty({ type: GatewayEnvironmentDto }) litellm!: GatewayEnvironmentDto;
  @ApiProperty({ type: GatewayEnvironmentDto }) openrouter!: GatewayEnvironmentDto;
}

export class OpenRouterModelDto {
  @ApiProperty({ example: 'openai/gpt-4.1-mini' }) id!: string;
  @ApiProperty({ example: 'OpenAI: GPT-4.1 Mini' }) name!: string;
  @ApiProperty({ example: 1_047_576 }) contextLength!: number;
  @ApiProperty({ description: 'USD por millón de tokens de entrada.', example: 0.4 })
  promptUsdPerMillion!: number;
  @ApiProperty({ description: 'USD por millón de tokens de salida.', example: 1.6 })
  completionUsdPerMillion!: number;
  @ApiProperty({ description: 'Es uno de los dos modelos por omisión del motor.' })
  recommended!: boolean;
}

export class OpenRouterCatalogDto {
  @ApiProperty({
    description:
      'Modelos que declaran salida estructurada. Los demás se omiten: sin esquema estricto, cada glosa acabaría en revisión humana.',
    type: [OpenRouterModelDto],
  })
  models!: OpenRouterModelDto[];

  @ApiProperty({ type: String, format: 'date-time' }) fetchedAt!: string;
}

export class ModelProbeUsageDto {
  @ApiPropertyOptional() inputTokens?: number;
  @ApiPropertyOptional() outputTokens?: number;
  @ApiPropertyOptional() totalTokens?: number;
  @ApiPropertyOptional({ description: 'USD, según lo declaró el gateway.' }) estimatedCost?: number;
}

export class ModelProbeTierDto {
  @ApiProperty({ enum: ['FAST', 'DEEP'] }) tier!: 'FAST' | 'DEEP';
  @ApiProperty({ description: 'Lo que se pidió.' }) model!: string;
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional({ description: 'Lo que respondió: modelo y despliegue físico.' })
  respondedBy?: string;
  @ApiPropertyOptional() latencyMs?: number;
  @ApiPropertyOptional({ type: ModelProbeUsageDto }) usage?: ModelProbeUsageDto;
  @ApiPropertyOptional({ description: 'Categoría con más confianza sobre la glosa de prueba.' })
  topCategory?: string;
  @ApiPropertyOptional() confidence?: number;
  @ApiPropertyOptional({ description: 'Por qué falló. Nunca lleva credenciales.' })
  error?: string;
}

export class SemanticModelProbeDto {
  @ApiProperty({ enum: MODEL_GATEWAYS }) gateway!: ModelGateway;
  @ApiProperty({ type: [ModelProbeTierDto] }) tiers!: ModelProbeTierDto[];
}
