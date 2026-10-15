import { Injectable } from '@nestjs/common';
import { INSTRUMENTOS } from './glosa-reglas/glosa-instrumentos';
import type { CertezaDeRegla, OrigenDeRegla, Regla } from './glosa-reglas/glosa-regla';
import { RUBROS } from './glosa-reglas/glosa-rubros';
import { RAICES, saleDinero } from './glosa-reglas/glosa-sentido';
import { plegar, recorte } from './glosa-reglas/glosa-texto';

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
 * ## Dos capas, y el orden entre ellas no es negociable
 *
 * - **RUBRO.** La glosa nombra el concepto: `YPFB`, `ELFEC`, `IMPUESTOS
 *   NACIONALES`, `AFP FUTURO`, `ALQUILER`, `NETFLIX`. Aquí el texto dice en qué
 *   se gastó, no sólo cómo se movió el dinero, y por eso es una afirmación
 *   fuerte: tan fuerte que se puede resolver SIN consultar al modelo (ver
 *   `certeza`). Gana siempre a la capa de instrumento porque `PAGO SERVICIO
 *   ELFEC` es electricidad antes que «un pago».
 * - **INSTRUMENTO.** La glosa sólo declara el vehículo: traspaso, QR, POS,
 *   retiro, comisión. Es cierto pero pobre, y sólo se usa cuando ningún rubro
 *   casó.
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
 * No compite con el modelo salvo donde es más fiable que él —los rubros de
 * `certeza: 'ALTA'`, que son nombres propios de empresas y trámites bolivianos—.
 * Y no finge precisión: `GASTOS.TRANSFERENCIAS` afirma «salió dinero por
 * transferencia», que es exactamente lo que consta, y no inventa que fuera
 * alquiler o comida. El resultado se marca con su `origen` para que nadie
 * confunda «lo dice el instrumento» con «lo entendió el modelo».
 *
 * ## El último escalón
 *
 * Si ninguna regla aplica, cae en `GASTOS.OTROS` / `INGRESOS.OTROS` según el
 * sentido. Eso es deliberado: «otros gastos» es una categoría que existe en
 * cualquier contabilidad y se puede sumar, mientras que «sin determinar» no es
 * nada y obliga a quien recibe el informe a decidir por su cuenta qué hacer con
 * la fila. Un movimiento sin concepto sigue siendo dinero que salió.
 */
/** Confianza de un rubro nombrado en la glosa. Alta a propósito: es literal. */
const CONFIANZA_RUBRO = 0.86;

/** Confianza que se publica para una decisión por instrumento. */
const CONFIANZA_REGLA = 0.75;

/** Confianza del último escalón: es un cajón, y se dice que lo es. */
const CONFIANZA_CAJON = 0.4;
export interface DecisionPorRegla {
  readonly categoryCode: string;
  readonly confidence: number;
  readonly rationale: string;
  readonly evidence: string;
  /** Qué capa decidió. La traza no debería tener que deducirlo del texto. */
  readonly origen: OrigenDeRegla;
  /** Si puede resolver sin consultar al modelo. Sólo los rubros literales. */
  readonly certeza: CertezaDeRegla;
  /**
   * `true` cuando el catálogo del tenant no tenía la hoja que la regla pedía y
   * se publicó una alternativa. La decisión sigue siendo válida, pero es menos
   * fina de lo que la regla sabía decir, y quien lea la traza debe saberlo.
   */
  readonly degradado: boolean;
}

/** Cajones del último escalón, por sentido. */
const CAJONES = { SALIDA: 'GASTOS.OTROS', ENTRADA: 'INGRESOS.OTROS' } as const;

/**
 * Todos los códigos que las reglas pueden proponer, sin repetir.
 *
 * Se exporta para que una prueba pueda comprobarlos contra el árbol sembrado.
 * Es el fallo más fácil de introducir aquí y el más difícil de notar: una regla
 * con `GASTOS.SALUD.FARMACIAS` en plural no casa con nada, no rompe ninguna
 * compilación y sólo se manifiesta como un movimiento que acaba en el cajón sin
 * que nadie sepa por qué.
 */
export function codigosPropuestosPorReglas(): readonly string[] {
  return [
    ...new Set(
      [...RUBROS, ...INSTRUMENTOS].flatMap((regla) => [...regla.salida, ...regla.entrada]),
    ),
  ];
}

@Injectable()
export class GlosaFallbackClassifier {
  /**
   * Qué es este movimiento según lo que la glosa declara sin lugar a dudas.
   *
   * Devuelve `null` sólo si el catálogo del tenant no tiene NINGUNA categoría
   * utilizable para el sentido del movimiento —ni la hoja de la regla, ni sus
   * ancestros, ni el cajón, ni la raíz—. Eso ya no es una glosa que no se supo
   * leer: es un catálogo sin rama de gastos, y colocar ahí un código inventado
   * sería peor que no clasificar.
   */
  clasificar(texto: string, codigosDisponibles: ReadonlySet<string>): DecisionPorRegla | null {
    const plegado = plegar(texto);
    const sentidoSalida = saleDinero(plegado);

    for (const capa of [RUBROS, INSTRUMENTOS]) {
      const origen: OrigenDeRegla = capa === RUBROS ? 'RUBRO' : 'INSTRUMENTO';
      for (const regla of capa) {
        if (!regla.patron.test(plegado)) continue;
        const preferidas = sentidoSalida
          ? regla.salida
          : regla.entrada.length > 0
            ? regla.entrada
            : regla.salida;
        const resuelto = this.resolver(preferidas, codigosDisponibles);
        // Una regla que casó pero cuyo catálogo no tiene dónde ponerla no
        // descarta al resto: puede haber otra regla, más general, que sí encaje.
        if (resuelto === null) continue;
        return {
          categoryCode: resuelto.codigo,
          confidence: origen === 'RUBRO' ? CONFIANZA_RUBRO : CONFIANZA_REGLA,
          rationale: this.explicar(origen, regla, resuelto),
          evidence: recorte(texto),
          origen,
          certeza: resuelto.degradado ? 'MEDIA' : regla.certeza,
          degradado: resuelto.degradado,
        };
      }
    }

    const cajon = this.resolver(
      sentidoSalida
        ? [CAJONES.SALIDA, RAICES.SALIDA]
        : [CAJONES.ENTRADA, RAICES.ENTRADA, CAJONES.SALIDA],
      codigosDisponibles,
    );
    if (cajon === null) return null;
    return {
      categoryCode: cajon.codigo,
      confidence: CONFIANZA_CAJON,
      rationale:
        'Ninguna regla de rubro ni de instrumento aplica y el modelo no alcanzó su umbral. Se coloca en «otros» del sentido correspondiente: el concepto no consta, pero el movimiento y su signo sí.',
      evidence: recorte(texto),
      origen: 'CAJON',
      certeza: 'MEDIA',
      degradado: false,
    };
  }

  /**
   * El primer código publicable de una lista de preferencias.
   *
   * Prueba cada preferencia y, si no está, sus ANCESTROS por la ruta punteada:
   * un catálogo poco profundo puede tener `GASTOS.VIVIENDA` como hoja aunque no
   * tenga `GASTOS.VIVIENDA.SERVICIOS`, y clasificar en el padre sigue siendo
   * cierto —sólo menos fino—. Lo que nunca hace es bajar ni saltar de rama: un
   * hermano no es una aproximación, es otra afirmación.
   */
  private resolver(
    preferidas: readonly string[],
    disponibles: ReadonlySet<string>,
  ): { codigo: string; degradado: boolean } | null {
    let primera = true;
    for (const preferida of preferidas) {
      const partes = preferida.split('.');
      for (let corte = partes.length; corte > 0; corte -= 1) {
        const codigo = partes.slice(0, corte).join('.');
        if (!disponibles.has(codigo)) continue;
        return { codigo, degradado: !(primera && corte === partes.length) };
      }
      primera = false;
    }
    return null;
  }

  private explicar(
    origen: OrigenDeRegla,
    regla: Regla,
    resuelto: { codigo: string; degradado: boolean },
  ): string {
    const base =
      origen === 'RUBRO'
        ? `Decidido por regla de rubro: ${regla.porque}. Es lo que la glosa nombra literalmente.`
        : `Decidido por regla de instrumento: ${regla.porque}. El modelo no alcanzó su umbral, y esto es lo que la glosa afirma por sí sola.`;
    return resuelto.degradado
      ? `${base} El catálogo de este tenant no tiene ${regla.salida[0] ?? 'la hoja esperada'}, así que se publica ${resuelto.codigo}, que la contiene.`
      : base;
  }
}
