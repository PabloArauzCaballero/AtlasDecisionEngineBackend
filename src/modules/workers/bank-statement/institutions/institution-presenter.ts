import { HttpStatus, type Logger } from '@nestjs/common';
import type { FinancialInstitution } from '@prisma/client';
import { DomainException } from '../../../../common/errors/domain-exception';
import { InstitutionCatalogService } from './institution-catalog.service';

export function presentInstitution(row: FinancialInstitution) {
  return {
    code: row.code,
    name: row.name,
    kind: row.kind,
    licenseStatus: row.licenseStatus,
    retailDeposits: row.retailDeposits,
    markers: Array.isArray(row.markers) ? (row.markers as string[]) : [],
    exclusions: Array.isArray(row.exclusions) ? (row.exclusions as string[]) : [],
    note: row.note,
    website: row.website,
    expectedSignals: (row.expectedSignals ?? null) as Record<string, unknown> | null,
    /*
     * Se publica si HAY logotipo y de dónde salió, nunca los bytes. Una lista
     * de sesenta y ocho entidades con su imagen en base64 dentro son varios
     * megabytes de JSON para pintar una tabla; la imagen se pide por su propia
     * ruta, que además el navegador puede cachear.
     */
    hasLogo: row.logoData !== null,
    logoSource: row.logoSource,
    logoSourceUrl: row.logoSourceUrl,
    logoUpdatedAt: row.logoUpdatedAt?.toISOString() ?? null,
    isActive: row.isActive,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

export function institutionNotFound(code: string): DomainException {
  return new DomainException(
    'INSTITUTION_NOT_FOUND',
    `No hay ninguna entidad con código ${code} en el padrón.`,
    HttpStatus.NOT_FOUND,
    { code },
  );
}

/**
 * Toda escritura vence la instantánea del motor. Sin esto, revocar una
 * licencia no tendría efecto hasta que caducara sola, y el minuto de retraso
 * sería justo el que alguien pasaría mirando la pantalla sin entender por qué
 * el documento sigue procesándose.
 */
export function afterInstitutionWrite(
  catalog: InstitutionCatalogService,
  logger: Logger,
  tenantId: bigint,
  what: string,
): void {
  catalog.invalidate(tenantId);
  logger.log(`Padrón de entidades del tenant ${tenantId.toString()}: ${what}`);
}
