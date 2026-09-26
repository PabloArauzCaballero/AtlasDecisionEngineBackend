import { Inject, Injectable, Logger } from '@nestjs/common';
import { detectarRostros, motorBiometrico, parecidoCoseno } from './human-runtime';
import { IDENTITY_OPTIONS, type IdentityOptions } from '../identity-options';
import type {
  FaceDetectionResult,
  FaceDetectorPort,
  FaceMatchPort,
  FaceMatchResult,
  LivenessPort,
  LivenessResult,
} from '../ports/identity.ports';

/**
 * Biometría REAL, en local: detección, comparación 1:1 y prueba de vida.
 *
 * Sustituye a los tres proveedores simulados que había aquí. La diferencia no es
 * de calidad, es de significado: aquéllos leían el nombre del escenario y
 * devolvían el desenlace que ese nombre pedía, así que un «VERIFICADO» afirmaba
 * únicamente que se había leído un documento válido. Con esto, un «VERIFICADO»
 * afirma además que las dos caras salieron del mismo rostro, que es lo que la
 * palabra promete.
 *
 * Los tres adaptadores comparten el mismo motor cargado una vez
 * (`human-runtime`), y ninguno habla con nadie por la red.
 */

const PROVEEDOR = 'human';
const VERSION = 'human-3.3.6/faceres-1024';

/**
 * Un segundo rostro sólo cuenta si es COMPARABLE en tamaño al principal.
 *
 * La cédula boliviana vigente lleva una segunda foto fantasma, más pequeña, al
 * lado del retrato. Contarla como «segundo rostro» mandaría a revisión manual
 * cada cédula moderna auténtica, y una alarma que salta siempre deja de ser una
 * alarma. Una composición de verdad pega una cara de tamaño parecido; ésa sí se
 * cuenta.
 */
const PROPORCION_SEGUNDO_ROSTRO = 0.45;

@Injectable()
export class HumanFaceDetectorAdapter implements FaceDetectorPort {
  private readonly logger = new Logger(HumanFaceDetectorAdapter.name);

  constructor(@Inject(IDENTITY_OPTIONS) private readonly options: IdentityOptions) {}

  async detectFaces(input: { image: Buffer; correlationId: string }): Promise<FaceDetectionResult> {
    const rostros = await detectarRostros(input.image);
    // De mayor a menor: el retrato del titular es el rostro grande, y el
    // pipeline se queda con el primero.
    const ordenados = [...rostros].sort(
      (a, b) => b.box.width * b.box.height - a.box.width * a.box.height,
    );
    if (ordenados.length === 0) {
      return { faces: [], provider: PROVEEDOR, modelVersion: VERSION };
    }

    const mayor = ordenados[0].box.width * ordenados[0].box.height;
    const relevantes = ordenados.filter(
      (r, i) => i === 0 || r.box.width * r.box.height >= mayor * PROPORCION_SEGUNDO_ROSTRO,
    );
    if (relevantes.length < ordenados.length) {
      this.logger.debug(
        `[${input.correlationId}] descartados ${ordenados.length - relevantes.length} rostros secundarios por tamaño`,
      );
    }

    return {
      faces: relevantes.map((r) => ({ box: r.box, quality: r.score })),
      provider: PROVEEDOR,
      modelVersion: VERSION,
    };
  }

  async health(): Promise<{ ready: boolean; detail?: string }> {
    return salud(`detector, mínimo ${this.options.minDocumentFacePx} px`);
  }
}

@Injectable()
export class HumanFaceMatchAdapter implements FaceMatchPort {
  private readonly logger = new Logger(HumanFaceMatchAdapter.name);

  constructor(@Inject(IDENTITY_OPTIONS) private readonly options: IdentityOptions) {}

  async compare(input: {
    documentFace: Buffer;
    selfieFace: Buffer;
    correlationId: string;
  }): Promise<FaceMatchResult> {
    const [delDocumento, deLaSelfie] = await Promise.all([
      descriptorMayor(input.documentFace),
      descriptorMayor(input.selfieFace),
    ]);

    /*
     * Sin descriptor no hay cifra, y `null` NO es cero.
     *
     * Que el recorte del documento no se deje describir es corriente: un retrato
     * impreso, pequeño y tramado a veces da caja pero no rasgos. Decir 0 % ahí
     * afirmaría «es otra persona» cuando lo cierto es «no pude mirar», y las dos
     * cosas tienen consecuencias opuestas para quien se verifica.
     */
    if (!delDocumento) return sinComparar('NO_FACE_IN_DOCUMENT');
    if (!deLaSelfie) return sinComparar('NO_FACE_IN_SELFIE');

    const similarityScore = parecidoCoseno(delDocumento.embedding, deLaSelfie.embedding);
    this.logger.debug(
      `[${input.correlationId}] parecido ${similarityScore.toFixed(4)} (perfil ${this.options.thresholdProfileVersion})`,
    );

    return {
      similarityScore,
      comparable: true,
      provider: PROVEEDOR,
      modelVersion: VERSION,
      providerDecision: 'COSINE',
      quality: {
        documentFace: delDocumento.score,
        selfieFace: deLaSelfie.score,
      },
      /*
       * El umbral con el que se comparó viaja con el resultado.
       *
       * Un parecido sin el corte que se le aplicó no se puede auditar: dentro de
       * un año, revisando por qué esta verificación salió como salió, el 0,88
       * solo no dice nada si no consta contra qué se midió.
       */
      metadata: {
        umbralAprobacion: this.options.matchThreshold ?? null,
        umbralRevision: this.options.reviewThreshold ?? null,
        perfil: this.options.thresholdProfileVersion,
        medida: 'coseno',
      },
    };
  }

  async health(): Promise<{ ready: boolean; detail?: string }> {
    const perfil = this.options.thresholdProfileVersion;
    const base = await salud(`comparador 1:1, perfil ${perfil}`);
    if (this.options.matchThreshold === undefined) {
      // Se declara NO listo a propósito: sin umbrales el motor de decisión manda
      // todo a revisión manual, y el panel debe decir por qué en vez de enseñar
      // un worker verde que nunca aprueba nada.
      return { ready: false, detail: `sin umbrales calibrados (perfil «${perfil}»)` };
    }
    return base;
  }
}

@Injectable()
export class HumanLivenessAdapter implements LivenessPort {
  private readonly logger = new Logger(HumanLivenessAdapter.name);

  constructor(@Inject(IDENTITY_OPTIONS) private readonly options: IdentityOptions) {}

  /**
   * Prueba de vida sobre la selfie, con las dos redes que trae el motor.
   *
   * `antispoof` responde a «¿esto es un rostro delante de la cámara o la foto de
   * una foto?» y `liveness` a «¿es un rostro vivo?». Se combina con el MÍNIMO de
   * las dos, no con la media: son señales de ataques distintos —una pantalla y
   * una máscara impresa— y una media deja que una convencida tape a la otra.
   *
   * Es una prueba PASIVA: mira una imagen fija. Detecta la foto de una foto y la
   * pantalla, que es el ataque corriente. **No** sustituye a un desafío activo
   * —girar la cabeza, parpadear— frente a un atacante decidido, y por eso el
   * resultado sale con su cifra a la vista en vez de como un sí o un no.
   */
  async verify(input: { selfie: Buffer; correlationId: string }): Promise<LivenessResult> {
    if (!this.options.livenessEnabled) {
      return { outcome: 'NOT_RUN', provider: 'disabled' };
    }

    const rostro = await mayorRostro(input.selfie);
    if (!rostro || rostro.real === null || rostro.live === null) {
      // Sin rostro no se puede afirmar ni negar. El motor de decisión trata
      // INCONCLUSIVE como aviso, no como rechazo.
      return { outcome: 'INCONCLUSIVE', provider: PROVEEDOR, modelVersion: VERSION };
    }

    const score = Math.min(rostro.real, rostro.live);
    this.logger.debug(
      `[${input.correlationId}] antispoof=${rostro.real.toFixed(3)} vida=${rostro.live.toFixed(3)}`,
    );

    const outcome =
      score >= this.options.livenessPassScore
        ? 'PASSED'
        : score < this.options.livenessFailScore
          ? 'FAILED'
          : 'INCONCLUSIVE';

    return { outcome, score, provider: PROVEEDOR, modelVersion: VERSION };
  }

  async health(): Promise<{ ready: boolean; detail?: string }> {
    if (!this.options.livenessEnabled) {
      return { ready: true, detail: 'deshabilitada por configuración' };
    }
    return salud(
      `prueba de vida pasiva, supera en ${this.options.livenessPassScore}, falla bajo ${this.options.livenessFailScore}`,
    );
  }
}

// --- Piezas compartidas ------------------------------------------------------

/** El rostro más grande de la imagen, que es el sujeto. */
async function mayorRostro(imagen: Buffer) {
  const rostros = await detectarRostros(imagen);
  if (rostros.length === 0) return null;
  return rostros.reduce((mejor, r) =>
    r.box.width * r.box.height > mejor.box.width * mejor.box.height ? r : mejor,
  );
}

/** El descriptor del rostro principal, o `null` si no hay rasgos que describir. */
async function descriptorMayor(
  imagen: Buffer,
): Promise<{ embedding: number[]; score: number } | null> {
  const rostro = await mayorRostro(imagen);
  if (!rostro?.embedding || rostro.embedding.length === 0) return null;
  return { embedding: rostro.embedding, score: rostro.score };
}

function sinComparar(motivo: 'NO_FACE_IN_DOCUMENT' | 'NO_FACE_IN_SELFIE'): FaceMatchResult {
  return {
    similarityScore: null,
    comparable: false,
    notComparableReason: motivo,
    provider: PROVEEDOR,
    modelVersion: VERSION,
  };
}

/**
 * Salud de verdad: que los pesos estén cargados.
 *
 * Devolver `ready: true` sin comprobar nada es lo que hacían los simulados, y
 * con este motor sería peor que inútil: un modelo a medias no da error, da CERO
 * ROSTROS, que se lee como «no había nadie en la foto».
 */
async function salud(detalle: string): Promise<{ ready: boolean; detail?: string }> {
  try {
    const human = await motorBiometrico();
    const cargados = human.models.stats().numLoadedModels;
    return cargados >= 5
      ? { ready: true, detail: `${detalle}; ${cargados} modelos en ${human.tf.getBackend()}` }
      : { ready: false, detail: `sólo ${cargados} de 5 modelos cargados` };
  } catch (error) {
    return { ready: false, detail: (error as Error).message };
  }
}
