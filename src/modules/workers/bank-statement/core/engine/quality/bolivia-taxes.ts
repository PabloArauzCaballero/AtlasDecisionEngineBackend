/**
 * Los impuestos que aparecen en un extracto boliviano, VERSIONADOS por hecho.
 *
 * ## Por qué esto no es una tabla de alícuotas
 *
 * Porque la pregunta que un extracto plantea no es «¿cuánto se retuvo?» sino
 * «¿qué puedo AFIRMAR de esta fila?». Y la respuesta cambió en 2026: el
 * Impuesto a las Transacciones Financieras está **abrogado** por la Ley 1717,
 * promulgada el 10 de abril de 2026.
 *
 * Eso crea exactamente el escenario que rompe un motor ingenuo: el glosario
 * oficial del BCP —que es de antes— sigue publicando `ITF`, `IMPUESTO ITF` y
 * `DEVOLUCION ITF`, y los extractos reales siguen trayendo esas filas, porque un
 * reverso, una regularización o un hecho anterior al corte llevan el impuesto de
 * su época. Un motor que infiriera «el ITF está abrogado, luego esta fila es
 * falsa» rechazaría documentos auténticos; uno que infiriera «hay ITF, luego el
 * impuesto está vigente» calcularía mal el neto de cualquier proyección.
 *
 * El corpus resuelve las dos con la misma frase (contradicción C04): el
 * vocabulario puede ser histórico; **ni vigencia desde una glosa, ni fraude
 * desde un ajuste posterior**.
 *
 * ## Lo que deliberadamente NO se sabe
 *
 * - La **fecha de corte operativo** exacta (`corteOperativoExacto: null`). Sin
 *   ella, no se puede decidir por fecha si una fila «debía» llevar ITF, y por
 *   eso este módulo nunca convierte una fecha en una acusación.
 * - Las **alícuotas históricas** por periodo (`null`). No se reconstruye el
 *   importe esperado de una retención.
 * - La alícuota, base y exenciones del **RC-IVA** (hueco G06 del corpus). Lo
 *   único verificado son los tres literales del glosario.
 * - La retención de **IUE** sobre intereses: `UNRESOLVED`. Sin alícuota,
 *   beneficiario ni exenciones verificados, no se aplica «por coincidencia
 *   léxica», que es la instrucción literal del corpus.
 */

import { IMPUESTOS_BOLIVIA } from '../../corpus/corpus-extractos.generated';

export type BolivianTax = 'ITF' | 'RC_IVA' | 'IUE' | 'OTHER_TAX';

export interface TaxReading {
  readonly tax: BolivianTax;
  /** `ABROGATED`, `LITERAL_GLOSAS_ONLY_TAX_RULE_NOT_VERIFIED`, `UNRESOLVED`… */
  readonly status: string;
  /**
   * Si este impuesto puede cobrarse hoy como cargo regular.
   *
   * `null` significa NO VERIFICADO, que es distinto de `false`. Sólo el ITF
   * tiene un `false` sostenido por una ley.
   */
  readonly currentlyChargeable: boolean | null;
  /** Alícuota vigente verificada. `null` en los cuatro: no se verificó ninguna. */
  readonly currentRate: number | null;
  /**
   * SIEMPRE `false`.
   *
   * Está escrito como campo y no como comentario porque es la conclusión que el
   * corpus quiere que sobreviva a la próxima refactorización: ninguna glosa de
   * impuesto, en ninguna fecha, justifica por sí sola una marca de fraude.
   */
  readonly automaticFraud: false;
  /** Qué hay que hacer con la fila, en una frase. */
  readonly note: string;
}

/**
 * Literales de impuesto, tomados del glosario OFICIAL y de la forma en que los
 * escriben otros emisores.
 *
 * Los del BCP salen del corpus (`RCIVA`, `RETENCIONRCIVA`, `RETRCIVA-OG`,
 * `IMPUESTO ITF`, `ITF`, `DEVOLUCION ITF`, `IVA ODG`). Los demás patrones
 * cubren lo que se observó en extractos de otros bancos —`BT-ITFAP`, `DEBITO
 * ITF`—, y están marcados como tales: son reconocimiento, no normativa.
 */
const ITF = /\bBT[-\s]?ITFAP\b|\bITF(?:AP)?\b|IMPUESTO\s+ITF/i;
const RC_IVA = /\bRC[-\s]?IVA\b|RETENCION\s*RCIVA|RETRCIVA/i;
const IUE = /\bIUE\b/i;
const OTHER = /\bIVA\b|IMPUESTO|IMPUESTOS\s+NACIONALES/i;

/**
 * Qué impuesto declara esta glosa, si alguno.
 *
 * `null` no es «no hay impuesto»: es «esta glosa no nombra ninguno». El importe
 * de una comisión bancaria puede llevar impuestos dentro sin decirlo, y este
 * módulo no lo adivina.
 */
export function readTaxGloss(description: string): TaxReading | null {
  if (ITF.test(description)) {
    return {
      tax: 'ITF',
      status: IMPUESTOS_BOLIVIA.itf.estado,
      currentlyChargeable: IMPUESTOS_BOLIVIA.itf.cargoRegularVigente,
      currentRate: IMPUESTOS_BOLIVIA.itf.alicuotaVigente,
      automaticFraud: false,
      note:
        `Abrogado por la Ley ${IMPUESTOS_BOLIVIA.itf.ley} (${IMPUESTOS_BOLIVIA.itf.promulgacion}). ` +
        'Una fila con ITF puede ser un hecho anterior, un reverso o una regularización: ' +
        'se investiga, no se rechaza.',
    };
  }
  if (RC_IVA.test(description)) {
    return {
      tax: 'RC_IVA',
      status: IMPUESTOS_BOLIVIA.rciva.estado,
      currentlyChargeable: null,
      currentRate: IMPUESTOS_BOLIVIA.rciva.alicuota,
      automaticFraud: false,
      note:
        'Sólo están verificados los literales del glosario del emisor. ' +
        'Alícuota, base y exenciones no se verificaron: no se reconstruye el importe esperado.',
    };
  }
  if (IUE.test(description)) {
    return {
      tax: 'IUE',
      status: IMPUESTOS_BOLIVIA.iue.estado,
      currentlyChargeable: null,
      currentRate: null,
      automaticFraud: false,
      note: IMPUESTOS_BOLIVIA.iue.hallazgo,
    };
  }
  if (OTHER.test(description)) {
    return {
      tax: 'OTHER_TAX',
      status: 'NOT_IDENTIFIED',
      currentlyChargeable: null,
      currentRate: null,
      automaticFraud: false,
      note: 'La glosa nombra un impuesto que este catálogo no identifica. Se registra, no se interpreta.',
    };
  }
  return null;
}

/**
 * Una fila con ITF fechada DESPUÉS de la promulgación de la Ley 1717.
 *
 * Es una observación para el expediente y nada más. Existe porque quien revisa
 * un caso agradece saber que esa línea merece una mirada, y **no** existe para
 * puntuar riesgo: el corpus lo prohíbe con nombre y apellidos
 * (`NO_AUTOMATIC_FRAUD_FLAG`) y el corte operativo exacto ni siquiera se
 * verificó, así que la fecha no distingue lo raro de lo normal.
 */
export function isPostAbrogationItf(description: string, isoDate: string | null): boolean {
  if (!ITF.test(description)) return false;
  const promulgated = IMPUESTOS_BOLIVIA.itf.promulgacion;
  if (!isoDate || !promulgated) return false;
  return isoDate.slice(0, 10) > promulgated;
}

/** Lo que el corpus verificó del salario mínimo, y lo que NO se deduce de él. */
export const MINIMUM_WAGE = IMPUESTOS_BOLIVIA.salarioMinimo;
