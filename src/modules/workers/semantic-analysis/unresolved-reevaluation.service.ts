import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SemanticAnalysisPipeline } from './core/application/semantic-analysis.pipeline';

/**
 * Vuelve a preguntar por lo que quedó pendiente, con el catálogo de HOY.
 *
 * ## El problema que resuelve
 *
 * Un pendiente se abre cuando el clasificador no supo decidir, y ahí se queda
 * esperando a una persona. Pero la razón más común de no saber decidir es que la
 * categoría o el vocabulario no existían todavía, y eso se arregla sembrando el
 * catálogo, no revisando la bandeja. Sin esta pasada, la bandeja acumulaba
 * decenas de términos que el motor YA sabe clasificar y seguía pidiendo que
 * alguien los asignara a mano, uno por uno. Una bandeja llena de trabajo que la
 * máquina puede hacer no es una bandeja: es ruido que esconde los casos que sí
 * necesitan criterio humano.
 *
 * ## Qué hace y qué NO hace
 *
 * - Reclasifica el valor original contra el catálogo actual. Lo que ahora sale
 *   resuelto se cierra como `AUTO_RESOLVED`, con la categoría y la confianza.
 * - Lo que sigue sin resolverse se queda pendiente, pero **con la recomendación
 *   refrescada**: la bandeja pasa de «ninguna candidata fue suficiente» a
 *   enseñar las mejores de hoy, que es lo que hace falta para decidir.
 * - **No escribe alias.** El alias es el aprendizaje de una decisión HUMANA;
 *   aquí no ha decidido nadie, ha mejorado el catálogo. Escribirlo congelaría la
 *   respuesta de hoy y taparía un cambio de catálogo posterior.
 * - **No toca lo ya resuelto.** Sólo mira `PENDING`.
 */

/** Cuántos pendientes se reevalúan por pasada, del más repetido al menos. */
const LOTE = 200;

/**
 * Pausa entre un pendiente y el siguiente.
 *
 * No es prudencia teórica: sin ella, el barrido mantiene el servidor de
 * embeddings al 100 % durante minutos y las clasificaciones que alguien está
 * ESPERANDO en pantalla agotan sus 15 s y fallan. Medido sobre un extracto real
 * mientras corría una pasada: 51 análisis muertos con SEMANTIC_PROVIDER_ERROR
 * contra 17 resueltos, y en la tabla se leían como «No se pudo».
 *
 * Esto es mantenimiento y puede tardar; lo que no puede es estropear la pantalla
 * de al lado.
 */
const RESPIRO_MS = 1_500;

/**
 * Las dos categorías que significan «no consta el concepto».
 *
 * Un pendiente que sólo cae aquí NO se cierra: es exactamente el caso que
 * necesita a una persona, y sacarlo de la bandeja lo enterraría.
 */
const CAJONES: ReadonlySet<string> = new Set(['GASTOS.OTROS', 'INGRESOS.OTROS']);

export interface ReevaluationSummary {
  readonly revisados: number;
  readonly resueltos: number;
  readonly refrescados: number;
  readonly pendientes: number;
}

/** Lo que se responde a quien la pide y a quien pregunta cómo va. */
export interface ReevaluationState {
  /** Hay una pasada corriendo para este tenant. */
  readonly corriendo: boolean;
  /** Cuántos quedan `PENDING` ahora mismo. */
  readonly pendientes: number;
  /** Resultado de la última pasada terminada, si hubo alguna en este proceso. */
  readonly ultima: ReevaluationSummary | null;
}

@Injectable()
export class UnresolvedReevaluationService {
  private readonly logger = new Logger(UnresolvedReevaluationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pipeline: SemanticAnalysisPipeline,
    private readonly config: ConfigService,
  ) {}

  /**
   * Reevalúa los pendientes de un tenant.
   *
   * Va de mayor a menor número de apariciones: si hay que cortar en algún sitio,
   * lo que más se repite es lo que más movimientos desbloquea.
   */
  async reevaluate(tenantId: bigint, limite = LOTE): Promise<ReevaluationSummary> {
    const pendientes = await this.prisma.unresolvedClassification.findMany({
      where: { tenantId, status: 'PENDING' },
      orderBy: [{ occurrenceCount: 'desc' }, { lastSeenAt: 'desc' }],
      take: limite,
    });

    let resueltos = 0;
    let refrescados = 0;

    for (const fila of pendientes) {
      /*
       * Uno a uno y en serie: reclasificar es trabajo real contra el modelo, y
       * lanzarlos todos a la vez competiría con las clasificaciones que alguien
       * está esperando en pantalla. Esto es mantenimiento, no la ruta caliente.
       */
      await this.respirar();
      const veredicto = await this.clasificar(tenantId, fila.rawValue);
      if (veredicto === null) continue;

      /*
       * Cerrar pide MÁS confianza que clasificar en caliente.
       *
       * Aquí no hay nadie mirando: lo que se escriba queda como categoría de la
       * glosa sin que un ojo humano lo confirme. Medido sobre la bandeja real,
       * el umbral de aceptación normal cerraba «POS LIBROS LIBRERIA TEST SABER»
       * como transporte público con 0,79 —el clasificador dudaba y la duda se
       * archivaba como hecho—. Por encima del umbral alto se cierra; entre uno y
       * otro se deja pendiente CON la recomendación puesta, que es exactamente la
       * pantalla que hace falta para decidir en un clic.
       */
      if (veredicto.resuelto && veredicto.categoryCode !== null && this.bastante(veredicto)) {
        await this.cerrar(fila.id, veredicto.categoryCode, veredicto.confidence);
        resueltos += 1;
        continue;
      }
      if (await this.refrescar(fila, veredicto)) refrescados += 1;
    }

    const resumen: ReevaluationSummary = {
      revisados: pendientes.length,
      resueltos,
      refrescados,
      pendientes: pendientes.length - resueltos,
    };
    this.logger.log(
      `Reevaluados ${resumen.revisados} pendientes del tenant ${tenantId}: ` +
        `${resumen.resueltos} resueltos por el catálogo, ${resumen.refrescados} con recomendación nueva.`,
    );
    return resumen;
  }

  /**
   * Arranca una pasada y responde en el acto.
   *
   * No se hace dentro de la petición porque no cabe: reclasificar ciento y pico
   * términos son minutos contra el modelo, y el motor corta toda petición a los
   * 15 s. Medido: el primer intento devolvió 504 con el barrido a medias, que es
   * la peor respuesta posible —el trabajo sigue, y quien lo pidió cree que falló—.
   */
  async start(tenantId: bigint): Promise<ReevaluationState> {
    const pendientes = await this.contarPendientes(tenantId);
    const corriendo = this.enCurso.has(tenantId.toString());
    if (!corriendo && pendientes > 0) this.scheduleAfterCatalogChange(tenantId);
    return { corriendo: true, pendientes, ultima: this.ultima.get(tenantId.toString()) ?? null };
  }

  /** Cómo va: lo consulta la pantalla para saber cuándo dejar de refrescar. */
  async state(tenantId: bigint): Promise<ReevaluationState> {
    return {
      corriendo: this.enCurso.has(tenantId.toString()),
      pendientes: await this.contarPendientes(tenantId),
      ultima: this.ultima.get(tenantId.toString()) ?? null,
    };
  }

  /**
   * El listón para cerrar sin que nadie mire.
   *
   * **Dos cosas distintas se cierran solas, y una tercera nunca.**
   *
   * 1. Lo que el modelo decide con confianza alta (`UNRESOLVED_HIGH_CONFIDENCE`,
   *    0,9). Ese listón nació de un caso real: con el umbral normal, «POS LIBROS
   *    LIBRERIA TEST SABER» se cerró como transporte público con 0,79 —el
   *    clasificador dudaba y la duda quedaba archivada como hecho—.
   * 2. Lo que decide una REGLA de instrumento (`UNRESOLVED_AUTO_CLOSE_FLOOR`,
   *    0,75). No es una similitud dudosa: es determinista, el mismo texto da el
   *    mismo resultado siempre, y se puede leer sin ejecutar nada. Pedirle 0,9 a
   *    una regla mezcla dos cosas que no se miden igual, y el efecto medido fue
   *    una bandeja de 81 pendientes que el motor ya sabía resolver y que aun así
   *    seguía pidiendo atención humana.
   *
   * Y el CAJÓN nunca: `GASTOS.OTROS` / `INGRESOS.OTROS` significan «el concepto
   * no consta». Cerrarlos los sacaría de la bandeja, que es justo donde tienen
   * que estar —son los únicos que de verdad necesitan un ojo humano— y encima
   * dejaría escrito un alias que enseñaría al motor a mandar ahí lo que venga.
   */
  private bastante(veredicto: { confidence: number | null; categoryCode: string | null }): boolean {
    if (veredicto.confidence === null) return false;
    if (veredicto.categoryCode !== null && CAJONES.has(veredicto.categoryCode)) return false;
    const alta = this.config.get<number>('UNRESOLVED_HIGH_CONFIDENCE') ?? 0.9;
    const suelo = this.config.get<number>('UNRESOLVED_AUTO_CLOSE_FLOOR') ?? 0.75;
    return veredicto.confidence >= Math.min(alta, suelo);
  }

  private respirar(): Promise<void> {
    return new Promise((resolver) => setTimeout(resolver, RESPIRO_MS));
  }

  private contarPendientes(tenantId: bigint): Promise<number> {
    return this.prisma.unresolvedClassification.count({
      where: { tenantId, status: 'PENDING' },
    });
  }

  /**
   * Lanza una pasada en segundo plano tras un cambio de catálogo.
   *
   * Sin esto, quien añade la categoría que faltaba tiene que acordarse de volver
   * a la bandeja a limpiar los pendientes que acaba de dejar obsoletos, y nadie
   * se acuerda: por eso la bandeja llegó a pedir a mano decenas de términos que
   * el motor ya sabía clasificar.
   *
   * No se espera al resultado —quien guardó una categoría no tiene por qué
   * quedarse mirando cómo se reclasifican doscientos términos— y una pasada por
   * tenant a la vez: dos cambios seguidos no valen dos barridos simultáneos
   * compitiendo por el modelo.
   */
  scheduleAfterCatalogChange(tenantId: bigint): void {
    const clave = tenantId.toString();
    if (this.enCurso.has(clave)) return;
    this.enCurso.add(clave);
    void this.reevaluate(tenantId)
      .then((resumen) => this.ultima.set(clave, resumen))
      .catch((error: Error) =>
        this.logger.warn(`La reevaluación del tenant ${clave} no terminó: ${error.message}`),
      )
      .finally(() => this.enCurso.delete(clave));
  }

  private readonly enCurso = new Set<string>();
  /**
   * Resultado de la última pasada, en memoria y por proceso.
   *
   * No se persiste a propósito: es información de progreso para la pantalla que
   * la pidió, no un hecho auditable. Lo que sí queda escrito es cada pendiente
   * que se cerró, con su categoría y con `resolvedBy: 'catalogo'`.
   */
  private readonly ultima = new Map<string, ReevaluationSummary>();

  /**
   * Pasa el valor por el mismo análisis que usa el worker.
   *
   * Reutilizarlo —en vez de escribir aquí una comparación «parecida»— es lo que
   * garantiza que un pendiente cerrado por esta pasada se habría cerrado igual si
   * la glosa llegara hoy por la puerta normal. Un fallo del modelo no aborta la
   * pasada: se deja el pendiente como estaba y se sigue.
   */
  private async clasificar(
    tenantId: bigint,
    rawValue: string,
  ): Promise<{
    resuelto: boolean;
    categoryCode: string | null;
    confidence: number | null;
    /** El texto que el clasificador leyó DE VERDAD, ya sin los identificadores. */
    textoClasificado: string;
    candidatas: ReadonlyArray<{ categoryCode: string; confidence: number }>;
  } | null> {
    try {
      const resultado = await this.pipeline.analyze({
        requestId: randomUUID(),
        idempotencyKey: `reevaluacion:${randomUUID()}`,
        text: rawValue,
        tenantId: tenantId.toString(),
      });
      const candidatas = resultado.matches.map((match) => ({
        categoryCode: match.categoryCode,
        confidence: match.confidence,
      }));
      const primera = candidatas[0];
      return {
        resuelto: resultado.status === 'MATCH' && primera !== undefined,
        categoryCode: primera?.categoryCode ?? null,
        confidence: primera?.confidence ?? null,
        textoClasificado: resultado.normalizedText,
        candidatas,
      };
    } catch (error) {
      this.logger.warn(
        `No se pudo reevaluar «${rawValue.slice(0, 60)}»: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Cierra el pendiente dejando escrito QUIÉN lo cerró y con qué.
   *
   * `resolvedBy` dice «catálogo» y no un nombre de persona a propósito: quien
   * audite esta fila tiene que poder distinguir de un vistazo lo que decidió
   * alguien de lo que se cerró solo porque el catálogo mejoró.
   */
  private async cerrar(id: bigint, categoryCode: string, confidence: number | null): Promise<void> {
    await this.prisma.unresolvedClassification.update({
      where: { id },
      data: {
        status: 'AUTO_RESOLVED',
        resolvedCategoryCode: categoryCode,
        resolvedBy: 'catalogo',
        resolvedAt: new Date(),
        resolutionType: 'USE_SUGGESTED',
        suggestedCategoryCode: categoryCode,
        confidence: confidence === null ? null : new Prisma.Decimal(confidence),
        metadata: {
          resueltoPor: 'reevaluacion',
          confianza: confidence,
        } as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Pone al día un pendiente que sigue sin cerrarse: la mejor recomendación de
   * hoy y, sobre todo, el TEXTO que el clasificador lee ahora.
   *
   * Ese texto es lo que la bandeja enseña, y estaba congelado en la forma que
   * tenía el normalizador el día que se abrió el pendiente: se leían glosas con
   * `| MCC 8299 | CONTABILIZADA | TX -F` colgando, ruido que el motor ya
   * descarta y que sólo servía para hacer ilegible la lista.
   */
  private async refrescar(
    fila: { id: bigint; context: Prisma.JsonValue },
    veredicto: {
      textoClasificado: string;
      candidatas: ReadonlyArray<{ categoryCode: string; confidence: number }>;
    },
  ): Promise<boolean> {
    const contexto = {
      ...(typeof fila.context === 'object' && fila.context !== null && !Array.isArray(fila.context)
        ? fila.context
        : {}),
      textoClasificado: veredicto.textoClasificado,
    } as Prisma.InputJsonValue;

    const primera = veredicto.candidatas[0];
    await this.prisma.unresolvedClassification.update({
      where: { id: fila.id },
      data: {
        context: contexto,
        ...(primera === undefined
          ? {}
          : {
              suggestedCategoryCode: primera.categoryCode,
              confidence: new Prisma.Decimal(primera.confidence),
              alternatives: veredicto.candidatas.slice(1, 5) as unknown as Prisma.InputJsonValue,
            }),
      },
    });
    return primera !== undefined;
  }
}
