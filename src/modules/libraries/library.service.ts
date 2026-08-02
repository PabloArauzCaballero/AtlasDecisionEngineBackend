/**
 * Registro de librerías autorizadas (§7).
 *
 * Aprobar una librería solo HABILITA un prelude que ya existe en el repositorio
 * (`library-preludes.ts`). Sin esa comprobación, dar de alta una fila equivaldría a
 * inyectar código en el sandbox: el registro dejaría de ser un control de seguridad y
 * pasaría a ser un vector.
 */
import { HttpStatus, Injectable } from '@nestjs/common';
import { ApprovedLibraryStatus, CalculatedFieldImplKind, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { pageResult, paginationArgs } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { LIBRARY_PRELUDES, allowedFunctionsFor, isPreludeAvailable } from './library-preludes';
import { LibraryQueryDto, UpsertLibraryDto } from './library.dto';

@Injectable()
export class LibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: bigint, query: LibraryQueryDto) {
    const { skip, take, page, pageSize } = paginationArgs(query);
    const where: Prisma.ApprovedLibraryWhereInput = {
      tenantId,
      ...(query.language ? { language: query.language as CalculatedFieldImplKind } : {}),
      ...(query.status ? { status: query.status as ApprovedLibraryStatus } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.environment ? { allowedEnvironments: { has: query.environment } } : {}),
      ...(query.search
        ? {
            OR: [
              { logicalName: { contains: query.search, mode: 'insensitive' } },
              { packageName: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.approvedLibrary.findMany({
        where,
        orderBy: [{ category: 'asc' }, { logicalName: 'asc' }],
        skip,
        take,
      }),
      this.prisma.approvedLibrary.count({ where }),
    ]);
    return pageResult(
      rows.map((row) => this.present(row)),
      total,
      page,
      pageSize,
    );
  }

  /** Catálogo de preludes implementados: lo que un administrador PUEDE aprobar. */
  availablePreludes() {
    return Object.entries(LIBRARY_PRELUDES).map(([packageName, prelude]) => ({
      packageName,
      javascript: prelude.javascript ? { functions: prelude.javascript.functions } : null,
      python: prelude.python ? { functions: prelude.python.functions } : null,
    }));
  }

  async upsert(tenantId: bigint, dto: UpsertLibraryDto, principal: AuthenticatedPrincipal) {
    if (dto.language !== 'OPERATION' && !isPreludeAvailable(dto.packageName, dto.language)) {
      throw new DomainException(
        'LIBRARY_PRELUDE_NOT_IMPLEMENTED',
        `No existe una implementación autorizada de ${dto.packageName} para ${dto.language}. Las librerías solo pueden habilitar preludes ya revisados en el repositorio.`,
        HttpStatus.BAD_REQUEST,
        { available: Object.keys(LIBRARY_PRELUDES) },
      );
    }
    // Las funciones declaradas no pueden exceder lo que el prelude realmente expone:
    // si no, el panel prometería una función que el sandbox no tiene.
    if (dto.language !== 'OPERATION') {
      const exposed = new Set(allowedFunctionsFor([dto.packageName], dto.language));
      const unknown = dto.allowedFunctions.filter((fn) => !exposed.has(fn));
      if (unknown.length) {
        throw new DomainException(
          'LIBRARY_FUNCTION_NOT_EXPOSED',
          `El prelude de ${dto.packageName} no expone: ${unknown.join(', ')}`,
          HttpStatus.BAD_REQUEST,
          { exposed: [...exposed] },
        );
      }
    }

    const data = {
      tenantId,
      logicalName: dto.logicalName,
      packageName: dto.packageName,
      version: dto.version,
      language: dto.language as CalculatedFieldImplKind,
      category: dto.category,
      description: dto.description,
      documentationUrl: dto.documentationUrl,
      allowedFunctions: dto.allowedFunctions,
      blockedFunctions: dto.blockedFunctions ?? [],
      allowedEnvironments: dto.allowedEnvironments,
      status: (dto.status ?? 'APPROVED') as ApprovedLibraryStatus,
      knownRisks: dto.knownRisks,
      updatePolicy: dto.updatePolicy ?? 'PINNED',
      reviewedAt: new Date(),
      reviewedBy: principal.id,
    };

    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.approvedLibrary.upsert({
        where: {
          tenantId_logicalName_language_version: {
            tenantId,
            logicalName: dto.logicalName,
            language: data.language,
            version: dto.version,
          },
        },
        create: data,
        update: data,
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'APPROVED_LIBRARY_UPSERTED',
          aggregateType: 'ApprovedLibrary',
          aggregateId: saved.id.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            logicalName: saved.logicalName,
            version: saved.version,
            language: saved.language,
            status: saved.status,
          },
        },
        tx,
      );
      return saved;
    });
    return this.present(row);
  }

  /**
   * Resuelve las librerías seleccionadas por un campo calculado, exigiendo que estén
   * aprobadas, sean del mismo lenguaje y estén habilitadas en el ambiente destino.
   */
  async resolveForExecution(
    tenantId: bigint,
    libraryIds: bigint[],
    language: CalculatedFieldImplKind,
    environmentCode: string | null,
  ) {
    if (!libraryIds.length) return [];
    const rows = await this.prisma.approvedLibrary.findMany({
      where: { id: { in: libraryIds }, tenantId },
    });
    if (rows.length !== new Set(libraryIds.map(String)).size) {
      throw new DomainException(
        'LIBRARY_NOT_FOUND',
        'Alguna de las librerías seleccionadas no existe en este tenant',
        HttpStatus.NOT_FOUND,
      );
    }
    for (const row of rows) {
      if (row.status !== 'APPROVED') {
        throw new DomainException(
          'LIBRARY_NOT_APPROVED',
          `La librería ${row.logicalName}@${row.version} está en estado ${row.status}`,
          HttpStatus.CONFLICT,
        );
      }
      if (row.language !== language) {
        throw new DomainException(
          'LIBRARY_LANGUAGE_MISMATCH',
          `La librería ${row.logicalName} es para ${row.language}, no para ${language}`,
        );
      }
      // Aislamiento de ambientes: una librería habilitada solo en DEV no puede colarse
      // en una versión que va a publicarse en PROD.
      if (environmentCode && !row.allowedEnvironments.includes(environmentCode)) {
        throw new DomainException(
          'LIBRARY_ENVIRONMENT_FORBIDDEN',
          `La librería ${row.logicalName} no está habilitada en el ambiente ${environmentCode}`,
          HttpStatus.CONFLICT,
        );
      }
    }
    return rows;
  }

  private present(row: {
    id: bigint;
    tenantId: bigint;
    reviewedAt: Date | null;
    [key: string]: unknown;
  }) {
    const { tenantId: _tenantId, ...rest } = row;
    return { ...rest, id: row.id.toString() };
  }
}
