import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiAcceptedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorkerInputSource } from '@prisma/client';
import { DomainException } from '../../../common/errors/domain-exception';
import { paginationArgs } from '../../../common/http/pagination';
import { ApiArrayResponse, ApiPagedResponse } from '../../../common/http/pagination.dto';
import { CurrentPrincipal, Roles, TenantId } from '../../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../../common/security/security.types';
import {
  CreateSemanticAnalysisBatchDto,
  CreateSemanticAnalysisRunDto,
  WorkerFixtureDto,
  WorkerRunDto,
  WorkerRunQueryDto,
  WorkerRunStatusQueryDto,
} from '../workers.dto';
import { toWorkerRunDto } from '../workers.mapper';
import { SEMANTIC_FIXTURES, findSemanticFixture } from './fixtures/semantic-fixtures';
import { SemanticAnalysisService } from './semantic-analysis.service';

/**
 * Superficie HTTP del worker semántico.
 *
 * Mismos permisos y mismas reglas que el de extractos: ejecutar con datos
 * propios exige más rol que ejecutar un escenario sintético, y toda consulta va
 * acotada por tenant. Los permisos los valida el backend, no la interfaz.
 */
@ApiTags('Workers · Análisis semántico')
@Controller('v1/workers/semantic-analysis')
export class SemanticAnalysisController {
  constructor(
    private readonly analyses: SemanticAnalysisService,
    private readonly config: ConfigService,
  ) {}

  @Get('fixtures')
  @ApiOperation({ summary: 'Escenarios de prueba disponibles' })
  @ApiArrayResponse('Escenarios sintéticos, sin datos personales.', WorkerFixtureDto)
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST')
  listFixtures(): WorkerFixtureDto[] {
    if (!this.fixturesEnabled()) return [];
    return SEMANTIC_FIXTURES.map((fixture) => ({
      code: fixture.code,
      name: fixture.name,
      description: fixture.description,
      // La vista previa es el propio texto, recortado: es corto y verlo entero
      // antes de ejecutar es justamente lo que hace útil el escenario.
      preview: fixture.text.length > 200 ? `${fixture.text.slice(0, 197)}…` : fixture.text,
      expectsFailure: fixture.expectsFailure,
    }));
  }

  @Post('runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Encola un análisis semántico' })
  @ApiAcceptedResponse({ description: 'Análisis encolado.', type: WorkerRunDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS')
  async createRun(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: CreateSemanticAnalysisRunDto,
  ): Promise<WorkerRunDto> {
    // O texto o escenario, nunca los dos: aceptar ambos obliga a elegir uno en
    // silencio, y esa elección siempre sorprende a alguien.
    if (dto.text && dto.fixtureCode) {
      throw new DomainException(
        'SEMANTIC_INPUT_AMBIGUOUS',
        'Indica un texto o un escenario de prueba, no ambos.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const resolved = dto.fixtureCode
      ? this.fixtureInput(dto.fixtureCode)
      : { text: dto.text ?? '', source: WorkerInputSource.INLINE, fixtureCode: undefined };

    const { run } = await this.analyses.createRun(
      tenantId,
      principal,
      this.analyses.validateText(resolved.text),
      resolved.source,
      { fixtureCode: resolved.fixtureCode, idempotencyKey: dto.idempotencyKey },
    );
    return toWorkerRunDto({ ...run, warningsJson: run.warningsJson });
  }

  @Post('runs/batch')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Encola varios análisis semánticos de una vez' })
  @ApiAcceptedResponse({
    description: 'Ejecuciones encoladas, en el orden en que se pidieron.',
    type: [WorkerRunDto],
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS')
  async createRunBatch(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: CreateSemanticAnalysisBatchDto,
  ): Promise<WorkerRunDto[]> {
    // Se valida cada texto ANTES de escribir nada: un lote con una glosa vacía
    // se rechaza entero y con el mismo mensaje que tendría suelta, en vez de
    // encolar noventa y nueve y dejar la centésima sin explicación.
    const items = dto.items.map((item) => ({
      text: this.analyses.validateText(item.text),
      ...(item.idempotencyKey === undefined ? {} : { idempotencyKey: item.idempotencyKey }),
    }));
    const runs = await this.analyses.createRunBatch(tenantId, principal, items);
    return runs.map((run) => toWorkerRunDto(run));
  }

  @Post('runs/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Estado y resultado de varias ejecuciones' })
  @ApiOkResponse({ type: [WorkerRunDto] })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  async getRunStatuses(
    @TenantId() tenantId: bigint,
    @Body() dto: WorkerRunStatusQueryDto,
  ): Promise<WorkerRunDto[]> {
    const runs = await this.analyses.getRuns(tenantId, dto.requestIds);
    return runs.map(toWorkerRunDto);
  }

  @Get('runs')
  @ApiOperation({ summary: 'Análisis del tenant' })
  @ApiPagedResponse('Página de análisis, del más reciente al más antiguo.', WorkerRunDto)
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  async listRuns(@TenantId() tenantId: bigint, @Query() query: WorkerRunQueryDto) {
    const { page, pageSize } = paginationArgs(query);
    const { items, total } = await this.analyses.listRuns(tenantId, {
      page,
      pageSize,
      status: query.status,
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
  @ApiOperation({ summary: 'Estado, progreso y resultado de un análisis' })
  @ApiOkResponse({ type: WorkerRunDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  async getRun(
    @TenantId() tenantId: bigint,
    @Param('requestId') requestId: string,
  ): Promise<WorkerRunDto> {
    return toWorkerRunDto(await this.analyses.getRun(tenantId, requestId));
  }

  @Post('runs/:requestId/cancel')
  @ApiOperation({ summary: 'Cancela un análisis que nadie ha reclamado todavía' })
  @ApiOkResponse({ type: WorkerRunDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS')
  async cancelRun(
    @TenantId() tenantId: bigint,
    @Param('requestId') requestId: string,
  ): Promise<WorkerRunDto> {
    return toWorkerRunDto(await this.analyses.cancelRun(tenantId, requestId));
  }

  private fixtureInput(code: string) {
    if (!this.fixturesEnabled()) {
      throw new DomainException(
        'WORKER_FIXTURES_DISABLED',
        'Los escenarios de prueba están deshabilitados en este entorno.',
        HttpStatus.FORBIDDEN,
      );
    }
    const fixture = findSemanticFixture(code);
    if (!fixture) {
      throw new DomainException(
        'WORKER_FIXTURE_NOT_FOUND',
        'No existe ese escenario de prueba.',
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      text: fixture.text,
      source: WorkerInputSource.FIXTURE,
      fixtureCode: fixture.code,
    };
  }

  private fixturesEnabled(): boolean {
    return this.config.get<boolean>('WORKERS_FIXTURES_ENABLED') ?? false;
  }
}
