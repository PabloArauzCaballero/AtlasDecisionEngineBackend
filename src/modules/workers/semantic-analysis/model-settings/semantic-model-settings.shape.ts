import { HttpStatus } from '@nestjs/common';
import type { Prisma, SemanticModelSetting } from '@prisma/client';
import { DomainException } from '../../../../common/errors/domain-exception';
import { assertLogicalAlias } from '../core/config/litellm-provider.config';
import { assertOpenRouterModelId } from '../core/config/openrouter-provider.config';
import { SemanticConfigurationError } from '../core/domain/semantic-analysis.errors';
import type { ModelGateway } from './semantic-model-settings.dto';

export interface EffectiveModelSettings {
  readonly gateway: ModelGateway;
  readonly fastModel: string;
  readonly deepModel: string;
  /** `environment` cuando no hay fila; `portal` cuando alguien la escribió. */
  readonly source: 'environment' | 'portal';
  /** 0 cuando manda el entorno. Es la clave con la que el proveedor construido se cachea. */
  readonly version: number;
  readonly updatedBy: string | null;
  readonly updatedAt: Date | null;
}

export type ChangeListener = (settings: EffectiveModelSettings) => void;

/** La forma que espera el gateway, con el mismo mensaje que daría la fábrica. */
export function assertModelShape(gateway: ModelGateway, field: string, model: string): void {
  try {
    if (gateway === 'openrouter') assertOpenRouterModelId(field, model);
    else assertLogicalAlias(field, model);
  } catch (error) {
    if (error instanceof SemanticConfigurationError) {
      throw new DomainException('SEMANTIC_MODEL_INVALID', error.message, HttpStatus.BAD_REQUEST, {
        field,
        gateway,
      });
    }
    throw error;
  }
}

export function toEnum(gateway: ModelGateway): SemanticModelSetting['gateway'] {
  return gateway === 'openrouter' ? 'OPENROUTER' : 'LITELLM';
}

export function fromEnum(gateway: SemanticModelSetting['gateway']): ModelGateway {
  return gateway === 'OPENROUTER' ? 'openrouter' : 'litellm';
}

/** Lo que va a la auditoría: sin fechas ni versión, que ya las lleva el evento. */
export function publicShape(settings: EffectiveModelSettings): Prisma.InputJsonObject {
  return {
    gateway: settings.gateway,
    fastModel: settings.fastModel,
    deepModel: settings.deepModel,
    source: settings.source,
  };
}
