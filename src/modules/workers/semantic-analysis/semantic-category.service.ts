import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { DomainException } from '../../../common/errors/domain-exception';
import { ImportSemanticCategoriesDto, UpsertSemanticCategoryDto } from './semantic-category.dto';

/**
 * Administración del árbol de categorías, acotada por tenant.
 *
 * Todo lo que se escribe aquí lo lee el clasificador en cuanto caduca su caché
 * de catálogo (`SEMANTIC_CATALOG_CACHE_TTL_SECONDS`, 60 s por omisión), así que
 * un cambio se nota sin reiniciar nada. Esa inmediatez es justamente por lo que
 * las comprobaciones de forma del árbol viven aquí y no en la interfaz.
 */
@Injectable()
export class SemanticCategoryService {
  private readonly logger = new Logger(SemanticCategoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: bigint) {
    const filas = await this.prisma.semanticCategory.findMany({
      where: { tenantId },
      orderBy: { code: 'asc' },
    });
    return filas.map((fila) => this.present(fila));
  }

  async upsert(tenantId: bigint, dto: UpsertSemanticCategoryDto) {
    await this.assertParentExists(tenantId, dto.code, dto.parentCode ?? null);
    const fila = await this.prisma.semanticCategory.upsert({
      where: { tenantId_code: { tenantId, code: dto.code } },
      create: { tenantId, ...this.toRow(dto) },
      update: this.toRow(dto),
    });
    this.logger.log(`Categoría ${dto.code} escrita en el tenant ${tenantId.toString()}`);
    return this.present(fila);
  }

  /**
   * Baja lógica, nunca borrado.
   *
   * Las ejecuciones ya hechas citan el código de la categoría con la que se
   * decidió; borrar la fila dejaría esas trazas apuntando al vacío y una
   * auditoría no podría reconstruir por qué se clasificó así. Desactivar la
   * saca del catálogo del clasificador —que sólo carga las activas— y conserva
   * el registro.
   *
   * Con hijas activas se niega: dejar una rama desactivada con hojas vivas
   * colgando produce un árbol que se lee mal en cualquier informe.
   */
  async deactivate(tenantId: bigint, code: string) {
    const hijasActivas = await this.prisma.semanticCategory.count({
      where: { tenantId, parentCode: code, isActive: true },
    });
    if (hijasActivas > 0) {
      throw new DomainException(
        'SEMANTIC_CATEGORY_HAS_ACTIVE_CHILDREN',
        `No se puede desactivar ${code}: tiene ${String(hijasActivas)} categoría(s) hija(s) activa(s). Desactívalas primero.`,
        HttpStatus.CONFLICT,
      );
    }
    const fila = await this.prisma.semanticCategory
      .update({
        where: { tenantId_code: { tenantId, code } },
        data: { isActive: false },
      })
      .catch(() => {
        throw this.noExiste(code);
      });
    return this.present(fila);
  }

  /**
   * Inyecta un subárbol entero.
   *
   * Ordena por profundidad antes de escribir porque la clave foránea
   * `(tenant, parent_code)` lo exige y el JSON que llega no tiene por qué venir
   * ordenado: quien lo escribe pone las categorías donde le resulta legible. Un
   * padre que no exista ni en el lote ni en la base detiene la operación entera
   * —en vez de escribir las que sí encajan— porque un árbol a medias clasifica
   * sin que nadie sepa que le falta la mitad.
   */
  async importTree(tenantId: bigint, dto: ImportSemanticCategoriesDto) {
    const entrantes = dto.categories;
    const codigosEntrantes = new Set(entrantes.map((categoria) => categoria.code));

    const duplicados = entrantes
      .map((categoria) => categoria.code)
      .filter((codigo, indice, todos) => todos.indexOf(codigo) !== indice);
    if (duplicados.length > 0) {
      throw new DomainException(
        'SEMANTIC_CATEGORY_DUPLICATE_CODE',
        `El lote repite estos códigos: ${[...new Set(duplicados)].join(', ')}.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const existentes = new Set(
      (
        await this.prisma.semanticCategory.findMany({
          where: { tenantId },
          select: { code: true },
        })
      ).map((fila) => fila.code),
    );

    const ordenadas = this.sortByDepth(entrantes, existentes);
    const creadas = ordenadas.filter((categoria) => !existentes.has(categoria.code));
    const actualizadas = ordenadas.filter((categoria) => existentes.has(categoria.code));

    const resumen = {
      total: ordenadas.length,
      created: creadas.map((categoria) => categoria.code),
      updated: actualizadas.map((categoria) => categoria.code),
      dryRun: dto.dryRun === true,
    };
    if (dto.dryRun === true) return resumen;

    /*
     * Transacción INTERACTIVA y un `await` por categoría, no un array de
     * promesas.
     *
     * La clave foránea `(tenant_id, parent_code)` se comprueba fila a fila, así
     * que el padre tiene que estar escrito ANTES de que llegue el hijo. Con la
     * forma en array eso no se cumplía —el motor respondía
     * `decision_semantic_category_parent_fkey` al inyectar una rama y su hoja
     * juntas— y aquí el orden es el del bucle, que es el que `sortByDepth`
     * calculó. Sigue siendo una sola transacción: un fallo a mitad no deja medio
     * árbol escrito.
     */
    await this.prisma.$transaction(async (tx) => {
      for (const categoria of ordenadas) {
        await tx.semanticCategory.upsert({
          where: { tenantId_code: { tenantId, code: categoria.code } },
          create: { tenantId, ...this.toRow(categoria) },
          update: this.toRow(categoria),
        });
      }
    });
    this.logger.log(
      `Inyectadas ${String(resumen.total)} categorías en el tenant ${tenantId.toString()}: ` +
        `${String(resumen.created.length)} nuevas, ${String(resumen.updated.length)} actualizadas`,
    );
    void codigosEntrantes;
    return resumen;
  }

  /**
   * Padres antes que hijos. Un padre vale si viene en el lote o si ya está en la
   * base; si no, el lote no se sostiene y se dice cuál falta.
   */
  private sortByDepth(
    entrantes: readonly UpsertSemanticCategoryDto[],
    existentes: ReadonlySet<string>,
  ): UpsertSemanticCategoryDto[] {
    const pendientes = new Map(entrantes.map((categoria) => [categoria.code, categoria]));
    const colocadas = new Set<string>();
    const ordenadas: UpsertSemanticCategoryDto[] = [];

    let avanzo = true;
    while (avanzo && colocadas.size < entrantes.length) {
      avanzo = false;
      for (const categoria of pendientes.values()) {
        if (colocadas.has(categoria.code)) continue;
        const padre = categoria.parentCode ?? null;
        const padreListo =
          padre === null ||
          colocadas.has(padre) ||
          (existentes.has(padre) && !pendientes.has(padre));
        if (!padreListo) continue;
        ordenadas.push(categoria);
        colocadas.add(categoria.code);
        avanzo = true;
      }
    }

    if (ordenadas.length !== entrantes.length) {
      const rotas = entrantes
        .filter((categoria) => !colocadas.has(categoria.code))
        .map((categoria) => `${categoria.code} → ${String(categoria.parentCode)}`);
      throw new DomainException(
        'SEMANTIC_CATEGORY_TREE_BROKEN',
        `El árbol no se sostiene: hay un ciclo o un padre inexistente en ${rotas.join(', ')}.`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return ordenadas;
  }

  private async assertParentExists(
    tenantId: bigint,
    code: string,
    parentCode: string | null,
  ): Promise<void> {
    if (parentCode === null) return;
    if (parentCode === code) {
      throw new DomainException(
        'SEMANTIC_CATEGORY_SELF_PARENT',
        'Una categoría no puede ser su propio padre.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const padre = await this.prisma.semanticCategory.findUnique({
      where: { tenantId_code: { tenantId, code: parentCode } },
      select: { code: true },
    });
    if (padre === null) {
      throw new DomainException(
        'SEMANTIC_CATEGORY_PARENT_NOT_FOUND',
        `El padre ${parentCode} no existe en este tenant.`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private noExiste(code: string): DomainException {
    return new DomainException(
      'SEMANTIC_CATEGORY_NOT_FOUND',
      `No existe la categoría ${code}.`,
      HttpStatus.NOT_FOUND,
    );
  }

  private toRow(dto: UpsertSemanticCategoryDto) {
    return {
      code: dto.code,
      name: dto.name,
      description: dto.description,
      parentCode: dto.parentCode ?? null,
      positiveExamples: dto.positiveExamples ?? [],
      counterExamples: dto.counterExamples ?? [],
      restrictions: dto.restrictions ?? [],
      relatedCategoryCodes: dto.relatedCategoryCodes ?? [],
      acceptanceThreshold: new Prisma.Decimal(dto.acceptanceThreshold ?? 0.62),
      isActive: dto.isActive ?? true,
      ...(dto.version === undefined ? {} : { version: dto.version }),
    };
  }

  private present(fila: {
    code: string;
    name: string;
    description: string;
    parentCode: string | null;
    positiveExamples: unknown;
    counterExamples: unknown;
    restrictions: unknown;
    relatedCategoryCodes: unknown;
    acceptanceThreshold: Prisma.Decimal;
    version: number;
    isActive: boolean;
  }) {
    return {
      code: fila.code,
      name: fila.name,
      description: fila.description,
      parentCode: fila.parentCode,
      positiveExamples: this.asStrings(fila.positiveExamples),
      counterExamples: this.asStrings(fila.counterExamples),
      restrictions: this.asStrings(fila.restrictions),
      relatedCategoryCodes: this.asStrings(fila.relatedCategoryCodes),
      acceptanceThreshold: Number(fila.acceptanceThreshold),
      version: fila.version,
      isActive: fila.isActive,
    };
  }

  /** Las columnas son `jsonb`: lo que hay dentro lo escribió una versión anterior. */
  private asStrings(valor: unknown): string[] {
    return Array.isArray(valor) ? valor.filter((x): x is string => typeof x === 'string') : [];
  }
}
