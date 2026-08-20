/**
 * Siembra del padrón de entidades de intermediación financiera de Bolivia.
 *
 * La lista NO se escribe aquí: se lee de
 * `workers/bank-statement/core/institutions/bolivia-institutions.ts`, que es la
 * nómina de ASFI al 30 de abril de 2026 y la misma que usa el motor cuando la
 * tabla todavía no existe. Dos copias de un padrón de 66 entidades se separan a
 * la primera resolución del regulador, y la copia que se quedara atrás sería
 * justo la que decide si un extracto se procesa.
 *
 * ## Por qué la siembra NO pisa lo que hay
 *
 * `update` toca únicamente el nombre y la clasificación —lo que ASFI publica—, y
 * deja intactos los marcadores, las exclusiones y la situación de la licencia.
 * Quien administra el padrón desde el portal añade la marca nueva de un banco
 * porque la vio en un extracto real que llegó ayer; una resiembra que la borrara
 * convertiría el mantenimiento en trabajo que se deshace solo. Lo que la semilla
 * garantiza es que ninguna entidad FALTE, no que nadie la haya mejorado.
 */
import type { PrismaClient } from '@prisma/client';
import { BOLIVIA_INSTITUTIONS } from '../../workers/bank-statement/core/institutions/bolivia-institutions';
import { TENANT_ID } from './helpers';

/**
 * Los marcadores viajan como fuente de expresión regular, sin banderas.
 *
 * Todas se compilan con `i` al leerlas —ver `PrismaInstitutionRegistry`— porque
 * una carátula puede venir en mayúsculas, en minúsculas o en versalitas según lo
 * que el lector de PDF haya sacado, y guardar la bandera por fila sólo abriría
 * la posibilidad de que alguien creara un marcador sensible a mayúsculas que
 * nunca coincidiera y nadie supiera por qué.
 */
function toSources(patterns: readonly RegExp[] | undefined): string[] {
  return [...(patterns ?? [])].map((pattern) => pattern.source);
}

export async function seedFinancialInstitutions(prisma: PrismaClient) {
  const seeded = [];
  for (const institution of BOLIVIA_INSTITUTIONS) {
    seeded.push(
      await prisma.financialInstitution.upsert({
        where: { tenantId_code: { tenantId: TENANT_ID, code: institution.code } },
        update: {
          name: institution.name,
          kind: institution.kind,
          retailDeposits: institution.retailDeposits,
        },
        create: {
          tenantId: TENANT_ID,
          code: institution.code,
          name: institution.name,
          kind: institution.kind,
          licenseStatus: institution.licenseStatus,
          retailDeposits: institution.retailDeposits,
          markers: toSources(institution.markers),
          exclusions: toSources(institution.exclusions),
          note: institution.note ?? null,
          updatedBy: 'seed@atlas',
        },
      }),
    );
  }
  return seeded;
}
