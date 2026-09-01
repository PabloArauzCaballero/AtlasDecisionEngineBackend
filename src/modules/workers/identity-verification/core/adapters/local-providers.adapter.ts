import { Injectable } from '@nestjs/common';
import { IdentityDocumentType } from '../domain/identity-enums';
import { esCedulaBoliviana, reconocerCedulaBoliviana } from '../catalog/bolivia-ci.recognizer';
import type {
  DocumentClassificationInput,
  DocumentClassificationResult,
  DocumentClassifierPort,
  LivenessPort,
  LivenessResult,
} from '../ports/identity.ports';

/**
 * Los dos proveedores que no necesitan una red neuronal detrás.
 *
 * **Aquí ya no queda nada simulado.** El archivo se llamaba
 * `mock-providers.adapter.ts` y contenía cinco adaptadores que fingían: un
 * lector que devolvía siempre la misma cédula boliviana pasara lo que pasara en
 * la imagen, un detector con una caja fija, un comparador que elegía el parecido
 * por el nombre del escenario y una prueba de vida que hacía lo mismo. Con
 * aquello, un «VERIFICADO» no afirmaba nada comprobable.
 *
 * Hoy la lectura es `TesseractOcrAdapter` y la biometría entera —detección,
 * comparación 1:1 y prueba de vida— es `HumanFaceAdapter`, las dos reales, en
 * local y sin credenciales. Lo que sobrevive en este archivo es lo que nunca
 * fingió:
 *
 * - el CLASIFICADOR, que decide qué tipo de documento es a partir del texto ya
 *   leído. Es una heurística sobre texto real, no un simulacro: si el
 *   reconocedor no vio «CÉDULA», aquí no aparece.
 * - la prueba de vida DESHABILITADA, que es una opción de despliegue y no un
 *   sustituto. Devuelve `NOT_RUN`, y el motor de decisión trata eso como señal
 *   ausente —nunca como superada—.
 */

/**
 * De qué documento se trata, contra el CATÁLOGO de la cédula boliviana.
 *
 * ## Lo que había, y por qué rechazaba cédulas auténticas
 *
 * Una expresión regular: `/CEDULA|CÉDULA|C\.I\.|IDENTIDAD/`. Sobre los
 * ejemplares sintéticos funcionaba siempre; sobre una fotografía de una cédula
 * real, nunca. Medido con una cédula boliviana auténtica del DS 4924 tomada con
 * un móvil, el reconocedor devuelve el rótulo partido y mutilado —`CEI 1 DE` en
 * un renglón, `IDENTI AD` en otro— y ninguna de las cuatro alternativas casaba.
 *
 * La consecuencia no era sólo un tipo `UNKNOWN`. `IdentityPipelineService` usa
 * ESTE clasificador como criterio para encontrar la orientación de la foto, así
 * que una tarjeta fotografiada en vertical —o sea, la mayoría— tampoco
 * encontraba su giro: las cuatro orientaciones devolvían `UNKNOWN`, la evidencia
 * se medía sobre texto ilegible y la persona recibía «la imagen no corresponde a
 * ningún documento de identidad soportado» sobre su propia cédula.
 *
 * ## Lo que hace ahora
 *
 * Cotea el texto contra el catálogo versionado de las dos generaciones de la
 * tarjeta (`catalog/bolivia-ci.recognizer.ts`) con tolerancia a las erratas del
 * reconocedor, y devuelve la CONFIANZA como el porcentaje de plantilla que
 * encontró. No es una nota inventada: es la proporción del peso del catálogo que
 * casó, y la traza del caso puede enumerar qué anclajes fueron.
 *
 * ## Por qué el pasaporte y la licencia se preguntan ANTES
 *
 * Porque el catálogo describe una tarjeta oficial boliviana y todas las tarjetas
 * oficiales bolivianas se parecen: encabezado del Estado, nombres, apellidos,
 * dos fechas. Medido con una licencia de conducir sintética, la cobertura
 * llegaba a 0,558. Lo que impide confundirlas son dos cosas y las dos están
 * puestas: preguntar primero por el documento que se declara a sí mismo, y
 * exigirle al catálogo un anclaje que SÓLO lleva una cédula
 * (`ANCLAJES_IDENTIFICADORES`).
 */
@Injectable()
export class HeuristicDocumentClassifierAdapter implements DocumentClassifierPort {
  async classify(input: DocumentClassificationInput): Promise<DocumentClassificationResult> {
    const text = input.rawText.toUpperCase();
    const signals: string[] = [];

    /*
     * El documento que se nombra a sí mismo manda sobre el parecido con un
     * catálogo. Un pasaporte imprime `PASAPORTE` y una MRZ de tipo `P<`; una
     * licencia imprime que lo es. Ninguna de las dos afirmaciones se confunde
     * con un parecido, así que se contestan primero y sin discusión.
     */
    if (/PASSPORT|PASAPORTE|P<[A-Z]{3}/.test(text)) {
      signals.push('passport-label-or-mrz');
      return { type: IdentityDocumentType.PASSPORT, confidence: 0.9, signals };
    }
    if (/DRIVER|LICENCIA.*CONDUC/.test(text)) {
      signals.push('driver-license-label');
      return { type: IdentityDocumentType.DRIVER_LICENSE, confidence: 0.82, signals };
    }

    if (input.documentCountry.toUpperCase() === 'BO') {
      /*
       * El anverso y el reverso van SEPARADOS cuando quien llama los tiene.
       *
       * Un anclaje de reverso encontrado en el anverso no es la tarjeta que el
       * catálogo describe, y medir las dos caras juntas convertía el catálogo en
       * una bolsa de palabras. Quien sólo tiene una cara la manda como anverso y
       * el reverso queda vacío: sus anclajes salen del denominador en vez de
       * contar como ausentes.
       */
      const reconocimiento = reconocerCedulaBoliviana({
        textoAnverso: input.frontText ?? input.rawText,
        textoReverso: input.backText ?? '',
      });
      if (esCedulaBoliviana(reconocimiento)) {
        signals.push(
          'country=BO',
          `plantilla=${reconocimiento.mejor.generacion}`,
          ...reconocimiento.mejor.anclajesEncontrados.map((id) => `anclaje:${id}`),
        );
        return {
          type: IdentityDocumentType.BOLIVIA_CI,
          // La confianza ES la cobertura del catálogo. Antes era un 0,94 fijo
          // que no medía nada: la misma nota para una tarjeta leída entera y
          // para una en la que sólo se distinguía la palabra «identidad».
          confidence: reconocimiento.mejor.cobertura,
          signals,
        };
      }
      signals.push(`cobertura=${String(reconocimiento.mejor.cobertura)}`);
    }

    return {
      type: IdentityDocumentType.UNKNOWN,
      confidence: 0.2,
      signals: [...signals, 'no-strong-signal'],
    };
  }
}

@Injectable()
export class DisabledLivenessAdapter implements LivenessPort {
  async verify(): Promise<LivenessResult> {
    return { outcome: 'NOT_RUN', provider: 'disabled' };
  }

  async health(): Promise<{ ready: boolean; detail?: string }> {
    return { ready: true, detail: 'deshabilitada por configuración' };
  }
}
