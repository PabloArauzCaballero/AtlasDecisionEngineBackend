import { Inject, Injectable } from '@nestjs/common';
import { IdentityDecisionEngine } from './core/domain/identity-decision.engine';
import {
  IDENTITY_FACE_MATCH_PORT,
  IDENTITY_LIVENESS_PORT,
  IDENTITY_OPTIONS,
  type IdentityOptions,
} from './core/identity-options';
import { analizarVidaDeLaSelfie } from './core/forensics/selfie-liveness';
import { identityErrors } from './core/domain/identity-domain.error';
import type {
  FaceMatchPort,
  FaceMatchResult,
  LivenessPort,
  LivenessResult,
} from './core/ports/identity.ports';
import type { IdentityVerificationOutcome } from './identity-result';
import { DocumentAuthenticityService } from './pipeline/document-authenticity.service';
import { DocumentFieldsService } from './pipeline/document-fields.service';
import { DocumentGateService } from './pipeline/document-gate.service';
import { DocumentIntakeService } from './pipeline/document-intake.service';
import { FaceCaptureService } from './pipeline/face-capture.service';
import { assembleOutcome } from './pipeline/identity-outcome-assembler';
import type { IdentityPipelineInput } from './pipeline/identity-pipeline-input';
import { reachVerdict, thresholdAndCaptureFlags } from './pipeline/identity-verdict';

/**
 * Ejecuta la verificación completa en una sola pasada.
 *
 * El paquete original repartía estas etapas entre cuatro trabajos de pg-boss
 * encadenados (`document.process` → `selfie.process` → `liveness.process` →
 * `face-match.process`) porque su protocolo de captura es de varios pasos: la
 * persona fotografía el documento desde el móvil y la selfie llega minutos
 * después. Aquí las dos imágenes llegan JUNTAS en una sola petición, así que
 * encadenar cuatro trabajos sólo añadiría tres viajes a la base y tres estados
 * intermedios que nadie puede observar. Lo que se conserva íntegro es el ORDEN
 * y el contenido de cada etapa, y el motor de decisión que las cierra.
 *
 * Nada de esto se persiste aquí: el servicio de fondo es quien escribe la fila.
 * Esta clase es pura salvo por las llamadas a los proveedores.
 */
@Injectable()
export class IdentityPipelineService {
  private readonly decisionEngine = new IdentityDecisionEngine();

  constructor(
    @Inject(IDENTITY_OPTIONS) private readonly options: IdentityOptions,
    private readonly documents: DocumentIntakeService,
    private readonly gate: DocumentGateService,
    private readonly documentFields: DocumentFieldsService,
    private readonly authenticity: DocumentAuthenticityService,
    private readonly faces: FaceCaptureService,
    @Inject(IDENTITY_LIVENESS_PORT) private readonly liveness: LivenessPort,
    @Inject(IDENTITY_FACE_MATCH_PORT) private readonly faceMatch: FaceMatchPort,
  ) {}

  async run(input: IdentityPipelineInput): Promise<IdentityVerificationOutcome> {
    const country = (input.documentCountry || this.options.defaultDocumentCountry).toUpperCase();
    const riskFlags: string[] = [];

    // --- 1 a 3. Documento: normalizar, medir, encuadrar y leer -------------
    const read = await this.documents.intake(input, country);
    const { document, documentQuality, lectura } = read;
    const { ocr, front, back, classification } = lectura;

    // --- Puerta: ¿es un documento de identidad, y de qué tipo? -------------
    const admitted = await this.gate.admit(input, read);
    riskFlags.push(...admitted.riskFlags);

    // --- Campos: analizador del tipo resuelto y segundo lector -------------
    const extracted = await this.documentFields.extract(
      input,
      read,
      admitted.tipoResuelto,
      country,
    );
    riskFlags.push(...extracted.riskFlags);
    const fields = extracted.fields;

    /*
     * --- 3.bis. ¿Es un carnet AUTÉNTICO? ------------------------------------
     *
     * La puerta de arriba contestó «¿es un carnet?». Ésta contesta la siguiente,
     * y es la que separa el fraude: el texto de una falsificación es el de un
     * documento auténtico —porque se copió de uno—, así que la puerta de
     * evidencia la aprueba con holgura. Lo que una falsificación NO puede
     * imitar a la vez es la plantilla completa del SEGIP, la aritmética interna
     * de sus propios datos y la física de la imagen.
     *
     * Va AQUÍ, después del analizador y antes de la biometría, por dos razones.
     * Necesita los campos ya extraídos —sin ellos no hay aritmética que
     * comprobar— y la biometría es la etapa cara: si el documento no es
     * auténtico, comparar su retrato con la selfie sólo respondería a la
     * pregunta equivocada con precisión.
     *
     * Las tres pruebas corren EN PARALELO: son independientes, dos de ellas
     * salen de la red o del procesador de imagen, y encadenarlas sumaría sus
     * latencias en el camino caliente de cada verificación.
     */
    const fraude = await this.authenticity.analizarFraude({
      textoAnverso: front.rawText,
      textoReverso: back?.rawText ?? '',
      campos: fields,
      rawText: ocr.rawText,
      documento: document.buffer,
      entradaGenerada: input.entradaGenerada === true,
      ladoLargoPx: Math.max(document.quality.width, document.quality.height),
    });
    if (fraude) {
      riskFlags.push(...fraude.motivos);
      if (fraude.veredicto === 'FRAUD_SUSPECTED') riskFlags.push('FRAUD_SUSPECTED');
      if (fraude.veredicto === 'REVIEW') riskFlags.push('DOCUMENT_AUTHENTICITY_DOUBTFUL');
    }

    await input.onProgress?.(40);

    // --- 4. Rostro del documento -------------------------------------------
    const documentFace = await this.faces.detectDocumentFace(input, document);
    if (documentFace.variosRostros) {
      // Más de un rostro en un documento es señal de composición, no un fallo de
      // captura: se anota y se sigue, para que la decisión la tome una persona.
      riskFlags.push('MULTIPLE_FACES');
    }
    await input.onProgress?.(55);

    // --- 5. Selfie: normalizar, enderezar, detectar y medir ----------------
    const {
      selfie,
      selfieFaces,
      selfieQuality,
      riskFlags: selfieFlags,
    } = await this.faces.captureSelfie(input);
    riskFlags.push(...selfieFlags);
    await input.onProgress?.(70);

    /*
     * --- 6. Prueba de vida, y las comprobaciones que el antispoof no hace ----
     *
     * Aquí había UNA sola pregunta —«¿es esto un rostro delante de la cámara?»—
     * y dejaba abierto el ataque más barato del flujo: subir como selfie la
     * misma foto del carnet. Contra la comparación biométrica ese ataque no
     * fallaba, ganaba: dos recortes del mismo retrato son el parecido perfecto,
     * o sea la puntuación más alta que este worker puede dar. Y el antispoof no
     * lo tapa, porque el retrato de un carnet ES una fotografía de estudio de
     * una cara, no una pantalla.
     *
     * `selfie-liveness.ts` añade lo que faltaba. Se ejecuta ANTES de comparar
     * —comparar dos veces la misma imagen sólo gastaría el descriptor— salvo la
     * parte que necesita el parecido, que se resuelve después con lo ya medido.
     */
    const liveness: LivenessResult = input.entradaGenerada
      ? { outcome: 'NOT_RUN', provider: 'entrada-generada' }
      : await this.liveness.verify({
          selfie: selfie.buffer,
          correlationId: input.correlationId,
        });
    // Que la ejecución LLEVE la marca, y no sólo el proveedor: es lo que impide
    // leer un «VERIFICADO» de escenario como uno de una persona ante la cámara.
    if (input.entradaGenerada) riskFlags.push('GENERATED_INPUT_NO_LIVENESS');
    await input.onProgress?.(80);

    // --- 7. Comparación biométrica -----------------------------------------
    // Si la prueba de vida falló no se compara: el desenlace ya está decidido y
    // comparar sólo gastaría una llamada al proveedor. Es lo que hacía el
    // paquete original.
    /*
     * Las DOS caras se recortan igual antes de compararse.
     *
     * Antes no: el documento entraba recortado al rostro y remuestreado, y la
     * selfie entraba ENTERA. Es una asimetría que el descriptor sí ve, y lo que
     * cuesta está medido sobre el retrato de una cédula real comparado consigo
     * mismo por los dos caminos: **0,9157**. No es la diferencia entre dos
     * personas —es literalmente el mismo rostro— y el umbral de aprobación del
     * perfil de laboratorio está en 0,8824. O sea que el preprocesado se comía
     * casi todo el margen antes de que la comparación empezara.
     *
     * Y lo peor no es la media sino la INESTABILIDAD. Midiendo el mismo rostro
     * contra escenas donde ocupa distinta parte del encuadre:
     *
     *   rostro en el encuadre   selfie entera (antes)   recortada (ahora)
     *   100 %                   0,9893                  0,9652
     *    50 %                   0,9855                  0,9693
     *    25 %                   0,9759                  0,9583
     *    12 %                   0,9617                  0,9818
     *     6 %                   0,5694                  0,9322
     *
     * Con la selfie entera, el parecido de una MISMA persona depende de lo lejos
     * que sostuviera el teléfono, y a brazo extendido se desploma por debajo de
     * cualquier umbral. Recortando las dos, el peor caso de todo el barrido es
     * 0,9322. Un umbral sólo significa algo si la cifra que corta no depende del
     * encuadre.
     *
     * Si el recorte de la selfie falla —un rostro diminuto que no llega al
     * mínimo de `crop`— se compara con la imagen entera, que es lo que había:
     * un recorte imposible no puede convertir una comparación en un fallo duro.
     */
    const selfieFace = await this.faces.recortarRostro(selfie.buffer, selfieFaces.faces[0].box);

    const match: FaceMatchResult | null =
      liveness.outcome === 'FAILED'
        ? null
        : await this.faceMatch.compare({
            documentFace: documentFace.face,
            selfieFace,
            correlationId: input.correlationId,
          });

    /*
     * Las comprobaciones de vida que miran las DOS imágenes juntas.
     *
     * Van después de comparar porque una de ellas necesita el parecido: el que
     * es DEMASIADO alto, que no significa «es clarísimamente la misma persona»
     * sino «no hay dos fotos». Un par legítimo documento↔selfie mide entre 0,66
     * y 0,92 en este repositorio —el retrato va tras el plastificado, lavado y
     * con velo— así que el techo natural queda muy lejos del 0,97 que exige esta
     * señal.
     *
     * Que la selfie SEA el documento corta aquí y no se anota: no tiene lectura
     * inocente y seguir sólo produciría un veredicto sobre una comparación que
     * no compara nada.
     */
    const vida = await analizarVidaDeLaSelfie({
      selfie: selfie.buffer,
      documento: document.buffer,
      parecido: match && match.comparable ? match.similarityScore : null,
      entradaGenerada: input.entradaGenerada === true,
    });
    if (vida.selfieEsElDocumento) throw identityErrors.selfieIsDocument();
    riskFlags.push(...vida.senales);

    await input.onProgress?.(90);
    const capture = thresholdAndCaptureFlags(this.options, input, read.colorDelAnverso);
    riskFlags.push(...capture.riskFlags);

    // --- 8. Decisión --------------------------------------------------------
    const decision = reachVerdict(this.decisionEngine, this.options, {
      documentQualityScore: documentQuality.score,
      selfieQualityScore: selfieQuality.score,
      fields,
      liveness,
      match,
      riskFlags,
      fraude,
      poblacionSinMedir: capture.poblacionSinMedir,
      colorDelAnverso: read.colorDelAnverso,
    });

    return assembleOutcome({
      options: this.options,
      decision,
      tipoResuelto: admitted.tipoResuelto,
      country,
      classification,
      evidencia: admitted.evidencia,
      fields,
      documentQuality,
      selfieQuality,
      liveness,
      match,
      riskFlags,
      fraude,
      encuadre: read.encuadre,
      escaneado: read.escaneado,
      colorDelAnverso: read.colorDelAnverso,
      ocr,
      front,
      back,
      documentFaceProvider: documentFace.provider,
    });
  }
}
