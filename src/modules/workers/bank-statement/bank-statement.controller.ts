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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { WorkerInputSource, WorkerRunStatus } from '@prisma/client';
import { DomainException } from '../../../common/errors/domain-exception';
import { paginationArgs } from '../../../common/http/pagination';
import { ApiArrayResponse, ApiPagedResponse } from '../../../common/http/pagination.dto';
import { CurrentPrincipal, Roles, TenantId } from '../../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../../common/security/security.types';
import {
  CreateBankStatementRunDto,
  StatementDownloadQueryDto,
  WorkerFixtureDto,
  WorkerRunDto,
  WorkerRunQueryDto,
} from '../workers.dto';
import { toWorkerRunDto } from '../workers.mapper';
import { validateStatementUpload } from './bank-statement-input';
import { BankStatementService } from './bank-statement.service';
import type { NormalizedBankStatement } from './core/engine/normalized/normalized-model';
import {
  BANK_STATEMENT_FIXTURES,
  findBankStatementFixture,
} from './fixtures/bank-statement-fixtures';
import { serializeStatement } from './statement-download';

/**
 * Superficie HTTP del worker de extractos.
 *
 * Los permisos se declaran aquí y los aplica el guardián del motor. No se
 * confía en que la interfaz oculte un botón: el portal recorta lo que enseña
 * por comodidad del usuario, no por seguridad, y estas rutas se pueden llamar
 * sin pasar por él.
 *
 * **Cargar un archivo exige más rol que ejecutar un escenario de prueba.** Un
 * fixture es sintético y versionado; un archivo subido es un documento bancario
 * real de una persona.
 */
@ApiTags('Workers · Extractos bancarios')
@Controller('v1/workers/bank-statement')
export class BankStatementController {
  constructor(
    private readonly statements: BankStatementService,
    private readonly config: ConfigService,
  ) {}

  @Get('fixtures')
  @ApiOperation({ summary: 'Escenarios de prueba disponibles' })
  @ApiArrayResponse('Escenarios sintéticos, sin datos reales.', WorkerFixtureDto)
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST')
  listFixtures(): WorkerFixtureDto[] {
    if (!this.fixturesEnabled()) return [];
    return BANK_STATEMENT_FIXTURES.map((fixture) => ({
      code: fixture.code,
      name: fixture.name,
      description: fixture.description,
      preview: fixture.preview,
      expectsFailure: fixture.expectsFailure,
    }));
  }

  /**
   * Encola una conversión, desde un escenario de prueba o desde un archivo.
   *
   * Devuelve `202` y no `201`: lo que se ha creado es el compromiso de
   * procesar, no el resultado. Responder `200` con el resultado obligaría a
   * mantener la petición abierta mientras se lee el PDF, que es justo lo que un
   * worker existe para evitar.
   */
  @Post('runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({ summary: 'Encola una conversión de extracto' })
  @ApiBody({ type: CreateBankStatementRunDto })
  @ApiAcceptedResponse({ description: 'Ejecución encolada.', type: WorkerRunDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS')
  async createRun(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: CreateBankStatementRunDto,
    @UploadedFile() file?: { originalname?: string; buffer?: Buffer; size?: number },
  ): Promise<WorkerRunDto> {
    const input = dto.fixtureCode
      ? this.fixtureInput(dto.fixtureCode)
      : {
          source: WorkerInputSource.UPLOAD,
          fixtureCode: undefined,
          validated: validateStatementUpload(file, this.statements.maxUploadBytes()),
        };

    const { run } = await this.statements.createRun(
      tenantId,
      principal,
      input.validated,
      input.source,
      input.fixtureCode,
    );
    return toWorkerRunDto(run);
  }

  @Get('runs')
  @ApiOperation({ summary: 'Ejecuciones del tenant' })
  @ApiPagedResponse('Página de ejecuciones, de la más reciente a la más antigua.', WorkerRunDto)
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  async listRuns(@TenantId() tenantId: bigint, @Query() query: WorkerRunQueryDto) {
    const { page, pageSize } = paginationArgs(query);
    const { items, total } = await this.statements.listRuns(tenantId, {
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
  @ApiOperation({ summary: 'Estado, progreso y resultado de una ejecución' })
  @ApiOkResponse({ type: WorkerRunDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  async getRun(
    @TenantId() tenantId: bigint,
    @Param('requestId') requestId: string,
  ): Promise<WorkerRunDto> {
    return toWorkerRunDto(await this.statements.getRun(tenantId, requestId));
  }

  @Post('runs/:requestId/cancel')
  @ApiOperation({ summary: 'Cancela una ejecución que nadie ha reclamado todavía' })
  @ApiOkResponse({ type: WorkerRunDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS')
  async cancelRun(
    @TenantId() tenantId: bigint,
    @Param('requestId') requestId: string,
  ): Promise<WorkerRunDto> {
    return toWorkerRunDto(await this.statements.cancelRun(tenantId, requestId));
  }

  @Get('runs/:requestId/download')
  @ApiOperation({ summary: 'Descarga el resultado en CSV o JSON' })
  /*
   * El cuerpo se declara aunque la respuesta se escriba con `@Res()`. Sin esto
   * el contrato publica una operación sin forma de respuesta y un cliente
   * generado a partir de él no sabe que recibe un archivo. Se declaran los dos
   * tipos posibles porque el formato lo elige `?format=`.
   */
  @ApiOkResponse({
    description: 'Archivo del resultado, ya enmascarado. El nombre viaja en `Content-Disposition`.',
    content: {
      'text/csv': { schema: { type: 'string', format: 'binary' } },
      'application/json': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  async download(
    @TenantId() tenantId: bigint,
    @Param('requestId') requestId: string,
    @Query() query: StatementDownloadQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const run = await this.statements.getRun(tenantId, requestId);
    if (!run.resultJson) {
      throw new DomainException(
        'BANK_STATEMENT_RESULT_NOT_READY',
        run.status === WorkerRunStatus.FAILED
          ? 'La ejecución falló, no hay resultado que descargar.'
          : 'La ejecución todavía no ha terminado.',
        HttpStatus.CONFLICT,
        { status: run.status },
      );
    }

    const download = serializeStatement(
      run.resultJson as unknown as NormalizedBankStatement,
      query.format,
      run.fileName,
    );
    response.setHeader('Content-Type', download.contentType);
    // `attachment` y no `inline`: un JSON servido en línea desde el mismo
    // origen que el portal es una superficie que no hace falta abrir. El nombre
    // va entre comillas porque se saneó al subir, pero no se supone.
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${download.fileName.replace(/"/g, '')}"`,
    );
    response.send(download.body);
  }

  /** Prepara la entrada de un escenario de prueba, si están habilitados. */
  private fixtureInput(code: string) {
    if (!this.fixturesEnabled()) {
      throw new DomainException(
        'WORKER_FIXTURES_DISABLED',
        'Los escenarios de prueba están deshabilitados en este entorno.',
        HttpStatus.FORBIDDEN,
      );
    }
    const fixture = findBankStatementFixture(code);
    if (!fixture) {
      throw new DomainException(
        'WORKER_FIXTURE_NOT_FOUND',
        'No existe ese escenario de prueba.',
        HttpStatus.NOT_FOUND,
      );
    }
    // El fixture pasa por la MISMA validación que un archivo subido. Si se
    // saltara, un escenario podría entrar en un estado que la entrada real no
    // puede producir, y dejaría de demostrar nada.
    return {
      source: WorkerInputSource.FIXTURE,
      fixtureCode: fixture.code,
      validated: validateStatementUpload(
        { originalname: fixture.fileName, buffer: fixture.build() },
        this.statements.maxUploadBytes(),
      ),
    };
  }

  private fixturesEnabled(): boolean {
    return this.config.get<boolean>('WORKERS_FIXTURES_ENABLED') ?? false;
  }
}
