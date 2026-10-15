import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FinancialInstitution } from '@prisma/client';
import { DomainException } from '../../../../common/errors/domain-exception';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { BOLIVIA_INSTITUTIONS } from '../core/institutions/bolivia-institutions';
import { UpsertFinancialInstitutionDto } from './financial-institution.dto';
import { InstitutionCatalogService } from './institution-catalog.service';
import {
  afterInstitutionWrite,
  institutionNotFound,
  presentInstitution,
} from './institution-presenter';
import { validateDescriptor, validatePatterns } from './institution-validation';

/**
 * Administración del padrón contra el que el motor atribuye cada extracto.
 *
 * **Escribir aquí cambia qué documentos se aceptan.** Un marcador nuevo hace que
 * los extractos de un banco dejen de rechazarse; una licencia revocada hace que
 * los suyos pasen a revisión humana. Por eso las comprobaciones de forma viven
 * en el servidor y no en la pantalla: quien llama a la API sin pasar por el
 * portal es cualquiera con credencial.
 */
@Injectable()
export class InstitutionRegistryService {
  private readonly logger = new Logger(InstitutionRegistryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: InstitutionCatalogService,
  ) {}

  async list(tenantId: bigint, includeInactive = false) {
    const rows = await this.prisma.financialInstitution.findMany({
      where: includeInactive ? { tenantId } : { tenantId, isActive: true },
      orderBy: [{ kind: 'asc' }, { code: 'asc' }],
    });
    return rows.map((row) => presentInstitution(row));
  }

  async upsert(tenantId: bigint, dto: UpsertFinancialInstitutionDto, actor: string) {
    const markers = validatePatterns(dto.markers, 'markers');
    const exclusions = validatePatterns(dto.exclusions ?? [], 'exclusions');
    const licenseStatus = dto.licenseStatus ?? 'LICENSED';
    const note = dto.note?.trim() ?? null;

    /*
     * La misma regla que sostiene el CHECK de la migración, comprobada aquí para
     * poder explicarla. Sin motivo escrito, «esta entidad no opera» llega a la
     * cola de revisión como una afirmación sin respaldo, y quien la lee no puede
     * hacer nada con ella salvo buscar la resolución de ASFI por su cuenta.
     */
    if (licenseStatus !== 'LICENSED' && !note) {
      throw new DomainException(
        'INSTITUTION_NOTE_REQUIRED',
        'Una entidad sin licencia vigente necesita un motivo escrito: es lo único que quien revise el caso podrá leer.',
        HttpStatus.BAD_REQUEST,
        { code: dto.code, licenseStatus },
      );
    }

    const data = {
      name: dto.name.trim(),
      kind: dto.kind as FinancialInstitution['kind'],
      licenseStatus: licenseStatus as FinancialInstitution['licenseStatus'],
      retailDeposits: dto.retailDeposits ?? true,
      markers: markers as unknown as Prisma.InputJsonValue,
      exclusions: exclusions as unknown as Prisma.InputJsonValue,
      note,
      website: dto.website?.trim() || null,
      /*
       * El descriptor se VALIDA al guardar, no al usarlo. Sus patrones acaban
       * ejecutándose contra el texto de un PDF, así que uno con retroceso
       * catastrófico bloquearía el hilo del worker; y un descriptor incompleto
       * fallaría a mitad del análisis de un extracto, donde el error se leería
       * como un defecto del documento. Aquí el fallo sale donde alguien lo
       * escribió.
       *
       * `Prisma.DbNull` y no `null` a secas: en una columna JSONB, `null` de
       * JavaScript es el valor JSON `null` —un dato presente que dice «nada»— y
       * `DbNull` es la ausencia de dato. Guardar el primero haría que
       * `expected_signals IS NULL` no encontrara nunca a las entidades sin
       * descriptor, que es justo la consulta con la que se planifica la
       * calibración.
       */
      expectedSignals: validateDescriptor(dto.expectedSignals, dto.code),
      isActive: true,
      updatedBy: actor,
    };

    const row = await this.prisma.financialInstitution.upsert({
      where: { tenantId_code: { tenantId, code: dto.code } },
      update: data,
      create: { tenantId, code: dto.code, ...data },
    });
    afterInstitutionWrite(
      this.catalog,
      this.logger,
      tenantId,
      `entidad ${dto.code} escrita por ${actor}`,
    );
    return presentInstitution(row);
  }

  /**
   * Baja lógica. La fila no se borra porque las ejecuciones ya hechas citan el
   * código con el que se atribuyó el documento, y una traza que apunte al vacío
   * no se puede auditar. Una entidad inactiva deja de reconocer documentos; su
   * historial sigue siendo legible.
   */
  async deactivate(tenantId: bigint, code: string, actor: string) {
    const row = await this.prisma.financialInstitution.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    if (!row) throw institutionNotFound(code);
    const updated = await this.prisma.financialInstitution.update({
      where: { id: row.id },
      data: { isActive: false, updatedBy: actor },
    });
    afterInstitutionWrite(
      this.catalog,
      this.logger,
      tenantId,
      `entidad ${code} desactivada por ${actor}`,
    );
    return presentInstitution(updated);
  }

  async reactivate(tenantId: bigint, code: string, actor: string) {
    const row = await this.prisma.financialInstitution.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    if (!row) throw institutionNotFound(code);
    const updated = await this.prisma.financialInstitution.update({
      where: { id: row.id },
      data: { isActive: true, updatedBy: actor },
    });
    afterInstitutionWrite(
      this.catalog,
      this.logger,
      tenantId,
      `entidad ${code} reactivada por ${actor}`,
    );
    return presentInstitution(updated);
  }

  /**
   * Estado del padrón, y qué le falta respecto de la nómina ASFI compilada.
   *
   * `missingFromSeed` es la parte útil: un padrón incompleto no da ningún error
   * visible —cada extracto de la entidad que falta se rechaza por su cuenta como
   * «emisor no reconocido»— así que la única forma de enterarse es preguntarlo.
   */
  async summary(tenantId: bigint) {
    const rows = await this.prisma.financialInstitution.findMany({
      where: { tenantId, isActive: true },
      select: { code: true, kind: true, licenseStatus: true },
    });
    const present = new Set(rows.map((row) => row.code));
    const byKind: Record<string, number> = {};
    for (const row of rows) byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;

    return {
      active: rows.length,
      byKind,
      withoutLicense: rows.filter((row) => row.licenseStatus !== 'LICENSED').length,
      missingFromSeed: BOLIVIA_INSTITUTIONS.filter(
        (institution) => !present.has(institution.code),
      ).map((institution) => institution.code),
    };
  }

  /**
   * Inyecta en el padrón las entidades de la nómina ASFI que no estén.
   *
   * Sólo CREA: nunca pisa una fila existente. Quien administra el padrón añade
   * la marca nueva de un banco porque la vio en un extracto que llegó ayer, y
   * una siembra que la sobreescribiera convertiría ese mantenimiento en trabajo
   * que se deshace solo. `dryRun` responde qué haría sin escribir, por la misma
   * razón que en el catálogo de categorías: sembrar 66 entidades sin poder mirar
   * antes es la clase de operación que se hace una vez y mal.
   */
  async syncSeed(tenantId: bigint, dryRun: boolean, actor: string) {
    const existing = await this.prisma.financialInstitution.findMany({
      where: { tenantId },
      select: { code: true },
    });
    const present = new Set(existing.map((row) => row.code));
    const missing = BOLIVIA_INSTITUTIONS.filter((institution) => !present.has(institution.code));

    if (!dryRun && missing.length > 0) {
      await this.prisma.financialInstitution.createMany({
        data: missing.map((institution) => ({
          tenantId,
          code: institution.code,
          name: institution.name,
          kind: institution.kind as FinancialInstitution['kind'],
          licenseStatus: institution.licenseStatus as FinancialInstitution['licenseStatus'],
          retailDeposits: institution.retailDeposits,
          markers: institution.markers.map((marker) => marker.source),
          exclusions: (institution.exclusions ?? []).map((marker) => marker.source),
          note: institution.note ?? null,
          updatedBy: actor,
        })),
        skipDuplicates: true,
      });
      afterInstitutionWrite(
        this.catalog,
        this.logger,
        tenantId,
        `${missing.length} entidades sembradas por ${actor}`,
      );
    }

    return {
      total: BOLIVIA_INSTITUTIONS.length,
      created: missing.map((institution) => institution.code),
      dryRun,
    };
  }
}
