import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AudioTemplateStrategy } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { templateTokens } from './core/application/template-renderer';
import { DEFAULT_AUDIO_TEMPLATES } from './fixtures/audio-tts-fixtures';

/** Una plantilla, tal como la ve quien va a locutarla. */
export interface AudioTemplateView {
  code: string;
  version: number;
  strategy: AudioTemplateStrategy;
  templateText: string;
  language: string | null;
  /** Las variables que hay que rellenar, deducidas del propio texto. */
  variables: string[];
  isActive: boolean;
}

/** El catálogo de lo que se puede locutar, sembrado por omisión la primera vez. */
@Injectable()
export class AudioTemplateCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** El catálogo de lo que se puede locutar, con sus variables. */
  async listTemplates(tenantId: bigint): Promise<AudioTemplateView[]> {
    await this.ensureDefaultTemplates(tenantId);
    const rows = await this.prisma.audioTemplate.findMany({
      where: { tenantId, isActive: true },
      orderBy: { code: 'asc' },
    });
    return rows.map((row) => ({
      code: row.code,
      version: row.version,
      strategy: row.strategy,
      templateText: row.templateText,
      language: row.language,
      // Se deducen del texto y no se guardan en una columna: una columna se
      // desincroniza del texto en cuanto alguien edita la plantilla, y entonces
      // el formulario pide variables que ya no existen.
      variables: [...new Set(templateTokens(row.templateText))],
      isActive: row.isActive,
    }));
  }

  /**
   * Siembra las plantillas por omisión del tenant, una sola vez.
   *
   * Sin catálogo, la pantalla del worker se abre vacía y no hay forma de probar
   * nada; con él, hay algo que locutar desde el primer minuto. Es idempotente y
   * **no genera audio**: sembrar es escribir texto, y generar cuesta dinero. La
   * primera locución sigue siendo una decisión de una persona.
   */
  async ensureDefaultTemplates(tenantId: bigint): Promise<void> {
    const existing = await this.prisma.audioTemplate.count({ where: { tenantId } });
    if (existing > 0) return;
    const language = this.config.get<string>('AUDIO_TTS_DEFAULT_LANGUAGE') ?? 'es-419';
    await this.prisma.audioTemplate.createMany({
      data: DEFAULT_AUDIO_TEMPLATES.map((template) => ({
        tenantId,
        code: template.code,
        version: 1,
        strategy: AudioTemplateStrategy[template.strategy],
        templateText: template.templateText,
        language,
        fallbackTemplateCode: template.fallbackTemplateCode,
      })),
      // Otra petición simultánea pudo sembrarlas entre el conteo y esto.
      skipDuplicates: true,
    });
  }
}
