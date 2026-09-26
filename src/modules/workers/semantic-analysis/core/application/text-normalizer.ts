import { Injectable } from '@nestjs/common';
import { EntityAlias } from '../domain/semantic-analysis.types';

interface FoldedText {
  /** Texto plegado a minúsculas y sin diacríticos, usado sólo para localizar alias. */
  readonly value: string;
  /** Mapa `índice plegado -> índice original`, con longitud `value.length + 1`. */
  readonly offsets: readonly number[];
}

interface AliasMatch {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

const WORD_CHARACTER = /[\p{Letter}\p{Number}_]/u;
const DIACRITIC = /\p{Diacritic}/gu;
const REGEXP_METACHARACTER = /[.*+?^${}()|[\]\\]/gu;

/**
 * Campos rotulados de una glosa bancaria, y qué se hace con su valor.
 *
 * Medido sobre 213 glosas distintas de siete extractos bolivianos reales (BNB,
 * BMSC, BEC, BG, BCP, BSO, BUN): 103 caracteres de media y hasta 288, de los
 * cuales el rubro ocupa los primeros veinte y el resto son identificadores.
 *
 * - `descartar`: el valor identifica a una PERSONA, una CUENTA o un BANCO. Para
 *   saber si el movimiento es una transferencia da igual a quién fue; el nombre
 *   sólo acerca la glosa a cualquier otra que mencione a alguien.
 * - `conservar`: el valor es texto libre donde el banco escribe el comercio o el
 *   concepto —`Lugar:POLLOS CHUY FIDALGA`, `Dato Adicional: PAGO DE ACCESORIOS`,
 *   `Nota: PrimeVideoAmzn.com`—. Se quita el rótulo y se deja lo que dice.
 */
const CAMPOS_DE_GLOSA: readonly { etiqueta: string; conservar: boolean }[] = [
  { etiqueta: 'Nombre Originante:', conservar: false },
  { etiqueta: 'Cuenta Destino:', conservar: false },
  { etiqueta: 'Cuenta Origen:', conservar: false },
  { etiqueta: 'Beneficiario:', conservar: false },
  { etiqueta: 'Remitente:', conservar: false },
  { etiqueta: 'Doc.ID:', conservar: false },
  { etiqueta: 'Ciudad:', conservar: false },
  { etiqueta: 'Nombre:', conservar: false },
  { etiqueta: 'Cuenta:', conservar: false },
  { etiqueta: 'Banco:', conservar: false },
  { etiqueta: 'Tarj:', conservar: false },
  { etiqueta: 'Dato Adicional:', conservar: true },
  { etiqueta: 'Lugar:', conservar: true },
  /*
   * `Nota:` se descarta, y la decisión se tomó midiendo, no discutiendo.
   *
   * Es texto libre, así que a veces trae el comercio —`Nota:
   * PrimeVideoAmzn.com`— y eso invitaba a conservarlo. Pero en los extractos
   * reales del Banco Económico casi siempre trae a la CONTRAPARTE: `Nota:
   * AVENDANO DIAZ LILIAN CLAUDIA (B. NACIONAL DE BOLIVIA) varios`. Conservarlo
   * costaba 11 glosas sin categoría y salvaba una o dos, porque la cabecera de
   * ese banco ya dice la operación completa —`DEBITO ACH QR`, `DEBITO POR COMPRA
   * EN COMERCIO ELECTRONIC`— y el comercio no añadía nada que la cabecera no
   * dijera ya.
   */
  { etiqueta: 'Nota:', conservar: false },
];

/** Localiza cualquiera de los rótulos, en el orden en que aparezcan. */
const ROTULOS = new RegExp(
  CAMPOS_DE_GLOSA.map(({ etiqueta }) => etiqueta.replace(REGEXP_METACHARACTER, '\\$&')).join('|'),
  'giu',
);

/**
 * Identificadores: series de cinco o más dígitos, y las mezclas de letras y
 * números que son un código y no una palabra (`P430F44CA0`, `MSC444`).
 *
 * Cinco y no tres: `POS 110`, `CUOTA 3` o un año llevan menos, y son parte de lo
 * que la línea dice. Un número de cuenta boliviano nunca baja de siete.
 */
const IDENTIFICADOR =
  /(?<![\p{Letter}])\d{5,}(?![\p{Letter}])|\b(?=[\p{Letter}]*\d)(?=\d*[\p{Letter}])[\p{Letter}\d]{6,}\b/gu;

/**
 * Sellos del asiento: el estado contable con el que el banco acompaña la línea.
 *
 * No identifican a nadie —por eso `dropIdentifiers` no los tocaba— pero tampoco
 * dicen nada del RUBRO: aparecen igual en un alquiler, en una nómina y en una
 * comisión, así que acercan cada glosa a todas las categorías por igual mientras
 * el rubro, que ocupa cuatro palabras, compite contra doce de relleno.
 *
 * Medido sobre un extracto de sesenta páginas: `ABONO NOMINA ASOCIACION FICT
 * F-019 | RECURRENTE | CONTABILIZADA | TX-635873-J` se abstenía; sin la cola
 * clasifica como sueldo con 1,00. De ocho familias que salían «sin determinar»,
 * siete YA estaban sembradas: lo que fallaba no era el catálogo, era la pregunta.
 */
const SELLO_DE_ASIENTO =
  /\b(?:NO\s+)?(?:CONTABILIZADA|RECURRENTE|PROGRAMADA|LIBERADA|RETENIDO|PROVISIONAL|SIN\s+IMPACTO|SUJETO\s+A\s+COBRO|NETO\s+COMISIONES|GASTOS\s+COMPARTIDOS|AJUSTE\s+OPERATIVO|POSIBLE\s+DUPLICADO|EN\s+REVISION|NO\s+EJECUTADA)\b/giu;

/**
 * Rótulos de referencia que se quedan huérfanos cuando su valor era un
 * identificador y ya se fue: `REF PR-252782-Z` deja un `REF` señalando a nada,
 * `LOTE 1643` deja `LOTE`. Se van con lo que rotulaban.
 *
 * `MCC 4121` se va entero aunque el número no llegue a cinco cifras: es el
 * código del rubro, y el rubro ya está escrito en palabras en la misma línea.
 */
const ROTULO_HUERFANO =
  /\bMCC\s*\d{3,4}\b|\b(?:REF|CASO|CONTRATO|MAND|POLIZA|AUT|ORDEN|LOTE|FORM|EXP|TX|REP|CAMP)\b(?=\s*(?:[-–|]|$|\s))/giu;

/**
 * Referencia con guiones —`TX-635873-J`, `MT-471966-W`, `GV-736180-C`—, tratada
 * como UN token.
 *
 * Va antes que `IDENTIFICADOR` porque aquél sólo ve la parte numérica: se
 * llevaba el `635873` y dejaba `TX` y `-J` sueltos, dos restos que el vector
 * sigue pesando. El prefijo puede venir precedido de su rótulo (`REF
 * PR-252782-Z`) y termina en un dígito de control opcional.
 */
const REFERENCIA_CON_GUIONES =
  /\b(?:REF|CASO|CONTRATO|MAND|POLIZA|AUT|ORDEN|LOTE|FORM|EXP|REP|CAMP)?\s*\b[A-Z]{2,4}-\d{3,}(?:-[A-Z0-9]{1,3})?\b/giu;

/** Rótulo seguido de un número corto: `LOTE 1643`, `AUT 941425`, `FORM 189`. */
const ROTULO_CON_NUMERO =
  /\b(?:REF|CASO|CONTRATO|MAND|POLIZA|AUT|ORDEN|LOTE|FORM|EXP|REP|CAMP|SUC)\s*\.?\s*\d{1,6}\b/giu;

/**
 * Lo que queda de una referencia ya retirada: un guion con dos o tres
 * caracteres, colgando entre espacios. No es una palabra de nadie.
 */
const FRAGMENTO_SUELTO = /(?<=^|\s)[-–][A-Z0-9]{1,3}(?=\s|$)/giu;

@Injectable()
export class TextNormalizer {
  /**
   * Estandariza espacios, caracteres Unicode y alias configurados.
   *
   * La sustitución de alias es insensible a mayúsculas y a diacríticos, respeta límites de palabra
   * Unicode y se aplica en una sola pasada: un fragmento ya sustituido no vuelve a compararse, de
   * modo que los alias no se encadenan entre sí.
   *
   * @param text - Texto original.
   * @param aliases - Alias activos administrados como datos.
   * @returns Texto normalizado sin alterar el significado intencional.
   */
  public normalize(text: string, aliases: readonly EntityAlias[]): string {
    const compactText = this.compact(text);
    if (aliases.length === 0 || compactText.length === 0) {
      return compactText;
    }
    return this.applyAliases(compactText, aliases);
  }

  /**
   * El texto que se CLASIFICA, que ya no es el mismo que se usa para resolver
   * entidades. La separación corrige dos defectos medidos.
   *
   * **Los alias no se despliegan aquí.** `normalize` sustituye la sigla por su
   * nombre canónico porque el resolutor de entidades busca justamente eso, pero
   * al clasificador esa sustitución le quita señal: `PAGO SEGURO OBLIGATORIO
   * SOAT` llegaba como `... Seguro Obligatorio de Accidentes de Tránsito` —sin
   * la única palabra que ataba la línea a un vehículo— y `BS 2.800,00` se
   * convertía en `Boliviano 2.800,00`, que bajó el parecido del alquiler de
   * 0,9137 a 0,8946, lo justo para abstenerse. Cada uno recibe ahora el texto
   * que necesita.
   *
   * **Y se quitan los identificadores.** Una glosa boliviana real trae el rubro
   * en las primeras palabras y cien caracteres de cuentas, nombres y referencias
   * detrás. El vector se calcula sobre todo el texto, así que ese relleno ahoga
   * la señal: contra los siete extractos reales sólo 20 de 213 glosas se
   * clasificaban. Aquí no se interpreta nada ni se recorta por longitud —eso
   * sería adivinar—: se retiran los campos que el propio banco rotula como
   * identidad y las series de dígitos, y se conserva íntegro lo demás.
   */
  public forClassification(text: string, aliases: readonly EntityAlias[] = []): string {
    const compactado = this.compact(text);
    if (compactado.length === 0) return compactado;
    const sinCampos = this.dropLabelledFields(compactado);
    const sinEntidades = this.dropNoisyEntities(sinCampos, aliases);
    return this.compact(this.dropIdentifiers(sinEntidades));
  }

  /**
   * Quita del texto a clasificar las entidades que no dicen nada del RUBRO.
   *
   * Qué es ruido no se adivina: lo dice el propio catálogo de alias por su tipo.
   *
   * - `INSTITUCION` y `MONEDA` se van. Que la contraparte cobre en el Banco de
   *   Crédito o en el Ganadero no cambia si el movimiento es una transferencia,
   *   y esos nombres son largos —`BANCO DE CREDITO DE BOLIVIA S.A.` son seis
   *   palabras— así que pesan más en el vector que el rubro entero. Medido: 36
   *   glosas del Mercantil se quedaban sin categoría con la cabecera correcta
   *   delante, ahogada por el banco de destino.
   * - `IMPUESTO` y `SERVICIO` se quedan. Ahí el nombre ES el rubro: `RC-IVA` y
   *   `SOAT` son exactamente lo que hay que clasificar, y quitarlos dejaría la
   *   línea sin nada que decir.
   */
  private dropNoisyEntities(text: string, aliases: readonly EntityAlias[]): string {
    const ruido = aliases.filter(
      (alias) => alias.entityType === 'INSTITUCION' || alias.entityType === 'MONEDA',
    );
    if (ruido.length === 0) return text;

    // Se buscan las dos formas —la sigla y el nombre canónico— porque un extracto
    // escribe unas veces `BNB` y otras `BANCO NACIONAL DE BOLIVIA`.
    const formas = [...new Set(ruido.flatMap((alias) => [alias.alias, alias.canonicalName]))]
      .filter((forma) => forma.trim().length > 0)
      // De más larga a más corta: si `Banco Unión` se quitara después de `Banco`,
      // quedaría el `Unión` suelto haciéndose pasar por una palabra del rubro.
      .sort((izquierda, derecha) => derecha.length - izquierda.length);

    const folded = this.fold(text);
    const claimed: AliasMatch[] = [];
    for (const forma of formas) {
      const plegada = this.fold(forma).value.trim();
      if (plegada.length === 0) continue;
      for (const match of folded.value.matchAll(this.createAliasPattern(plegada))) {
        const start = folded.offsets[match.index];
        const end = folded.offsets[match.index + match[0].length];
        if (start === undefined || end === undefined || this.overlaps(claimed, start, end))
          continue;
        claimed.push({ start, end, replacement: ' ' });
      }
    }
    return this.rebuild(text, claimed);
  }

  /**
   * Recorre los campos rotulados en orden y reconstruye la glosa.
   *
   * El valor de un campo llega hasta el rótulo siguiente o hasta el final, que
   * es como los bancos los encadenan (`Cuenta Destino: N. Nombre: X. Banco: Y`).
   * Lo que va ANTES del primer rótulo —la cabecera, donde vive el rubro— nunca
   * se toca.
   */
  private dropLabelledFields(text: string): string {
    const rotulos = [...text.matchAll(ROTULOS)];
    if (rotulos.length === 0) return text;

    const conservarPorEtiqueta = new Map(
      CAMPOS_DE_GLOSA.map(({ etiqueta, conservar }) => [etiqueta.toLocaleLowerCase(), conservar]),
    );

    let reconstruido = text.slice(0, rotulos[0].index);
    rotulos.forEach((rotulo, indice) => {
      const inicio = rotulo.index + rotulo[0].length;
      const fin = rotulos[indice + 1]?.index ?? text.length;
      const conservar = conservarPorEtiqueta.get(rotulo[0].toLocaleLowerCase()) ?? false;
      if (conservar) reconstruido += ` ${text.slice(inicio, fin)}`;
    });
    return reconstruido;
  }

  /**
   * Quita los identificadores y la puntuación que queda huérfana al hacerlo.
   *
   * Sin el segundo paso, `Nro. 974071686 BANCO` quedaba como `Nro. BANCO`: un
   * `Nro.` sin número no dice nada y sigue pesando en el vector.
   */
  private dropIdentifiers(text: string): string {
    return (
      text
        .replace(REFERENCIA_CON_GUIONES, ' ')
        .replace(ROTULO_CON_NUMERO, ' ')
        .replace(IDENTIFICADOR, ' ')
        // El sello y el rótulo huérfano se retiran DESPUÉS del identificador:
        // así `REF PR-252782-Z` ya es `REF -Z` cuando se busca el rótulo, y no
        // hace falta que el patrón sepa qué forma tenía la referencia.
        .replace(SELLO_DE_ASIENTO, ' ')
        .replace(ROTULO_HUERFANO, ' ')
        // `SINT#690`: numeración de local pegada al nombre del comercio.
        .replace(/#\s*\d{1,4}\b/gu, ' ')
        .replace(/\b(?:nro|ref|no)\.?\s*(?=[\s.,;:]|$)/giu, ' ')
        .replace(/[.,;:\-–|]+(?=\s|$)/gu, ' ')
        // Lo último: lo que queda de una referencia ya retirada.
        .replace(FRAGMENTO_SUELTO, ' ')
    );
  }

  private compact(text: string): string {
    return text
      .normalize('NFKC')
      .replace(/./gu, (character) => (this.isDisallowedCharacter(character) ? ' ' : character))
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private applyAliases(text: string, aliases: readonly EntityAlias[]): string {
    const folded = this.fold(text);
    const claimed: AliasMatch[] = [];
    const orderedAliases = [...aliases].sort(
      (left, right) => right.alias.length - left.alias.length,
    );

    for (const entityAlias of orderedAliases) {
      const foldedAlias = this.fold(entityAlias.alias).value.trim();
      if (foldedAlias.length === 0) {
        continue;
      }
      const pattern = this.createAliasPattern(foldedAlias);
      for (const match of folded.value.matchAll(pattern)) {
        const start = folded.offsets[match.index];
        const end = folded.offsets[match.index + match[0].length];
        if (start === undefined || end === undefined || this.overlaps(claimed, start, end)) {
          continue;
        }
        claimed.push({ start, end, replacement: entityAlias.canonicalName });
      }
    }

    return this.rebuild(text, claimed);
  }

  /**
   * Construye una vista comparable del texto conservando la posición de cada carácter original.
   */
  private fold(text: string): FoldedText {
    let value = '';
    const offsets: number[] = [];
    let originalIndex = 0;

    for (const codePoint of text) {
      const stripped = codePoint.normalize('NFD').replace(DIACRITIC, '');
      const comparable = (stripped.length === 0 ? codePoint : stripped).toLocaleLowerCase();
      for (let position = 0; position < comparable.length; position += 1) {
        offsets.push(originalIndex);
      }
      value += comparable;
      originalIndex += codePoint.length;
    }
    offsets.push(originalIndex);

    return { value, offsets };
  }

  /**
   * Aplica límites de palabra Unicode sólo cuando el extremo del alias es un carácter de palabra,
   * de modo que alias como `A+B` sigan localizándose.
   */
  private createAliasPattern(foldedAlias: string): RegExp {
    const characters = [...foldedAlias];
    const first = characters[0] ?? '';
    const last = characters[characters.length - 1] ?? '';
    const prefix = WORD_CHARACTER.test(first) ? '(?<![\\p{Letter}\\p{Number}_])' : '';
    const suffix = WORD_CHARACTER.test(last) ? '(?![\\p{Letter}\\p{Number}_])' : '';
    const escaped = foldedAlias.replace(REGEXP_METACHARACTER, '\\$&');
    return new RegExp(`${prefix}${escaped}${suffix}`, 'gu');
  }

  private overlaps(claimed: readonly AliasMatch[], start: number, end: number): boolean {
    return claimed.some((match) => start < match.end && end > match.start);
  }

  private rebuild(text: string, claimed: readonly AliasMatch[]): string {
    if (claimed.length === 0) {
      return text;
    }
    const ordered = [...claimed].sort((left, right) => left.start - right.start);
    let rebuilt = '';
    let cursor = 0;
    for (const match of ordered) {
      rebuilt += text.slice(cursor, match.start) + match.replacement;
      cursor = match.end;
    }
    return rebuilt + text.slice(cursor);
  }

  /**
   * Neutraliza controles C0/C1 y caracteres invisibles usados para ocultar instrucciones.
   */
  private isDisallowedCharacter(character: string): boolean {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      return false;
    }
    return (
      (codePoint >= 0x00 && codePoint <= 0x08) ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x0e && codePoint <= 0x1f) ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x00ad ||
      (codePoint >= 0x200b && codePoint <= 0x200f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2060 && codePoint <= 0x2064) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069) ||
      codePoint === 0xfeff ||
      (codePoint >= 0xe0000 && codePoint <= 0xe007f)
    );
  }
}
