import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IDENTITY_DEFAULTS } from './core/identity-options';
import { IDENTITY_PIPELINE_VERSION } from './identity-pipeline-version';

/** Las reglas con las que se acepta y se decide hoy una verificación de identidad. */
@Injectable()
export class IdentityDecisionPolicy {
  constructor(private readonly config: ConfigService) {}

  /** Máximo aceptado por imagen, en bytes. Lo publica el catálogo. */
  maxUploadBytes(): number {
    return this.config.get<number>('IDENTITY_MAX_UPLOAD_BYTES') ?? IDENTITY_DEFAULTS.maxUploadBytes;
  }

  /**
   * Las REGLAS con las que se decidiría hoy, condensadas en una cadena.
   *
   * Entra en la huella de idempotencia, y no es un adorno. La deduplicación se
   * apoyaba sólo en las imágenes, y un veredicto no es función de las imágenes:
   * es función de las imágenes Y de la calibración con la que se miran. Con la
   * clave anterior, reenviar las mismas fotos después de recalibrar devolvía el
   * veredicto viejo — se vio en una captura de este mismo trabajo, con la
   * pantalla enseñando un resultado calculado por una versión anterior del motor
   * y sin ninguna señal de que lo fuera.
   *
   * Incluye el perfil, los dos umbrales, los proveedores y si la prueba de vida
   * está encendida: cambiar cualquiera de esos cambia el veredicto posible, así
   * que cambia también la huella y la verificación se vuelve a calcular.
   *
   * Y la VERSIÓN DEL CANAL DE LECTURA (`IDENTITY_PIPELINE_VERSION`), que faltaba
   * y costó caro: un veredicto es función de tres cosas —imágenes, calibración
   * y el código que las lee—, no de dos. Al arreglar el lector de la MRZ, la
   * huella no se movía, así que reenviar las mismas fotos devolvía el veredicto
   * guardado con el lector viejo: desde la pantalla, indistinguible de un
   * arreglo que no sirvió.
   *
   * Lo que NO incluye es la versión de la aplicación ni el commit: un despliegue
   * que no toca ni la calibración ni el canal no debe invalidar el historial de
   * idempotencia y hacer que todo el mundo reprocese —y pague— por un cambio en
   * otro worker.
   */
  decisionRulesFingerprint(): string {
    const get = <T>(key: string, fallback: T): T => this.config.get<T>(key) ?? fallback;
    const livenessEnabled = get('IDENTITY_LIVENESS_ENABLED', IDENTITY_DEFAULTS.livenessEnabled);
    return [
      `canal-v${String(IDENTITY_PIPELINE_VERSION)}`,
      get('IDENTITY_THRESHOLD_PROFILE_VERSION', IDENTITY_DEFAULTS.thresholdProfileVersion),
      String(this.config.get<number>('IDENTITY_MATCH_THRESHOLD') ?? 'sin-umbral'),
      String(this.config.get<number>('IDENTITY_REVIEW_THRESHOLD') ?? 'sin-umbral'),
      get('IDENTITY_OCR_PROVIDER', IDENTITY_DEFAULTS.ocrProvider),
      get('IDENTITY_FACE_PROVIDER', IDENTITY_DEFAULTS.faceProvider),
      livenessEnabled
        ? get('IDENTITY_LIVENESS_PROVIDER', IDENTITY_DEFAULTS.livenessProvider)
        : 'disabled',
    ].join('|');
  }

  /** País de emisión asumido cuando quien llama no declara otro. */
  defaultDocumentCountry(): string {
    return (
      this.config.get<string>('IDENTITY_DEFAULT_DOCUMENT_COUNTRY') ??
      IDENTITY_DEFAULTS.defaultDocumentCountry
    );
  }
}
