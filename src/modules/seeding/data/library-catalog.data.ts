/**
 * Registro inicial de librerías autorizadas (§7, §11).
 *
 * Cada entrada apunta a un prelude que YA existe en `libraries/library-preludes.ts`. Los
 * seeders no pueden aportar implementaciones: sembrar una librería sin prelude sería
 * prometer una capacidad que el sandbox no tiene, así que el propio seeder lo verifica.
 */
import type { ApprovedLibraryStatus, CalculatedFieldImplKind, PrismaClient } from '@prisma/client';
import { allowedFunctionsFor, isPreludeAvailable } from '../../libraries/library-preludes';
import { TENANT_ID } from './helpers';

interface LibrarySeed {
  logicalName: string;
  packageName: string;
  version: string;
  language: Exclude<CalculatedFieldImplKind, 'OPERATION'>;
  category: string;
  description: string;
  /** Ambientes donde puede usarse. Las nuevas empiezan restringidas a no producción. */
  allowedEnvironments: string[];
  status?: ApprovedLibraryStatus;
  knownRisks?: string;
}

export const libraryCatalog: LibrarySeed[] = [
  {
    logicalName: 'math',
    packageName: 'math',
    version: '1.0.0',
    language: 'JAVASCRIPT',
    category: 'MATEMATICAS',
    description:
      'Aritmética determinista: valor absoluto, redondeo, potencias y raíces. No expone Math.random.',
    allowedEnvironments: ['DEV', 'STAGING', 'TEST', 'PROD'],
  },
  {
    logicalName: 'math',
    packageName: 'math',
    version: '1.0.0',
    language: 'PYTHON',
    category: 'MATEMATICAS',
    description: 'Equivalente Python de la aritmética determinista, con nombres math_*.',
    allowedEnvironments: ['DEV', 'STAGING', 'TEST', 'PROD'],
  },
  {
    logicalName: 'statistics',
    packageName: 'statistics',
    version: '1.0.0',
    language: 'JAVASCRIPT',
    category: 'ESTADISTICA',
    description: 'Estadística descriptiva sobre listas: media, mediana, varianza y desviación.',
    allowedEnvironments: ['DEV', 'STAGING', 'TEST', 'PROD'],
  },
  {
    logicalName: 'statistics',
    packageName: 'statistics',
    version: '1.0.0',
    language: 'PYTHON',
    category: 'ESTADISTICA',
    description: 'Estadística descriptiva en Python, con nombres stats_*.',
    allowedEnvironments: ['DEV', 'STAGING', 'TEST', 'PROD'],
  },
  {
    logicalName: 'dates',
    packageName: 'dates',
    version: '1.0.0',
    language: 'JAVASCRIPT',
    category: 'FECHAS',
    description:
      'Diferencias entre fechas provistas. No lee el reloj del sistema: eso rompería el determinismo.',
    allowedEnvironments: ['DEV', 'STAGING', 'TEST', 'PROD'],
  },
  {
    logicalName: 'dates',
    packageName: 'dates',
    version: '1.0.0',
    language: 'PYTHON',
    category: 'FECHAS',
    description: 'Diferencias entre fechas en Python, con nombres dates_*.',
    allowedEnvironments: ['DEV', 'STAGING', 'TEST', 'PROD'],
  },
  {
    logicalName: 'finance',
    packageName: 'finance',
    version: '1.0.0',
    language: 'JAVASCRIPT',
    category: 'FINANZAS',
    description: 'Cálculo financiero básico: DTI, LTV, interés simple y cuota mensual.',
    // Finanzas nace restringida a no producción: §7 exige aprobación explícita antes de
    // que una fórmula financiera influya en una decisión real.
    allowedEnvironments: ['DEV', 'STAGING', 'TEST'],
    status: 'RESTRICTED',
    knownRisks:
      'Las fórmulas asumen tasas ya normalizadas al periodo. Requiere validación actuarial antes de habilitarla en PROD.',
  },
  {
    logicalName: 'finance',
    packageName: 'finance',
    version: '1.0.0',
    language: 'PYTHON',
    category: 'FINANZAS',
    description: 'Equivalente Python del cálculo financiero básico, con nombres finance_*.',
    allowedEnvironments: ['DEV', 'STAGING', 'TEST'],
    status: 'RESTRICTED',
    knownRisks:
      'Las fórmulas asumen tasas ya normalizadas al periodo. Requiere validación actuarial antes de habilitarla en PROD.',
  },
];

export async function seedApprovedLibraries(prisma: PrismaClient) {
  const seeded = [];
  for (const seed of libraryCatalog) {
    if (!isPreludeAvailable(seed.packageName, seed.language)) {
      throw new Error(
        `El seeder intenta aprobar ${seed.packageName} para ${seed.language} sin prelude implementado`,
      );
    }
    const data = {
      packageName: seed.packageName,
      category: seed.category,
      description: seed.description,
      allowedFunctions: allowedFunctionsFor([seed.packageName], seed.language),
      blockedFunctions: [],
      allowedEnvironments: seed.allowedEnvironments,
      status: seed.status ?? ('APPROVED' as ApprovedLibraryStatus),
      knownRisks: seed.knownRisks,
      updatePolicy: 'PINNED',
      reviewedAt: new Date('2026-07-30T00:00:00Z'),
      reviewedBy: 'seed@atlas',
    };
    seeded.push(
      await prisma.approvedLibrary.upsert({
        where: {
          tenantId_logicalName_language_version: {
            tenantId: TENANT_ID,
            logicalName: seed.logicalName,
            language: seed.language,
            version: seed.version,
          },
        },
        update: data,
        create: {
          tenantId: TENANT_ID,
          logicalName: seed.logicalName,
          version: seed.version,
          language: seed.language,
          ...data,
        },
      }),
    );
  }
  return seeded;
}
