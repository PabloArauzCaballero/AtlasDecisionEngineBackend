import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { InstitutionCatalogService } from './institution-catalog.service';
import {
  institutionLogoSeed,
  readInstitutionLogo,
  type InstitutionLogoSeed,
  type InstitutionLogoSource,
} from './institution-logo-seed';
import { validateLogoUpload } from './institution-logo-rules';
import {
  afterInstitutionWrite,
  institutionNotFound,
  presentInstitution,
} from './institution-presenter';

/** Logotipos del padrón: servirlos, cargarlos a mano, quitarlos y sincronizar los que viajan con el código. */
@Injectable()
export class InstitutionLogoService {
  private readonly logger = new Logger(InstitutionLogoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: InstitutionCatalogService,
  ) {}

  /**
   * El logotipo de una entidad, listo para servir.
   *
   * Devuelve `null` y no lanza cuando la entidad existe sin logotipo: para quien
   * llama es una imagen que no está, no un error, y convertirlo en 500 llenaría
   * la traza de fallos por entidades que simplemente no tienen marca cargada.
   */
  async logo(
    tenantId: bigint,
    code: string,
  ): Promise<{ data: Buffer; contentType: string; updatedAt: Date | null } | null> {
    const row = await this.prisma.financialInstitution.findUnique({
      where: { tenantId_code: { tenantId, code } },
      select: { logoData: true, logoContentType: true, logoUpdatedAt: true },
    });
    if (!row?.logoData) return null;
    return {
      data: Buffer.from(row.logoData),
      contentType: row.logoContentType ?? 'application/octet-stream',
      updatedAt: row.logoUpdatedAt,
    };
  }

  /**
   * Carga un logotipo propio sobre una entidad del padrón.
   *
   * Sólo se admiten los tres formatos que un navegador pinta sin plugins, y el
   * SVG se comprueba aparte: un SVG es un documento XML que puede traer
   * `<script>` y `<foreignObject>` dentro, así que servirlo tal cual desde el
   * mismo origen que el portal sería una inyección de guion con formato de
   * imagen. Se rechaza en vez de sanearse — sanear XML ajeno es una carrera que
   * se pierde, y quien sube el logotipo de un banco puede exportarlo otra vez sin
   * guiones.
   */
  async setLogo(
    tenantId: bigint,
    code: string,
    input: { base64: string; contentType: string; sourceUrl?: string | null },
    actor: string,
  ) {
    const row = await this.prisma.financialInstitution.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    if (!row) throw institutionNotFound(code);

    const { data, contentType } = validateLogoUpload(code, input);

    const updated = await this.prisma.financialInstitution.update({
      where: { id: row.id },
      data: {
        // `new Uint8Array` y no un cast, por el mismo motivo que en el alta de
        // ejecuciones: Prisma tipa `Bytes` como `Uint8Array<ArrayBuffer>` y un
        // `Buffer` de Node declara `ArrayBufferLike`, que admite además
        // `SharedArrayBuffer`. Copiar 256 KiB una vez por carga es barato; un
        // cast escondería que los dos tipos no son intercambiables.
        logoData: new Uint8Array(data),
        logoContentType: contentType,
        logoSource: 'UPLOADED' satisfies InstitutionLogoSource,
        logoSourceUrl: input.sourceUrl?.trim() || null,
        logoUpdatedAt: new Date(),
        updatedBy: actor,
      },
    });
    afterInstitutionWrite(
      this.catalog,
      this.logger,
      tenantId,
      `logotipo de ${code} cargado por ${actor}`,
    );
    return presentInstitution(updated);
  }

  /** Quita el logotipo. La entidad sigue reconociendo documentos igual. */
  async removeLogo(tenantId: bigint, code: string, actor: string) {
    const row = await this.prisma.financialInstitution.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    if (!row) throw institutionNotFound(code);
    const updated = await this.prisma.financialInstitution.update({
      where: { id: row.id },
      data: {
        logoData: null,
        logoContentType: null,
        logoSource: null,
        logoSourceUrl: null,
        logoUpdatedAt: null,
        updatedBy: actor,
      },
    });
    afterInstitutionWrite(
      this.catalog,
      this.logger,
      tenantId,
      `logotipo de ${code} retirado por ${actor}`,
    );
    return presentInstitution(updated);
  }

  /**
   * Carga los logotipos que viajan con el código.
   *
   * Escribe en dos casos, y la diferencia entre ellos importa:
   *
   * - **La entidad no tiene ningún logotipo.** Se le pone el de la semilla, sea
   *   el oficial o el monograma.
   * - **La entidad tiene un MONOGRAMA y la semilla ya trae el logotipo
   *   oficial.** Se reemplaza. Sin esta segunda regla, conseguir la marca de una
   *   cooperativa no servía de nada: la sincronización sólo miraba si había
   *   bytes, encontraba el cuadrado de tres letras que ella misma había puesto y
   *   se saltaba la fila para siempre. La única salida era borrar el logotipo a
   *   mano, entidad por entidad, para que volviera a entrar por el primer caso.
   *
   * **Nunca pisa uno cargado a mano.** Quien sube el logotipo bueno de una
   * cooperativa lo hace porque el monograma no le sirve, y una sincronización que
   * lo sobreescribiera convertiría ese trabajo en algo que se deshace solo — la
   * misma regla que gobierna `syncSeed` con los marcadores. Un monograma, en
   * cambio, no es trabajo de nadie: lo compuso el motor a falta de algo mejor.
   */
  async syncLogos(tenantId: bigint, dryRun: boolean, actor: string) {
    const seeds = institutionLogoSeed();
    const rows = await this.prisma.financialInstitution.findMany({
      where: { tenantId },
      select: { id: true, code: true, logoData: true, logoSource: true, website: true },
    });
    const byCode = new Map(rows.map((row) => [row.code, row]));

    const mejora = (seed: InstitutionLogoSeed, row: { logoSource: string | null }): boolean =>
      row.logoSource === 'GENERATED' && seed.source === 'DOWNLOADED';

    const pending = seeds.filter((seed) => {
      const row = byCode.get(seed.code);
      if (!row) return false;
      // Un logotipo cargado a mano manda sobre la semilla, siempre.
      if (row.logoSource === 'UPLOADED') return false;
      return !row.logoData || mejora(seed, row);
    });

    if (!dryRun) {
      for (const seed of pending) {
        const row = byCode.get(seed.code);
        const data = readInstitutionLogo(seed);
        if (!row || !data) continue;
        await this.prisma.financialInstitution.update({
          where: { id: row.id },
          data: {
            logoData: new Uint8Array(data),
            logoContentType: seed.contentType,
            logoSource: seed.source,
            logoSourceUrl: seed.sourceUrl,
            logoUpdatedAt: new Date(),
            website: row.website ?? seed.website,
            updatedBy: actor,
          },
        });
      }
      if (pending.length > 0) {
        afterInstitutionWrite(
          this.catalog,
          this.logger,
          tenantId,
          `${pending.length} logotipos cargados por ${actor}`,
        );
      }
    }

    return {
      available: seeds.length,
      downloaded: seeds.filter((seed) => seed.source === 'DOWNLOADED').length,
      generated: seeds.filter((seed) => seed.source === 'GENERATED').length,
      applied: pending.map((seed) => seed.code),
      /*
       * Los que CAMBIARON de monograma a logotipo oficial, aparte. Contarlos con
       * los demás diría «cargados 12» sobre un padrón que ya enseñaba doce
       * imágenes, y quien lo lee no sabría si pasó algo.
       */
      upgraded: pending
        .filter((seed) => {
          const row = byCode.get(seed.code);
          return row ? mejora(seed, row) : false;
        })
        .map((seed) => seed.code),
      dryRun,
    };
  }
}
