import { Inject, Injectable } from '@nestjs/common';
import {
  IDENTITY_NORMALIZER_PORT,
  IDENTITY_OPTIONS,
  type IdentityOptions,
} from '../core/identity-options';
import type {
  DocumentFraming,
  DocumentFramerPort,
  FaceCropPort,
  ImageNormalizerPort,
  NormalizedImage,
} from '../core/ports/identity.ports';
import {
  hayIndicioDeDocumento,
  ORIENTATION_PROBE_LONG_EDGE,
  puntuarLectura,
  type Clasificador,
  type Lectura,
} from './document-reading';
import { DocumentTextReaderService } from './document-text-reader.service';
import type { IdentityPipelineInput } from './identity-pipeline-input';

/** Un documento que se pudo enderezar: la foto girada, ya encuadrada y leída. */
export interface DocumentoEnderezado {
  document: NormalizedImage;
  encuadre: DocumentFraming;
  reverso: Buffer | null;
  lectura: Lectura;
}

/** Busca la orientación de una foto de documento tumbada. */
@Injectable()
export class DocumentOrientationService {
  constructor(
    @Inject(IDENTITY_OPTIONS) private readonly options: IdentityOptions,
    @Inject(IDENTITY_NORMALIZER_PORT)
    private readonly images: ImageNormalizerPort & FaceCropPort & DocumentFramerPort,
    private readonly textReader: DocumentTextReaderService,
  ) {}

  /**
   * Endereza la foto: prueba los tres cuartos de vuelta restantes y se queda
   * con el que el clasificador reconoce. `null` si ninguno lo consigue.
   *
   * ── Por qué hace falta ──────────────────────────────────────────────────
   *
   * Tesseract lee texto HORIZONTAL. Quien fotografía su cédula con el móvil en
   * vertical —o sea, casi todo el mundo— entrega la tarjeta tumbada, y eso no se
   * leía. Medido sobre la cédula sintética: derecha se lee entera y clasifica
   * BOLIVIA_CI; girada 90° devuelve 403 caracteres de ruido y CERO palabras
   * reconocibles. Fíjate en los 403 caracteres, porque explican el mensaje que
   * recibía la persona: «la imagen tiene texto, pero no corresponde a ningún
   * documento de identidad soportado». Texto había; documento, no. Es la peor
   * forma de fallar, porque el mensaje culpa al documento y el documento estaba
   * perfecto.
   *
   * ── Por qué el criterio es la COBERTURA DEL CATÁLOGO ────────────────────
   *
   * Lo primero que se probó fue puntuar cada giro por las palabras de cuatro
   * letras o más que devolvía, y NO sirve: a media vuelta la lectura da 27
   * palabras, UNA MÁS que la orientación correcta. Tesseract lee el texto
   * invertido y produce secuencias con toda la pinta de palabras, así que ese
   * criterio elegía la orientación equivocada con más confianza que la buena.
   *
   * Lo segundo fue el CLASIFICADOR, y sobre la tarjeta dibujada funcionaba: sólo
   * la orientación correcta contenía «CÉDULA». Sobre una fotografía real,
   * tampoco sirve, y por una razón que no tiene arreglo dentro de un criterio
   * booleano: a 600 px —el tamaño de la sonda— el reconocedor no llega a leer el
   * rótulo en NINGUNA orientación, así que las cuatro contestaban lo mismo. El
   * documento se rechazaba entero por no encontrar un giro que sí existía.
   *
   * El criterio de hoy es CUÁNTA plantilla del catálogo se reconoce, y se
   * comparan las cuatro orientaciones para quedarse con la mejor en vez de
   * pararse en la primera que pase un umbral. Es lo que convierte una pregunta
   * que a 600 px no tiene respuesta binaria en una que sí tiene respuesta
   * relativa. Medido sobre una cédula boliviana auténtica fotografiada en
   * vertical, a 600 px y con las dos caras:
   *
   *   giro 0°    0,000      giro 180°   0,000
   *   giro 90°   0,000      giro 270°   0,216   <- la orientación correcta
   *
   * Las tres orientaciones equivocadas dan CERO exacto, no «poco»: el catálogo
   * no reconoce nada en el texto invertido. Por eso basta con exigir que la
   * ganadora saque algo y sea la mejor — un empate a cero no elige nada.
   *
   * ── Por qué se gira la foto ORIGINAL y se vuelve a normalizar ───────────
   *
   * Girar la imagen ya normalizada es más barato y sale peor. `normalize`
   * entrega un JPEG, y la rejilla de bloques de ese JPEG queda alineada con la
   * orientación en que se codificó: al girar después, los artefactos caen
   * atravesados sobre las cifras del número y sobre el retrato. Medido: el
   * parecido bajaba de 0,9011 a 0,8707 —por debajo del umbral de aprobación, o
   * sea documento correcto a revisión manual— y a media vuelta se perdían el
   * número de cédula y la fecha de caducidad. Enderezando el original, todo lo
   * que viene después ve exactamente lo que habría visto si la foto se hubiera
   * tomado derecha.
   *
   * ── Coste ───────────────────────────────────────────────────────────────
   *
   * Cero para quien fotografía el documento derecho: esto sólo se llama cuando
   * la lectura normal ya iba a terminar en rechazo. Tres sondas de 600 px, y ya
   * no se para en la primera que pasa: se comparan las tres porque el criterio
   * es relativo. La diferencia son dos pasadas de sonda —unos 500 ms sobre una
   * imagen de ese tamaño— y a cambio deja de depender de que la primera que
   * cruce un umbral sea la buena.
   *
   * El reverso se gira lo mismo que el anverso y no por separado: son las dos
   * caras de UNA tarjeta, fotografiadas por la misma persona en la misma sesión.
   * Si aun así no coincidieran, el reverso no aporta campos —que es lo que ya
   * pasaba antes con cualquier reverso ilegible— y nunca un dato equivocado.
   */
  async buscarOrientacion(
    input: IdentityPipelineInput,
    clasificar: Clasificador,
    yaEncuadrada: Buffer,
  ): Promise<DocumentoEnderezado | null> {
    /*
     * La base de las sondas se reduce UNA vez y se gira en pequeño.
     *
     * Es la mitad del ahorro y no se ve en el reloj del reconocedor. Preparar
     * cada giro a partir del original —girar 12 MP, volver a normalizar,
     * encuadrar— costaba unos 1250 ms por vuelta, o sea casi cuatro segundos de
     * `sharp` para tres preguntas que se contestan con una imagen de 600 px.
     * Partiendo de la imagen que YA está normalizada y encuadrada, girar es
     * trabajo de milisegundos.
     *
     * Lo que se pierde al girar algo ya codificado en JPEG —los artefactos
     * cruzados sobre las cifras, medidos en `rotate`— aquí da igual: la sonda no
     * lee cifras, sólo tiene que reconocer el rótulo. Y cuando acierta, el giro
     * bueno se rehace desde el original, que es donde ese detalle sí importa.
     */
    const baseSonda = await this.images.downscale(yaEncuadrada, ORIENTATION_PROBE_LONG_EDGE);

    /*
     * Las TRES sondas se miden y se comparan; ninguna se acepta por llegar
     * primero.
     *
     * El reverso ni siquiera entra aquí. La sonda contesta una única pregunta
     * —«¿cuánta cédula se ve con este giro?»— y esa la contesta el anverso, que
     * es donde está el rótulo; leer la otra cara para descartarla es pagar el
     * doble por la misma respuesta.
     */
    const sondas: Array<{ grados: 90 | 180 | 270; puntos: number }> = [];
    for (const grados of [90, 180, 270] as const) {
      const sonda = await this.textReader.leerCaras(
        { anverso: await this.images.rotate(baseSonda, grados), reverso: null },
        input,
        clasificar,
        ORIENTATION_PROBE_LONG_EDGE,
      );
      sondas.push({ grados, puntos: puntuarLectura(sonda) });
    }
    sondas.sort((a, b) => b.puntos - a.puntos);

    for (const { grados, puntos } of sondas) {
      // Un empate a cero no elige nada: si el catálogo no reconoce NADA con ese
      // giro, girar la foto entera para volver a leerla sólo gastaría tiempo.
      if (puntos <= 0) break;

      /*
       * A partir de aquí se paga lo caro, y se paga sobre el ORIGINAL: girar la
       * foto tal como llegó y volver a normalizarla es lo que deja el documento
       * como si se hubiera fotografiado derecho. Esto sólo ocurre una vez por
       * ejecución y sólo cuando ya se sabe que hay algo de documento.
       */
      const document = await this.images.normalize(
        await this.images.rotate(input.documentImage, grados),
      );
      const encuadre = await this.images.frame(document.buffer);

      /*
       * La sonda decidió una ORIENTACIÓN y nada más. Los campos —número,
       * nombre, caducidad, MRZ— se rellenan con la lectura de tamaño completo,
       * que es la única calibrada contra los cortes de resolución medidos, y la
       * relectura fina de `run` la vuelve a mejorar si hay documento.
       *
       * Si con la foto entera y las dos caras el catálogo tampoco reconoce
       * nada, este giro no vale: se prueba el siguiente. Una sonda que se
       * equivoque cuesta tiempo, nunca un veredicto.
       */
      const reverso = input.documentBackImage
        ? (await this.images.normalize(await this.images.rotate(input.documentBackImage, grados)))
            .buffer
        : null;
      const lectura = await this.textReader.leerCaras(
        { anverso: encuadre.buffer, reverso },
        input,
        clasificar,
        this.options.ocrMaxLongEdge,
      );
      if (hayIndicioDeDocumento(lectura)) {
        return { document, encuadre, reverso, lectura };
      }
    }
    return null;
  }
}
