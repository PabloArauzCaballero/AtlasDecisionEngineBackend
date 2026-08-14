import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiAcceptedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorkerInputSource } from '@prisma/client';
import type { Response } from 'express';
import { DomainException } from '../../../common/errors/domain-exception';
import { paginationArgs } from '../../../common/http/pagination';
import { ApiArrayResponse, ApiPagedResponse } from '../../../common/http/pagination.dto';
import { CurrentPrincipal, Roles, TenantId } from '../../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../../common/security/security.types';
import {
  AudioTemplateDto,
  CreateAudioTtsRunDto,
  WorkerFixtureDto,
  WorkerRunDto,
  WorkerRunQueryDto,
} from '../workers.dto';
import { toWorkerRunDto } from '../workers.mapper';
import { validateAudioRequest, type ValidatedAudioInput } from './audio-tts-input';
import { AudioTtsService } from './audio-tts.service';
import { AUDIO_TTS_FIXTURES, findAudioTtsFixture } from './fixtures/audio-tts-fixtures';

/**
 * Superficie HTTP del worker de locución.
 *
 * Los permisos se declaran aquí y los aplica el guardián del motor, igual que
 * en los otros tres workers: el portal recorta lo que enseña por comodidad del
 * usuario, no por seguridad, y estas rutas se pueden llamar sin pasar por él.
 *
 * **Locutar exige más rol que consultar**, y aquí la razón no es la privacidad
 * sino el dinero: cada locución que no está en caché es una llamada facturada a
 * un proveedor externo. Escuchar lo ya generado no cuesta nada y por eso lo
 * puede hacer más gente.
 */
@ApiTags('Workers · Locución')
@Controller('v1/workers/audio-tts')
export class AudioTtsController {
  constructor(
    private readonly audio: AudioTtsService,
    private readonly config: ConfigService,
  ) {}

  @Get('fixtures')
  @ApiOperation({ summary: 'Escenarios de prueba disponibles' })
  @ApiArrayResponse('Escenarios sintéticos, sobre las plantillas del catálogo.', WorkerFixtureDto)
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST')
  listFixtures(): WorkerFixtureDto[] {
    if (!this.fixturesEnabled()) return [];
    return AUDIO_TTS_FIXTURES.map((fixture) => ({
      code: fixture.code,
      name: fixture.name,
      description: fixture.description,
      preview: fixture.preview,
      expectsFailure: fixture.expectsFailure,
    }));
  }

  /**
   * El catálogo de lo que se puede locutar.
   *
   * Es una ruta propia y no un campo de `/v1/workers` porque es DATO del
   * tenant, no configuración del despliegue: cambia sin desplegar y cada
   * organización tiene el suyo. Publica las variables de cada plantilla para
   * que el formulario pueda pedirlas sin que nadie las escriba a mano.
   */
  @Get('templates')
  @ApiOperation({ summary: 'Plantillas de locución del tenant, con sus variables' })
  @ApiArrayResponse('Plantillas activas.', AudioTemplateDto)
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  async listTemplates(@TenantId() tenantId: bigint): Promise<AudioTemplateDto[]> {
    return this.audio.listTemplates(tenantId);
  }

  /**
   * Encola una locución, desde un escenario de prueba o desde una plantilla.
   *
   * Devuelve `202` y no `201`: lo creado es el compromiso de locutar, no el
   * audio. Y no siempre hay que locutar nada — si la frase ya se dijo alguna
   * vez con esta misma voz, la ejecución terminará sirviendo lo que había.
   */
  @Post('runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Encola una locución' })
  @ApiAcceptedResponse({ description: 'Locución encolada.', type: WorkerRunDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS')
  async createRun(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: CreateAudioTtsRunDto,
  ): Promise<WorkerRunDto> {
    const prepared = dto.fixtureCode
      ? this.fixtureInput(dto.fixtureCode, dto.idempotencyKey)
      : {
          source: WorkerInputSource.INLINE,
          fixtureCode: undefined,
          validated: this.templateInput(dto),
        };

    const { run } = await this.audio.createRun(
      tenantId,
      principal,
      prepared.validated,
      prepared.source,
      prepared.fixtureCode ? { fixtureCode: prepared.fixtureCode } : {},
    );
    return toWorkerRunDto(run);
  }

  @Get('runs')
  @ApiOperation({ summary: 'Locuciones del tenant' })
  @ApiPagedResponse('Página de locuciones, de la más reciente a la más antigua.', WorkerRunDto)
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  async listRuns(@TenantId() tenantId: bigint, @Query() query: WorkerRunQueryDto) {
    const { page, pageSize } = paginationArgs(query);
    const { items, total } = await this.audio.listRuns(tenantId, {
      page,
      pageSize,
      ...(query.status ? { status: query.status } : {}),
    });
    return {
      items: items.map(toWorkerRunDto),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      hasNextPage: page * pageSize < total,
    };
  }

  @Get('runs/:requestId')
  @ApiOperation({ summary: 'Estado, progreso y desenlace de una locución' })
  @ApiOkResponse({ type: WorkerRunDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  async getRun(
    @TenantId() tenantId: bigint,
    @Param('requestId') requestId: string,
  ): Promise<WorkerRunDto> {
    return toWorkerRunDto(await this.audio.getRun(tenantId, requestId));
  }

  @Post('runs/:requestId/cancel')
  @ApiOperation({ summary: 'Cancela una locución que nadie ha reclamado todavía' })
  @ApiOkResponse({ type: WorkerRunDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS')
  async cancelRun(
    @TenantId() tenantId: bigint,
    @Param('requestId') requestId: string,
  ): Promise<WorkerRunDto> {
    return toWorkerRunDto(await this.audio.cancelRun(tenantId, requestId));
  }

  /**
   * El audio, por la puerta autenticada.
   *
   * No hay URL firmada, y es deliberado: una URL firmada reproduce el audio sin
   * pasar por el guardián durante todo su tiempo de vida, así que quien la
   * comparte comparte la locución. Aquí el permiso se decide en cada petición.
   *
   * Va `inline` y no `attachment`, al revés que la descarga del extracto: lo que
   * se espera de un audio es reproducirlo, y forzar la descarga obligaría a
   * guardar un archivo para escuchar una frase. `Content-Type` sale del tipo que
   * declaró el proveedor, ya comprobado contra los bytes reales al generarlo.
   */
  @Get('runs/:requestId/audio')
  @ApiOperation({ summary: 'Reproduce o descarga el audio de una locución' })
  @ApiOkResponse({
    description: 'Los bytes del audio. El nombre viaja en `Content-Disposition`.',
    content: { 'audio/mpeg': { schema: { type: 'string', format: 'binary' } } },
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  async audioOf(
    @TenantId() tenantId: bigint,
    @Param('requestId') requestId: string,
    @Res() response: Response,
  ): Promise<void> {
    const audio = await this.audio.readAudio(tenantId, requestId);
    response.setHeader('Content-Type', audio.mimeType);
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${audio.fileName.replace(/"/g, '')}"`,
    );
    response.send(audio.bytes);
  }

  private templateInput(dto: CreateAudioTtsRunDto): ValidatedAudioInput {
    return validateAudioRequest(
      {
        ...(dto.templateCode ? { templateCode: dto.templateCode } : {}),
        ...(dto.variables ? { variables: dto.variables } : {}),
        ...(dto.language ? { language: dto.language } : {}),
      },
      this.audio.renderFingerprint(),
      dto.idempotencyKey,
    );
  }

  /** Prepara la entrada de un escenario, si están habilitados. */
  private fixtureInput(code: string, idempotencyKey?: string) {
    if (!this.fixturesEnabled()) {
      throw new DomainException(
        'WORKER_FIXTURES_DISABLED',
        'Los escenarios de prueba están deshabilitados en este entorno.',
        HttpStatus.FORBIDDEN,
      );
    }
    const fixture = findAudioTtsFixture(code);
    if (!fixture) {
      throw new DomainException(
        'WORKER_FIXTURE_NOT_FOUND',
        'No existe ese escenario de prueba.',
        HttpStatus.NOT_FOUND,
      );
    }
    // El escenario pasa por la MISMA validación que una solicitud normal. Si se
    // la saltara podría entrar en un estado que la entrada real no produce, y
    // dejaría de demostrar nada — incluido el escenario que falla a propósito.
    return {
      source: WorkerInputSource.FIXTURE,
      fixtureCode: fixture.code,
      validated: validateAudioRequest(
        { templateCode: fixture.templateCode, variables: { ...fixture.variables } },
        this.audio.renderFingerprint(),
        idempotencyKey,
      ),
    };
  }

  private fixturesEnabled(): boolean {
    return this.config.get<boolean>('WORKERS_FIXTURES_ENABLED') ?? false;
  }
}
