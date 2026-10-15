import { Inject, Injectable, Logger } from '@nestjs/common';
import { SEMANTIC_WORKER_CONFIG } from './ports';
import { Decision } from './decision-engine';
import {
  GlosaFallbackClassifier,
  ladoDelCodigo,
  sentidoDeclarado,
  type DecisionPorRegla,
} from './glosa-fallback';
import { leavesOf } from '../domain/category-tree';
import { MOTIVOS_DE_REVISION } from '../domain/review-reason';
import type { SemanticCategory } from '../domain/semantic-analysis.types';
import { SemanticWorkerConfig } from '../config/semantic-worker.config';

/** La decisión de partida cuando nadie resolvió: la red de seguridad decide si la rescata. */
export const UNRESOLVED_DECISION: Decision = {
  status: 'UNKNOWN',
  matches: [],
  requiresDeepAnalysis: false,
  decidedBy: 'MODEL',
  requiresReview: true,
  reviewReason: MOTIVOS_DE_REVISION.LOW_CONFIDENCE,
};

/**
 * Las reglas de la glosa puestas como red de seguridad del modelo: el atajo por
 * rubro literal antes de preguntarle a nadie, y el rescate cuando el modelo no
 * resolvió o contradijo lo que el banco afirma.
 */
@Injectable()
export class RuleSafetyNet {
  private readonly logger = new Logger(RuleSafetyNet.name);

  public constructor(
    private readonly fallback: GlosaFallbackClassifier,
    @Inject(SEMANTIC_WORKER_CONFIG)
    private readonly config: SemanticWorkerConfig,
  ) {}

  /**
   * La decisión final, con la red de seguridad puesta.
   *
   * Si el modelo resolvió, manda el modelo y aquí no pasa nada. Si no —umbral no
   * alcanzado, empate, contradicción, o ni siquiera hubo candidatas—, la glosa
   * se lee por REGLAS: el rubro (`ELFEC`, `YPFB`, `ALQUILER`) primero y el
   * instrumento (`TRASPASO`, `QR`, `RETIRO DE EFECTIVO`) después. Los dos son
   * literales, están en todos los extractos bolivianos y no necesitan modelo.
   *
   * Lo que se gana no es precisión, es COBERTURA honesta: «salió dinero por
   * transferencia» consta en la glosa; «sin determinar» no dice nada y obliga a
   * quien recibe el informe a resolverlo por su cuenta, fila por fila.
   *
   * **Y lo que se publica lleva su procedencia.** Una decisión rescatada por
   * regla no se disfraza de acierto del modelo: `decidedBy` lo dice y, salvo que
   * el rubro fuera literal e inequívoco, `requiresReview` manda el caso a la
   * bandeja igualmente. No abstenerse nunca sólo es defendible si se distingue
   * lo que se supo de lo que se dedujo.
   */
  public garantizarCategoria(
    decision: Decision,
    normalizedText: string,
    categories: readonly SemanticCategory[],
    motivo: string | null = null,
  ): Decision {
    if (
      this.yaResolvio(decision) &&
      motivo === null &&
      !this.contradiceElLado(decision, normalizedText)
    )
      return decision;
    const disponibles = new Set(leavesOf(categories).map((categoria) => categoria.code));
    const regla = this.fallback.clasificar(normalizedText, disponibles);
    if (regla === null) return decision;

    this.logger.debug(`Glosa resuelta por ${regla.origen} como ${regla.categoryCode}.`);
    return this.desdeRegla(regla, motivo ?? MOTIVOS_DE_REVISION.LOW_CONFIDENCE);
  }

  /**
   * El atajo: resolver sin preguntarle a nadie cuando la glosa se explica sola.
   *
   * Sólo lo activan los rubros de certeza ALTA —nombres propios de empresas y
   * trámites bolivianos— y sólo si la hoja existe tal cual en el catálogo del
   * tenant. Ahí el modelo no puede aportar nada: `SAGUAPAC` es agua, y una
   * similitud coseno sobre esa palabra es un rodeo caro para llegar al mismo
   * sitio.
   *
   * El ahorro no es teórico. Un extracto de trescientos movimientos trae más de
   * la mitad de sus filas con el rubro rotulado; sin atajo son trescientas
   * llamadas al proveedor compitiendo por el mismo reloj, y las últimas son las
   * que agotan el presupuesto y acaban en la bandeja por lentitud.
   */
  public atajoPorRubro(
    normalizedText: string,
    categories: readonly SemanticCategory[],
  ): Decision | null {
    if (!this.config.ruleFastPathEnabled) return null;
    const disponibles = new Set(leavesOf(categories).map((categoria) => categoria.code));
    const regla = this.fallback.clasificar(normalizedText, disponibles);
    if (regla === null) return null;
    if (regla.origen !== 'RUBRO' || regla.certeza !== 'ALTA' || regla.degradado) return null;
    return this.desdeRegla(regla, null);
  }

  /**
   * Si el modelo puso el movimiento en el lado del libro que el banco NO dijo.
   *
   * Es la única circunstancia en la que una decisión ya resuelta se descarta, y
   * la razón es que aquí no compiten dos opiniones: compiten una opinión y un
   * dato. Cuando la glosa empieza por `DEBITO`, el banco no está sugiriendo que
   * el dinero salió, lo está afirmando; una similitud coseno de 0,73 no es
   * evidencia contraria de nada.
   *
   * Medido sobre los 473 movimientos de siete extractos reales, esto ocurría en
   * diez: `DEBITO TRANSFERENCIA ACH … CESPEDES VILLARROEL ROMY CECILIA …`
   * —una transferencia SALIENTE— se publicaba como `INGRESOS.TRANSFERENCIA`. En
   * un informe de capacidad de pago ese error cuenta doble: infla el ingreso y
   * descuenta el gasto con el mismo apunte.
   *
   * Sólo vetan las marcas CONTABLES (`sentidoDeclarado`), nunca los verbos de
   * concepto. La diferencia está medida y tiene un caso que la sostiene: «PAGO
   * DE INTERES» es el banco pagando al cliente, y leer ese `PAGO` como salida
   * habría estropeado el único movimiento que ya estaba bien clasificado.
   *
   * Lo que sigue después no es una categoría inventada: se cae a las reglas, que
   * leen el sentido del mismo sitio del que salió el veto, y el resultado va a
   * la bandeja de revisión. El desacuerdo entre el banco y el modelo es
   * exactamente lo que una persona tiene que mirar.
   */
  private contradiceElLado(decision: Decision, normalizedText: string): boolean {
    const declarado = sentidoDeclarado(normalizedText);
    if (declarado === null) return false;
    const elegido = decision.matches[0]?.categoryCode;
    if (elegido === undefined) return false;
    const lado = ladoDelCodigo(elegido);
    if (lado === null || lado === declarado) return false;
    this.logger.warn(
      `El modelo situó «${normalizedText.slice(0, 60)}» en ${elegido}, pero el banco la rotuló como ${declarado}: se resuelve por reglas y se manda a revisión.`,
    );
    return true;
  }

  /** Una decisión ya publicable: el modelo eligió algo y lo sostiene. */
  private yaResolvio(decision: Decision): boolean {
    return decision.status === 'MATCH' || decision.status === 'MULTI_MATCH';
  }

  /**
   * Traduce una regla a la decisión que se publica.
   *
   * El único caso que NO va a la bandeja es el rubro literal e inequívoco: ahí
   * la regla no está supliendo al modelo, está leyendo un nombre propio que el
   * modelo no habría leído mejor. Todo lo demás —instrumento, cajón, rubro
   * degradado por catálogo— se publica Y se revisa.
   */
  private desdeRegla(regla: DecisionPorRegla, motivo: string | null): Decision {
    const inequivoca = regla.origen === 'RUBRO' && regla.certeza === 'ALTA' && !regla.degradado;
    const razon = motivo ?? (inequivoca ? null : MOTIVOS_DE_REVISION.LOW_CONFIDENCE);
    return {
      status: 'MATCH',
      requiresDeepAnalysis: false,
      decidedBy: regla.origen === 'CAJON' ? 'BIN' : 'RULE',
      requiresReview: razon !== null,
      reviewReason: razon as Decision['reviewReason'],
      matches: [
        {
          categoryCode: regla.categoryCode,
          confidence: regla.confidence,
          supported: true,
          contradicted: false,
          evidence: [regla.evidence],
          rationale: regla.rationale,
        },
      ],
    };
  }
}
