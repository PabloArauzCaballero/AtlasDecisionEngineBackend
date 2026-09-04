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
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { WorkerInputSource } from '@prisma/client';
import type { Response } from 'express';
import { DomainException } from '../../../common/errors/domain-exception';
import { paginationArgs } from '../../../common/http/pagination';
import { ApiArrayResponse, ApiPagedResponse } from '../../../common/http/pagination.dto';
import { CurrentPrincipal, Roles, TenantId } from '../../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../../common/security/security.types';
import {
  CreateIdentityVerificationRunDto,
  WorkerFixtureDto,
  WorkerRunDto,
  WorkerRunQueryDto,
} from '../workers.dto';
import { toWorkerRunDto } from '../workers.mapper';
import {
  buildIdentityFixtureImages,
  findIdentityFixture,
  IDENTITY_FIXTURES,
} from './fixtures/identity-fixtures';
import { validateIdentityUpload, type ValidatedIdentityInput } from './identity-verification-input';
import { IdentityVerificationService } from './identity-verification.service';

/** Los tres campos de archivo que acepta el alta. */
const IMAGE_FIELDS = [
  { name: 'document', maxCount: 1 },
  { name: 'documentBack', maxCount: 1 },
  { name: 'selfie', maxCount: 1 },
];

/**
 * Los archivos tal como los deja `FileFieldsInterceptor`.
 *
 * Se declara estructuralmente y no como `Express.Multer.File`, igual que hace
 * el controlador de extractos: el motor no instala `@types/multer` —el tipo no
 * aporta nada que estos tres campos no digan ya— y añadirlo sólo para nombrar
 * una forma que aquí se usa entera sería una dependencia por comodidad.
 */
interface UploadedImage {
  originalname?: string;
  buffer?: Buffer;
  size?: number;
  mimetype?: string;
}

interface UploadedImages {
  document?: UploadedImage[];
  documentBack?: UploadedImage[];
  selfie?: UploadedImage[];
}

/**
 * Superficie HTTP del worker de verificación de identidad.
 *
 * Los permisos se declaran aquí y los aplica el guardián del motor, igual que
 * en los otros dos workers: el portal recorta lo que enseña por comodidad del
 * usuario, no por seguridad, y estas rutas se pueden llamar sin pasar por él.
 *
 * **Subir imágenes exige más rol que ejecutar un escenario de prueba**, y aquí
 * la diferencia pesa más que en ningún otro worker: un escenario es ruido
 * generado; una subida es la cara y la cédula de una persona.
 */
@ApiTags('Workers · Verificación de identidad')
@Controller('v1/workers/identity-verification')
export class IdentityVerificationController {
  constructor(
    private readonly identity: IdentityVerificationService,
    private readonly config: ConfigService,
  ) {}

  @Get('fixtures')
  @ApiOperation({ summary: 'Escenarios de prueba disponibles' })
  @ApiArrayResponse('Escenarios sintéticos, sin datos de ninguna persona.', WorkerFixtureDto)
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST')
  listFixtures(): WorkerFixtureDto[] {
    if (!this.fixturesEnabled()) return [];
    return IDENTITY_FIXTURES.map((fixture) => ({
      code: fixture.code,
      name: fixture.name,
      description: fixture.description,
      preview: fixture.preview,
      expectsFailure: fixture.expectsFailure,
    }));
  }

  /**
   * Encola una verificación, desde un escenario de prueba o desde dos fotos.
   *
   * Devuelve `202` y no `201`: lo creado es el compromiso de verificar, no el
   * veredicto. Mantener la petición abierta mientras un proveedor biométrico
   * responde es justo lo que un worker existe para evitar.
   */
  @Post('runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileFieldsInterceptor(IMAGE_FIELDS))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({ summary: 'Encola una verificación de identidad' })
  @ApiBody({ type: CreateIdentityVerificationRunDto })
  @ApiAcceptedResponse({ description: 'Verificación encolada.', type: WorkerRunDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS')
  async createRun(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: CreateIdentityVerificationRunDto,
    @UploadedFiles() files?: UploadedImages,
  ): Promise<WorkerRunDto> {
    const country = (dto.documentCountry ?? this.identity.defaultDocumentCountry()).toUpperCase();
    const prepared = dto.fixtureCode
      ? await this.fixtureInput(dto.fixtureCode, dto.idempotencyKey)
      : {
          source: WorkerInputSource.UPLOAD,
          fixtureCode: undefined,
          validated: this.uploadInput(files, dto.idempotencyKey),
        };

    const { run } = await this.identity.createRun(
      tenantId,
      principal,
      prepared.validated,
      prepared.source,
      {
        documentCountry: country,
        ...(prepared.fixtureCode ? { fixtureCode: prepared.fixtureCode } : {}),
      },
    );
    return toWorkerRunDto(run);
  }

  @Get('runs')
  @ApiOperation({ summary: 'Verificaciones del tenant' })
  @ApiPagedResponse('Página de verificaciones, de la más reciente a la más antigua.', WorkerRunDto)
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  async listRuns(@TenantId() tenantId: bigint, @Query() query: WorkerRunQueryDto) {
    const { page, pageSize } = paginationArgs(query);
    const { items, total } = await this.identity.listRuns(tenantId, {
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
  @ApiOperation({ summary: 'Estado, progreso y veredicto de una verificación' })
  @ApiOkResponse({ type: WorkerRunDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  async getRun(
    @TenantId() tenantId: bigint,
    @Param('requestId') requestId: string,
  ): Promise<WorkerRunDto> {
    return toWorkerRunDto(await this.identity.getRun(tenantId, requestId));
  }

  @Get('runs/:requestId/images/:kind')
  @ApiOperation({
    summary: 'Una de las tres imágenes de la verificación, desde el almacén persistente',
    description:
      'Sirve los bytes por la API, no una URL firmada del almacén: la autorización por tenant y por rol la ' +
      'impone este proceso, y una URL prefirmada se reenvía por un chat y sigue funcionando hasta que vence. ' +
      'Las ejecuciones anteriores al 2026-09-03 responden 404: sus imágenes se borraban al cerrar.',
  })
  /*
   * Se declara el cuerpo aunque la respuesta se escriba con `@Res()`, igual que en la descarga del
   * worker de extractos: sin esto el contrato publica una operación sin forma de respuesta y un
   * cliente generado desde él no sabe que recibe un archivo.
   */
  @ApiOkResponse({
    description: 'La imagen. `Cache-Control: no-store` — es la cara de una persona.',
    content: {
      'image/jpeg': { schema: { type: 'string', format: 'binary' } },
      'image/png': { schema: { type: 'string', format: 'binary' } },
      'image/webp': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  async getRunImage(
    @TenantId() tenantId: bigint,
    @Param('requestId') requestId: string,
    @Param('kind') kind: string,
    @Res() response: Response,
  ): Promise<void> {
    if (kind !== 'document' && kind !== 'documentBack' && kind !== 'selfie') {
      throw new DomainException(
        'IDENTITY_IMAGE_KIND_INVALID',
        'La imagen pedida no existe: usa document, documentBack o selfie.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const image = await this.identity.getRunImage(tenantId, requestId, kind);
    if (!image) {
      throw new DomainException(
        'IDENTITY_IMAGE_NOT_AVAILABLE',
        'Esa imagen no está disponible para esta verificación.',
        HttpStatus.NOT_FOUND,
      );
    }

    // `no-store` y no `private, max-age`: un caché intermedio que guarde la cara de un cliente es
    // exactamente lo que no se le promete a nadie en la pantalla de subida.
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', image.contentType);
    response.setHeader('Content-Length', String(image.content.byteLength));
    response.end(image.content);
  }

  @Post('runs/:requestId/cancel')
  @ApiOperation({ summary: 'Cancela una verificación que nadie ha reclamado todavía' })
  @ApiOkResponse({ type: WorkerRunDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS')
  async cancelRun(
    @TenantId() tenantId: bigint,
    @Param('requestId') requestId: string,
  ): Promise<WorkerRunDto> {
    return toWorkerRunDto(await this.identity.cancelRun(tenantId, requestId));
  }

  private uploadInput(
    files: UploadedImages | undefined,
    idempotencyKey?: string,
  ): ValidatedIdentityInput {
    return validateIdentityUpload(
      {
        ...(files?.document?.[0] ? { document: files.document[0] } : {}),
        ...(files?.documentBack?.[0] ? { documentBack: files.documentBack[0] } : {}),
        ...(files?.selfie?.[0] ? { selfie: files.selfie[0] } : {}),
      },
      this.identity.maxUploadBytes(),
      idempotencyKey,
      this.identity.decisionRulesFingerprint(),
    );
  }

  /** Prepara la entrada de un escenario, si están habilitados. */
  private async fixtureInput(code: string, idempotencyKey?: string) {
    if (!this.fixturesEnabled()) {
      throw new DomainException(
        'WORKER_FIXTURES_DISABLED',
        'Los escenarios de prueba están deshabilitados en este entorno.',
        HttpStatus.FORBIDDEN,
      );
    }
    const fixture = findIdentityFixture(code);
    if (!fixture) {
      throw new DomainException(
        'WORKER_FIXTURE_NOT_FOUND',
        'No existe ese escenario de prueba.',
        HttpStatus.NOT_FOUND,
      );
    }
    const images = await buildIdentityFixtureImages(fixture);
    // El escenario pasa por la MISMA validación que una subida real. Si se la
    // saltara podría entrar en un estado que la entrada real no puede producir,
    // y dejaría de demostrar nada.
    return {
      source: WorkerInputSource.FIXTURE,
      fixtureCode: fixture.code,
      validated: validateIdentityUpload(
        {
          document: { originalname: `${fixture.code}-documento.png`, buffer: images.document },
          // El reverso viaja cuando el escenario lo tiene: es donde está la MRZ,
          // que es la única fuente del documento con dígitos de control.
          ...(images.documentBack
            ? {
                documentBack: {
                  originalname: `${fixture.code}-reverso.png`,
                  buffer: images.documentBack,
                },
              }
            : {}),
          selfie: { originalname: `${fixture.code}-selfie.png`, buffer: images.selfie },
        },
        this.identity.maxUploadBytes(),
        idempotencyKey,
        this.identity.decisionRulesFingerprint(),
      ),
    };
  }

  private fixturesEnabled(): boolean {
    return this.config.get<boolean>('WORKERS_FIXTURES_ENABLED') ?? false;
  }
}
