import { Inject, Injectable } from '@nestjs/common';
import { IdentityDocumentType } from '../core/domain/identity-enums';
import { identityErrors } from '../core/domain/identity-domain.error';
import { medirEvidenciaDeIdentidad } from '../core/engine/identity-evidence';
import { triageIdentityDocument, type IdentityGateOutcome } from '../core/engine/identity-triage';
import {
  IDENTITY_ARBITRATION_PORT,
  IDENTITY_OPTIONS,
  type IdentityOptions,
} from '../core/identity-options';
import type { DocumentOcrResult, IdentityArbitrationPort } from '../core/ports/identity.ports';
import type { DocumentoLeido } from './document-intake.service';
import type { IdentityPipelineInput } from './identity-pipeline-input';

/** El veredicto de la puerta de documento, con lo que el resto del flujo necesita saber de él. */
export interface DocumentoAdmitido {
  evidencia: ReturnType<typeof medirEvidenciaDeIdentidad>;
  /** El tipo que manda: el de la puerta, no el del clasificador. */
  tipoResuelto: IdentityDocumentType;
  /** Marcas de riesgo que nacen en la puerta (`DOCUMENT_ARBITRATED`). */
  riskFlags: string[];
}

/**
 * Por debajo de esto no hay texto que discutir: es ruido del reconocedor sobre
 * una imagen sin letras.
 */
const MIN_READABLE_CHARS = 12;

/**
 * Los defectos que, por sí solos, explican que no se pudiera leer.
 *
 * La lista es corta a propósito, y quién entra y quién no sale de MEDIR los
 * escenarios con `SharpImageAdapter.assess`, no de razonarlo:
 *
 * | escenario            | contraste | nitidez | avisos                        |
 * | -------------------- | --------- | ------- | ----------------------------- |
 * | cédula legible       |     0,393 |    3,56 | OVEREXPOSED                   |
 * | cédula sobre mesa    |     0,614 |    2,14 | —                             |
 * | paisaje (no es doc.) |     0,273 |    0,38 | POSSIBLE_BLUR                 |
 * | imagen plana         |     0,000 |    0,00 | LOW_CONTRAST, POSSIBLE_BLUR   |
 *
 * `POSSIBLE_BLUR` queda FUERA: salta con una nitidez de 0,38, que es lo que da
 * cualquier foto de formas lisas —un cielo con dos colinas— sin que la foto
 * tenga nada de malo. Usarlo para elegir el mensaje hacía que una imagen que
 * simplemente no es un documento recibiera «repite la foto», que manda a quien
 * la subió a arreglar lo que no estaba roto.
 *
 * `OVEREXPOSED` también queda fuera, y por lo contrario: salta en TODAS las
 * cédulas legibles (brillo 0,92 — una tarjeta es blanca). Un aviso que está
 * presente en el caso bueno no distingue nada.
 *
 * Quedan los tres que separan limpio: sin resolución, sin contraste o sin luz no
 * hay lectura posible, y los tres se arreglan repitiendo la captura.
 */
const DEFECTOS_DECISIVOS = ['LOW_RESOLUTION', 'LOW_CONTRAST', 'UNDEREXPOSED'];

/**
 * La puerta de documento: rechaza lo que no es un documento de identidad, deriva a arbitraje la
 * franja de duda y deja pasar el resto. Se corta ANTES de la biometría, que es la parte cara.
 */
@Injectable()
export class DocumentGateService {
  constructor(
    @Inject(IDENTITY_OPTIONS) private readonly options: IdentityOptions,
    @Inject(IDENTITY_ARBITRATION_PORT)
    private readonly arbitration: IdentityArbitrationPort,
  ) {}

  async admit(input: IdentityPipelineInput, read: DocumentoLeido): Promise<DocumentoAdmitido> {
    const { document, documentQuality } = read;
    const { ocr, front, back, classification } = read.lectura;
    const riskFlags: string[] = [];

    /*
     * Si no se reconoce un documento de identidad, esto NO produce veredicto.
     *
     * Es la diferencia entre «no puedo afirmar que sean la misma persona» y «lo
     * que me diste no es un documento». Sin esta guarda, una foto cualquiera
     * seguía el camino entero —el analizador genérico devuelve dos campos
     * derivados y ninguno obligatorio— y salía por la puerta de la revisión
     * manual, cargándole a una persona una cola de fotos de gatos. Peor: con un
     * lector que invente el texto, salía VERIFICADA.
     *
     * Se corta ANTES de comparar rostros: la comparación biométrica es la parte
     * cara y no hay nada que comparar contra un documento que no existe. Es
     * error de VALIDACIÓN, así que el servicio de fondo no lo reencola —una
     * imagen que no es un documento no va a serlo en el segundo intento—.
     */
    /*
     * Y aquí, con la lectura ya intentada, se elige QUÉ se contesta.
     *
     * Es el sitio donde el consejo de calidad vale de algo: sólo cuando la
     * lectura ha fallado tiene sentido decir «está oscura» o «está movida», y
     * sólo entonces se sabe además que no era simplemente otra cosa. Antes se
     * decía sin haber leído, y por eso se lo llevaban fotos legibles.
     *
     * El orden es deliberado: si la medida señala un defecto REAL de captura
     * —poca luz, quemada, movida, diminuta— se contesta eso, porque se arregla
     * repitiendo la foto. Si la imagen estaba bien y aun así no es un documento,
     * se contesta lo otro, que se arregla subiendo otra cosa.
     *
     * Y se miran DEFECTOS CONCRETOS, no el puntaje. El puntaje es una suma
     * ponderada donde resolución y exposición juntas ya pasan el mínimo, así que
     * una imagen grande y bien expuesta lo supera por muy plana que esté: como
     * instrumento para explicar un fallo no sirve.
     */
    /*
     * LA PUERTA. Tres desenlaces donde antes había uno.
     *
     * Lo que cambió no es el rigor —una foto de un gato se sigue rechazando—
     * sino a QUIÉN se le dice qué. Antes toda imagen sin tipo reconocible salía
     * por `IDENTITY_DOCUMENT_UNSUPPORTED`, de modo que la cédula fotografiada de
     * noche y el recibo del supermercado recibían la misma respuesta y el mismo
     * desenlace. Ahora se mide la EVIDENCIA de que haya un documento de
     * identidad —independiente de cuál sea— y esa medida separa las tres cosas:
     * lo que se rechaza, lo que se pregunta y lo que sigue.
     *
     * El defecto de captura conserva su prioridad sobre todo lo demás: si la
     * medición señala un problema real —oscura, quemada, movida— se contesta
     * eso, porque se arregla repitiendo la foto y es la única respuesta que
     * desbloquea a quien está delante del móvil.
     */
    const evidencia = medirEvidenciaDeIdentidad({
      texto: `${front.rawText}\n${back?.rawText ?? ''}`,
      anchoLargo: Math.max(document.quality.width, document.quality.height),
      ladoCorto: Math.min(document.quality.width, document.quality.height),
    });
    /*
     * Un documento ya arbitrado no vuelve a pasar por la puerta.
     *
     * Quien confirmó tenía delante la misma foto y más contexto del que la
     * puerta puede medir —el expediente, el trámite, a veces la persona—, así
     * que volver a preguntarle a un puntaje sería devolver el caso a la cola de
     * la que acaba de salir. Queda constancia en las marcas de riesgo: el
     * veredicto final tiene que poder decir que aquí hubo una mano humana.
     */
    if (input.arbitratedDocumentType != null) {
      riskFlags.push('DOCUMENT_ARBITRATED');
    }
    const puerta: IdentityGateOutcome =
      input.arbitratedDocumentType != null
        ? { verdict: 'ACCEPT', documentType: input.arbitratedDocumentType }
        : triageIdentityDocument({
            evidence: evidencia,
            documentType: classification.type,
            acceptedTypes: this.options.acceptedDocumentTypes,
            thresholds: {
              accept: this.options.documentAcceptConfidence,
              review: this.options.documentReviewConfidence,
            },
          });

    if (puerta.verdict === 'REJECT') {
      /*
       * El aviso de calidad manda SÓLO cuando el rechazo fue por falta de
       * evidencia. Si lo que se reconoció fue otro documento —o un tipo que este
       * flujo no admite— la foto está perfectamente bien y decirle a alguien que
       * repita la captura le hace perder el intento siguiente sin arreglar nada.
       */
      if (
        puerta.reason !== 'UNSUPPORTED_DOCUMENT_TYPE' &&
        evidencia.contraindicator === null &&
        documentQuality.warnings.some((aviso) => DEFECTOS_DECISIVOS.includes(aviso))
      ) {
        throw identityErrors.blurryDocument(documentQuality.warnings);
      }
      if (puerta.reason === 'UNSUPPORTED_DOCUMENT_TYPE') {
        throw identityErrors.documentTypeNotAccepted(puerta.detail);
      }
      throw identityErrors.notAnIdentityDocument(
        `${puerta.detail} ${describeUnreadable(ocr)}`.trim(),
        puerta.reason,
      );
    }

    if (puerta.verdict === 'REVIEW') {
      /*
       * La franja de duda, y el ÚNICO sitio del worker que delega en alguien.
       *
       * Se corta ANTES de la biometría a propósito: comparar rostros es la parte
       * cara, y no hay nada que comparar contra un documento del que todavía no
       * se sabe si lo es. Quien conteste —persona hoy, modelo mañana— decide eso
       * primero; si acepta, el caso se relanza y recorre el camino completo.
       */
      const veredicto = await this.arbitration.arbitrate({
        correlationId: input.correlationId,
        reason: puerta.reason,
        detail: puerta.detail,
        documentType: classification.type,
        evidenceConfidence: evidencia.confidence,
        signals: evidencia.signals,
      });

      if (veredicto.outcome === 'REJECT_DOCUMENT') {
        throw identityErrors.notAnIdentityDocument(veredicto.rationale, 'NOT_AN_IDENTITY_DOCUMENT');
      }

      /*
       * UN ÁRBITRO QUE NO ES UNA PERSONA PUEDE ESCALAR, NUNCA APROBAR.
       *
       * No es desconfianza genérica hacia los modelos: es que la pregunta que
       * llega hasta aquí no se contesta con lo que un árbitro de texto ve. La
       * franja de duda se abre cuando hay evidencia de un documento y no basta
       * para afirmar cuál es, y lo que separa una cédula legítima de una
       * falsificada NO está en el texto —el texto de una falsificación es el de
       * un documento auténtico, porque se copió de uno— sino en los píxeles, que
       * es lo que mira `core/forensics/`. Un árbitro que aprobara leyendo el
       * texto estaría dando por buena justamente la parte que el falsificador
       * copia bien.
       *
       * Así que el `ACCEPT_DOCUMENT` de un árbitro que no es humano se degrada a
       * «sigue en la cola». Escalar sí puede —`REJECT_DOCUMENT` sigue valiendo—:
       * negarse no aprueba nada, y ahí un modelo sí descarga trabajo de la
       * bandeja.
       *
       * Que ocurrió se cuenta en el MOTIVO del error, y no en una marca de
       * riesgo: las marcas viajan dentro del resultado, y aquí no va a haber
       * resultado —esto termina en una excepción y el caso queda abierto—. Una
       * marca empujada justo antes de un `throw` no la lee nadie.
       *
       * Se mira `mode` Y `decidedBy`: el primero es lo que el despliegue
       * configuró y el segundo lo que el adaptador dice de sí mismo. Con
       * cualquiera de los dos basta, porque un adaptador con un fallo podría
       * firmar como humano y la regla tiene que aguantar eso.
       *
       * Cuando exista un árbitro automático que MIRE los píxeles, esta regla
       * cambia aquí y en un solo sitio, deliberadamente y no por descuido.
       */
      const arbitroAutomatico = this.arbitration.mode === 'AI' || veredicto.decidedBy === 'AI';
      if (arbitroAutomatico && veredicto.outcome === 'ACCEPT_DOCUMENT') {
        throw identityErrors.arbitrationPending(
          `El árbitro automático (${veredicto.provider}) dio el documento por bueno, y eso no ` +
            `aprueba por sí solo: la autenticidad se decide sobre la imagen y no sobre el texto. ` +
            `El caso sigue en la bandeja. Motivo del árbitro: ${veredicto.rationale}`,
          puerta.reason,
          this.options.arbitrationMode,
        );
      }
      /*
       * Aceptar sin poder nombrar el tipo no es aceptar: sin tipo no hay
       * analizador, y seguir adelante significaría leer una cédula con el
       * analizador equivocado. Se vuelve a la cola con el mismo motivo, que es
       * la respuesta honesta —«sí es un documento, pero sigo sin saber cuál»—.
       */
      if (
        veredicto.outcome !== 'ACCEPT_DOCUMENT' ||
        classification.type === IdentityDocumentType.UNKNOWN
      ) {
        throw identityErrors.arbitrationPending(
          veredicto.rationale,
          puerta.reason,
          this.options.arbitrationMode,
        );
      }
    }

    /*
     * El tipo que manda es el de la PUERTA, no el del clasificador.
     *
     * Coinciden siempre salvo en un caso, y es justo el que importa: cuando una
     * persona arbitró, ella dijo qué documento es y el clasificador seguía sin
     * saberlo. Leer aquí `classification.type` habría elegido el analizador
     * genérico para una cédula que alguien acababa de identificar.
     */
    const tipoResuelto = puerta.verdict === 'ACCEPT' ? puerta.documentType : classification.type;
    return { evidencia, tipoResuelto, riskFlags };
  }
}

/**
 * Distingue «no leí nada» de «leí algo que no es un documento».
 *
 * Las dos terminan en el mismo rechazo, pero no se arreglan igual: la primera
 * suele ser una foto movida o a contraluz y se cura repitiéndola; la segunda es
 * que se subió otra cosa. Decírselo al usuario es la diferencia entre que
 * reintente bien y que reintente al azar.
 */
function describeUnreadable(ocr: DocumentOcrResult): string {
  const texto = ocr.rawText.replace(/\s+/g, ' ').trim();
  if (texto.length < MIN_READABLE_CHARS) {
    return 'No se pudo leer ningún texto en la imagen. Asegúrate de que sea la foto de un documento de identidad, enfocada, con buena luz y sin reflejos.';
  }
  return 'La imagen tiene texto, pero no corresponde a ningún documento de identidad soportado. Se admiten cédula de identidad boliviana y pasaporte.';
}
