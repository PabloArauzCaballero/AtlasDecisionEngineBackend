import { Injectable } from '@nestjs/common';

/**
 * La red de seguridad: qué es un movimiento cuando el modelo no lo sabe decir.
 *
 * ## Por qué existe
 *
 * El clasificador semántico entiende de COMERCIOS y de conceptos. Un extracto
 * real está lleno de movimientos que no nombran ninguno: `TRASPASO CA/CC CON QR
 * (MOVIL) Nota: TRASP.CTAS.TERCEROS ARAUZ CABALLERO PABLO` no dice qué se
 * compró, dice que se transfirió dinero a una persona. Pedirle al modelo que
 * adivine el concepto es pedirle lo que la glosa no trae; lo que la glosa SÍ
 * trae —el instrumento: traspaso, QR, ACH, retiro, depósito, comercio
 * electrónico— es un dato explícito, literal y estable en todos los bancos
 * bolivianos, y se lee con reglas, no con embeddings.
 *
 * ## Por qué reglas y no más ejemplos en el catálogo
 *
 * Se intentó por ahí y no basta, porque el problema no es de vocabulario: dos
 * glosas idénticas salvo el nombre del titular tienen que caer en el mismo sitio
 * SIEMPRE, y un modelo por similitud las deja rondando el umbral. Una regla
 * sobre el instrumento es determinista: el mismo texto da el mismo resultado hoy
 * y dentro de un año, y se puede leer y discutir sin ejecutar nada.
 *
 * ## Qué NO hace
 *
 * No compite con el modelo: sólo actúa cuando el modelo NO decidió. Y no finge
 * precisión: `GASTOS.TRANSFERENCIAS` afirma «salió dinero por transferencia»,
 * que es exactamente lo que consta, y no inventa que fuera alquiler o comida.
 * El resultado se marca como decidido por regla —`rationale` lo dice y la
 * confianza es la de una regla, no la de una similitud— para que nadie confunda
 * «lo dice el instrumento» con «lo entendió el modelo».
 *
 * ## El último escalón
 *
 * Si ninguna regla aplica, cae en `GASTOS.OTROS` / `INGRESOS.OTROS` según el
 * sentido. Eso es deliberado: «otros gastos» es una categoría que existe en
 * cualquier contabilidad y se puede sumar, mientras que «sin determinar» no es
 * nada y obliga a quien recibe el informe a decidir por su cuenta qué hacer con
 * la fila. Un movimiento sin concepto sigue siendo dinero que salió.
 */

/** Confianza que se publica para una decisión por regla. */
const CONFIANZA_REGLA = 0.75;

/** Confianza del último escalón: es un cajón, y se dice que lo es. */
const CONFIANZA_CAJON = 0.4;

/** Marca de que un movimiento SALIÓ, tal como lo escriben los bancos. */
const SALIDA = /^(?:d[ée]bito|cargo|retiro|pago|compra|n\/d)\b|\bd[ée]bito\b/iu;
/** Marca de que un movimiento ENTRÓ. */
const ENTRADA = /^(?:cr[ée]dito|abono|dep[óo]sito|n\/c)\b|\bcr[ée]dito\b|\babono\b/iu;

interface Regla {
  /** Qué instrumento reconoce. */
  readonly patron: RegExp;
  /** Categoría cuando el dinero salió. */
  readonly salida: string;
  /** Categoría cuando el dinero entró. `null` si el instrumento sólo va en un sentido. */
  readonly entrada: string | null;
  /** Cómo se explica en la traza. */
  readonly porque: string;
}

/**
 * Las reglas, de la más específica a la más general.
 *
 * El orden importa: `RETIRO DE EFECTIVO` tiene que ganar a `EFECTIVO` a secas, y
 * `COMPRA EN COMERCIO ELECTRONICO` a `COMPRA`. Se recorre en orden y gana la
 * primera que case.
 */
const REGLAS: readonly Regla[] = [
  {
    patron: /\bretiro\b.*\b(?:efectivo|fondos)\b|\bretiro\s+(?:atm|cajero)\b/iu,
    salida: 'GASTOS.EFECTIVO',
    entrada: null,
    porque: 'la glosa declara un retiro de efectivo',
  },
  {
    patron: /\bdep[óo]sito\b.*\befectivo\b|\befectivo\b.*\bdep[óo]sito\b/iu,
    salida: 'GASTOS.EFECTIVO',
    entrada: 'INGRESOS.EFECTIVO',
    porque: 'la glosa declara un movimiento de efectivo por ventanilla o cajero',
  },
  {
    patron: /\bcomercio\s+electr[óo]nic|\becommerce\b|\bcompra\s+web\b|\bcompra\s+online\b/iu,
    salida: 'GASTOS.COMPRAS.TARJETA',
    entrada: 'INGRESOS.REVERSO',
    porque: 'la glosa declara una compra en comercio electrónico',
  },
  {
    patron:
      /\btraspaso\b|\btransferencia\b|\btrasp\.?ctas\b|\bp2p\b|\bach\b(?!\s*qr)|\bpago\s+inmediato\b/iu,
    salida: 'GASTOS.TRANSFERENCIAS',
    entrada: 'INGRESOS.TRANSFERENCIA',
    porque: 'la glosa declara una transferencia entre cuentas',
  },
  {
    patron: /\bqr\b/iu,
    salida: 'GASTOS.COMPRAS.QR',
    entrada: 'INGRESOS.TRANSFERENCIA',
    porque: 'la glosa declara un cobro o pago por QR',
  },
  {
    patron: /\bpos\b|\bcompra\b|\bconsumo\b/iu,
    salida: 'GASTOS.COMPRAS.TARJETA',
    entrada: 'INGRESOS.REVERSO',
    porque: 'la glosa declara una compra con tarjeta',
  },
  {
    patron: /\bcomisi[óo]n\b|\bmantenimiento\b|\bitf\b|\bimpuesto\b|\bcargo\s+por\b/iu,
    salida: 'GASTOS.FINANCIEROS.COMISIONES',
    entrada: 'INGRESOS.REVERSO',
    porque: 'la glosa declara un cargo del propio banco',
  },
  {
    patron: /\binter[ée]s\b|\brendimiento\b|\bcapitalizaci[óo]n\b/iu,
    salida: 'GASTOS.FINANCIEROS.PRESTAMOS',
    entrada: 'INGRESOS.FINANCIERO',
    porque: 'la glosa declara intereses',
  },
];

export interface DecisionPorRegla {
  readonly categoryCode: string;
  readonly confidence: number;
  readonly rationale: string;
  readonly evidence: string;
}

@Injectable()
export class GlosaFallbackClassifier {
  /**
   * Qué es este movimiento según lo que la glosa declara sin lugar a dudas.
   *
   * Devuelve `null` sólo si la categoría propuesta no existe en el catálogo del
   * tenant: antes que colocar un código que nadie definió, se deja sin resolver
   * y la bandeja de pendientes hace su trabajo.
   */
  clasificar(texto: string, codigosDisponibles: ReadonlySet<string>): DecisionPorRegla | null {
    const sentidoSalida = this.saleDinero(texto);

    for (const regla of REGLAS) {
      if (!regla.patron.test(texto)) continue;
      const codigo = sentidoSalida ? regla.salida : (regla.entrada ?? regla.salida);
      if (!codigosDisponibles.has(codigo)) continue;
      return {
        categoryCode: codigo,
        confidence: CONFIANZA_REGLA,
        rationale: `Decidido por regla de instrumento: ${regla.porque}. El modelo no alcanzó su umbral, y esto es lo que la glosa afirma por sí sola.`,
        evidence: this.recorte(texto),
      };
    }

    const cajon = sentidoSalida ? 'GASTOS.OTROS' : 'INGRESOS.OTROS';
    if (!codigosDisponibles.has(cajon)) return null;
    return {
      categoryCode: cajon,
      confidence: CONFIANZA_CAJON,
      rationale:
        'Ninguna regla de instrumento aplica y el modelo no alcanzó su umbral. Se coloca en «otros» del sentido correspondiente: el concepto no consta, pero el movimiento y su signo sí.',
      evidence: this.recorte(texto),
    };
  }

  /**
   * El sentido del movimiento, leído del propio texto.
   *
   * El portal antepone `DEBITO`/`CREDITO` cuando la glosa no lo dice, así que
   * esta marca está presente siempre. Ante la duda se asume SALIDA: en un
   * extracto la mayoría de las filas lo son, y equivocarse hacia el gasto es el
   * error conservador cuando lo que se mide es capacidad de pago.
   */
  private saleDinero(texto: string): boolean {
    if (ENTRADA.test(texto) && !SALIDA.test(texto)) return false;
    return true;
  }

  private recorte(texto: string): string {
    return texto.length <= 120 ? texto : `${texto.slice(0, 117)}…`;
  }
}
