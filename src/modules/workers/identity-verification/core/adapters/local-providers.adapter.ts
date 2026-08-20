import { Injectable } from '@nestjs/common';
import { IdentityDocumentType } from '../domain/identity-enums';
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

@Injectable()
export class HeuristicDocumentClassifierAdapter implements DocumentClassifierPort {
  async classify(input: DocumentClassificationInput): Promise<DocumentClassificationResult> {
    const text = input.rawText.toUpperCase();
    const signals: string[] = [];
    if (
      input.documentCountry.toUpperCase() === 'BO' &&
      /CEDULA|CÉDULA|C\.I\.|IDENTIDAD/.test(text)
    ) {
      signals.push('country=BO', 'identity-label');
      return { type: IdentityDocumentType.BOLIVIA_CI, confidence: 0.94, signals };
    }
    if (/PASSPORT|PASAPORTE|P<[A-Z]{3}/.test(text)) {
      signals.push('passport-label-or-mrz');
      return { type: IdentityDocumentType.PASSPORT, confidence: 0.9, signals };
    }
    if (/DRIVER|LICENCIA.*CONDUC/.test(text)) {
      signals.push('driver-license-label');
      return { type: IdentityDocumentType.DRIVER_LICENSE, confidence: 0.82, signals };
    }
    return { type: IdentityDocumentType.UNKNOWN, confidence: 0.2, signals: ['no-strong-signal'] };
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
