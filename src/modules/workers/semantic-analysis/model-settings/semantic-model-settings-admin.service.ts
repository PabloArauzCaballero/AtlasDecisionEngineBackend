import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../../../common/audit/audit.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../../../common/security/security.types';
import type {
  SemanticModelSettingsDto,
  UpdateSemanticModelSettingsDto,
} from './semantic-model-settings.dto';
import { assertModelShape, publicShape, toEnum } from './semantic-model-settings.shape';
import { SemanticModelSettingsService, SINGLETON_ID } from './semantic-model-settings.service';

/** Lo que el portal puede hacer con la elección de gateway y modelos: ver, guardar y volver al entorno. */
@Injectable()
export class SemanticModelSettingsAdminService {
  private readonly logger = new Logger(SemanticModelSettingsAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SemanticModelSettingsService,
  ) {}

  async describe(): Promise<SemanticModelSettingsDto> {
    const effective = await this.settings.current();
    return {
      mode: this.settings.mode(),
      applies: this.settings.applies(),
      effective: {
        ...effective,
        updatedAt: effective.updatedAt?.toISOString() ?? null,
      },
      litellm: {
        available: this.settings.available('litellm'),
        ...this.settings.environmentDefaults('litellm'),
      },
      openrouter: {
        available: this.settings.available('openrouter'),
        ...this.settings.environmentDefaults('openrouter'),
      },
    };
  }

  /**
   * Valida y guarda. Las tres comprobaciones son las mismas que haría la fábrica
   * al construir el proveedor, hechas AQUÍ para que fallen en la petición de
   * quien guarda y no en la primera glosa del worker, media hora después.
   */
  async update(
    dto: UpdateSemanticModelSettingsDto,
    principal: AuthenticatedPrincipal,
  ): Promise<SemanticModelSettingsDto> {
    this.settings.assertApplies();
    this.settings.assertAvailable(dto.gateway);
    const fastModel = dto.fastModel.trim();
    const deepModel = dto.deepModel.trim();
    assertModelShape(dto.gateway, 'fastModel', fastModel);
    assertModelShape(dto.gateway, 'deepModel', deepModel);

    const before = await this.settings.current();
    const gateway = toEnum(dto.gateway);
    await this.prisma.$transaction(async (tx) => {
      await tx.semanticModelSetting.upsert({
        where: { id: SINGLETON_ID },
        create: { id: SINGLETON_ID, gateway, fastModel, deepModel, updatedBy: principal.id },
        update: {
          gateway,
          fastModel,
          deepModel,
          updatedBy: principal.id,
          version: { increment: 1 },
        },
      });
      await this.audit.append(
        {
          tenantId: principal.tenantId,
          eventType: 'SEMANTIC_MODEL_SETTINGS_UPDATED',
          aggregateType: 'SemanticModelSetting',
          aggregateId: String(SINGLETON_ID),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            before: publicShape(before),
            after: { gateway: dto.gateway, fastModel, deepModel },
          },
        },
        tx,
      );
    });

    await this.settings.invalidateAndNotify();
    this.logger.log(
      `Proveedor semántico cambiado a ${dto.gateway} (${fastModel} / ${deepModel}) por ${principal.id}`,
    );
    return this.describe();
  }

  /** Quita la fila: vuelve a mandar el entorno. */
  async reset(principal: AuthenticatedPrincipal): Promise<SemanticModelSettingsDto> {
    const before = await this.settings.current();
    if (before.source === 'portal') {
      await this.prisma.$transaction(async (tx) => {
        await tx.semanticModelSetting.deleteMany({ where: { id: SINGLETON_ID } });
        await this.audit.append(
          {
            tenantId: principal.tenantId,
            eventType: 'SEMANTIC_MODEL_SETTINGS_RESET',
            aggregateType: 'SemanticModelSetting',
            aggregateId: String(SINGLETON_ID),
            actorId: principal.id,
            requestId: principal.requestId,
            payload: { before: publicShape(before) },
          },
          tx,
        );
      });
      await this.settings.invalidateAndNotify();
      this.logger.log(`Proveedor semántico devuelto al entorno por ${principal.id}`);
    }
    return this.describe();
  }
}
