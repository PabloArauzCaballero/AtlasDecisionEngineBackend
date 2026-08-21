import { Injectable, Logger } from '@nestjs/common';
import type { FinancialInstitution } from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { isPotentiallyCatastrophic } from '../../../../common/validation/safe-regex';
import type {
  BoliviaInstitution,
  InstitutionKind,
  InstitutionLicenseStatus,
} from '../core/institutions/bolivia-institutions';
import {
  resolvedRegistry,
  type InstitutionRegistry,
} from '../core/institutions/institution-registry';

/**
 * El padrón administrable, leído por el motor sin salir a la base en cada
 * documento.
 *
 * El motor pregunta el padrón de forma **síncrona**, una vez por documento y en
 * el camino caliente; la tabla vive en Postgres. Esta clase es lo que concilia
 * las dos cosas: mantiene una instantánea por tenant, la sirve al instante, y la
 * refresca por detrás cuando caduca o cuando alguien escribe en el padrón.
 *
 * Una instantánea vencida NO bloquea al documento que llega: se sirve la
 * anterior y se pide la nueva. Es la decisión importante de este archivo, y va en
 * la dirección menos obvia —preferir un padrón de hace un minuto a hacer esperar
 * a un extracto—, porque el coste de las dos opciones no se parece: procesar un
 * documento con el padrón de hace un minuto no cambia el resultado salvo en el
 * minuto exacto en que alguien revocó una licencia; hacer que cada documento
 * espere una consulta convierte una tabla lenta en un worker parado.
 */
const TTL_MS = 60_000;

interface Snapshot {
  readonly institutions: readonly BoliviaInstitution[];
  readonly loadedAt: number;
}

@Injectable()
export class InstitutionCatalogService {
  private readonly logger = new Logger(InstitutionCatalogService.name);
  private readonly snapshots = new Map<string, Snapshot>();
  /** Refrescos en vuelo, para no pedir la misma tabla ocho veces a la vez. */
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * El padrón de un tenant, en la forma que el motor consume.
   *
   * Devuelve un `InstitutionRegistry` y no una lista porque el motor se
   * construye una vez y vive días: con una lista, revocar una licencia no
   * tendría efecto hasta reiniciar el proceso.
   */
  registryFor(tenantId: bigint): InstitutionRegistry {
    return resolvedRegistry(() => this.snapshotFor(tenantId));
  }

  /** Marca el padrón del tenant como vencido. Lo llama toda escritura del CRUD. */
  invalidate(tenantId: bigint): void {
    this.snapshots.delete(tenantId.toString());
  }

  /** Carga inmediata, para quien necesita el padrón fresco ya (pruebas, arranque). */
  async refresh(tenantId: bigint): Promise<readonly BoliviaInstitution[]> {
    await this.load(tenantId);
    return this.snapshots.get(tenantId.toString())?.institutions ?? [];
  }

  private snapshotFor(tenantId: bigint): readonly BoliviaInstitution[] | undefined {
    const key = tenantId.toString();
    const snapshot = this.snapshots.get(key);
    if (!snapshot || Date.now() - snapshot.loadedAt > TTL_MS) {
      void this.load(tenantId);
    }
    return snapshot?.institutions;
  }

  private load(tenantId: bigint): Promise<void> {
    const key = tenantId.toString();
    const running = this.inFlight.get(key);
    if (running) return running;

    const work = this.prisma.financialInstitution
      .findMany({ where: { tenantId, isActive: true }, orderBy: { code: 'asc' } })
      .then((rows) => {
        this.snapshots.set(key, {
          institutions: rows.map((row) => this.toInstitution(row)),
          loadedAt: Date.now(),
        });
      })
      .catch((error: unknown) => {
        /*
         * Un fallo de carga NO vacía la instantánea anterior ni escribe una
         * vacía. Un padrón vacío no es una afirmación sobre el sistema
         * financiero boliviano —es un fallo de lectura—, y desde que la
         * compuerta de emisor exige atribución, tomárselo en serio rechazaría
         * todos los extractos a la vez. `resolvedRegistry` cae a la nómina
         * compilada, que es vieja pero cierta.
         */
        this.logger.error(
          `No se pudo cargar el padrón de entidades del tenant ${key}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      })
      .finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, work);
    return work;
  }

  private toInstitution(row: FinancialInstitution): BoliviaInstitution {
    return {
      code: row.code,
      name: row.name,
      kind: row.kind as InstitutionKind,
      licenseStatus: row.licenseStatus as InstitutionLicenseStatus,
      retailDeposits: row.retailDeposits,
      markers: this.compile(row.markers, row.code, 'marcadores'),
      exclusions: this.compile(row.exclusions, row.code, 'exclusiones'),
      note: row.note ?? undefined,
    };
  }

  /**
   * Compila los patrones de una fila, descartando el que no sirva.
   *
   * Descartar y seguir, en vez de dejar caer la entidad entera, es deliberado:
   * un marcador roto entre cinco degrada el reconocimiento de ESA entidad; una
   * entidad que desaparece del padrón por un patrón mal escrito hace que sus
   * extractos pasen a «emisor no reconocido», que es un rechazo. El fallo
   * pequeño no debe producir la consecuencia grande.
   *
   * La comprobación anti-ReDoS se repite aquí aunque el CRUD ya la haga al
   * escribir: la fila pudo entrar por una siembra, por una migración o por una
   * versión anterior del validador, y este patrón se ejecuta contra la carátula
   * de CADA documento que entra.
   */
  private compile(value: unknown, code: string, field: string): readonly RegExp[] {
    if (!Array.isArray(value)) return [];
    const compiled: RegExp[] = [];
    for (const source of value) {
      if (typeof source !== 'string' || source.length === 0) continue;
      if (isPotentiallyCatastrophic(source)) {
        this.logger.warn(`Patrón descartado por riesgo de ReDoS en ${code}.${field}: ${source}`);
        continue;
      }
      try {
        compiled.push(new RegExp(source, 'i'));
      } catch {
        this.logger.warn(`Patrón inválido en ${code}.${field}: ${source}`);
      }
    }
    return compiled;
  }
}
