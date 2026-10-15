import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedPrincipal } from '../../../common/security/security.types';
import type { WorkerServiceOutcome, WorkerServiceRequest } from '../../graph/graph.types';
import { documentCaptureSourceFromContext } from '../identity-verification/document-capture-source';
import { IdentityPipelineService } from '../identity-verification/identity-pipeline.service';
import { IdentityVerificationService } from '../identity-verification/identity-verification.service';
import { validateIdentityUpload } from '../identity-verification/identity-verification-input';
import type { IdentityVerificationOutcome } from '../identity-verification/identity-result';
import {
  assertAvailable,
  decodeBase64,
  stringArgument,
  timeoutFor,
  toDomainException,
  withTimeout,
  type WorkerServiceCall,
  type WorkerServiceHandler,
} from './worker-call';

/**
 * Las marcas que dicen de qué POBLACIÓN salió la imagen del carnet, y que por eso
 * van a la traza del nodo cuando el origen es el escáner del sistema. Ver
 * `handle`.
 */
const MARCAS_DE_LA_CAPTURA: ReadonlySet<string> = new Set([
  'DOCUMENT_CAPTURE_SYSTEM_SCANNER',
  'THRESHOLD_PROFILE_UNMEASURED',
  'DOCUMENT_GRAYSCALE',
]);

/** Aviso en la traza cuando el veredicto de identidad no pudo conservar sus imágenes. */
export const IDENTITY_EVIDENCE_NOT_KEPT = 'IDENTITY_EVIDENCE_NOT_KEPT';

/**
 * Verifica una identidad con el carnet y la selfie que trae la decisión.
 *
 * **Es el núcleo, no la cola.** Igual que los otros tres servicios: la
 * decisión necesita el veredicto en el instante en que lo pide, y encolar
 * serviría justo para lo contrario. La cola sigue siendo el camino de las
 * verificaciones que se piden por HTTP y que nadie está esperando en línea;
 * las dos comparten este pipeline, que no sabe de ninguna de las dos.
 *
 * Qué recibe la decisión: el VEREDICTO y su evidencia, nunca las imágenes.
 * Una intermedia con una cédula dentro acaba en la traza de la ejecución, y la
 * traza se conserva años.
 *
 * Qué NO hace: derivar a una persona. Un nodo de decisión no puede esperar a
 * que alguien mire una foto —la decisión se está tomando ahora, con alguien
 * delante— así que un caso dudoso vuelve como `SUCCEEDED_WITH_WARNINGS` con
 * `decision: REVIEW_REQUIRED`, y es el ALGORITMO quien decide qué hacer con
 * eso: pedir otro documento, aprobar con condiciones o abrir un caso. Es la
 * misma diferencia que el worker de extractos hace entre rechazar y preguntar,
 * llevada al sitio donde la política de negocio es visible y versionada.
 */
@Injectable()
export class IdentityVerificationCallHandler implements WorkerServiceHandler {
  readonly key = 'identity-verification.verify';

  private readonly logger = new Logger(IdentityVerificationCallHandler.name);

  constructor(
    private readonly config: ConfigService,
    private readonly identity: IdentityPipelineService,
    private readonly identityRuns: IdentityVerificationService,
  ) {}

  async handle({
    tenantId,
    principal,
    request,
    started,
    context,
  }: WorkerServiceCall): Promise<WorkerServiceOutcome> {
    assertAvailable(
      'identity-verification',
      this.config.get<boolean>('IDENTITY_VERIFICATION_WORKER_ENABLED') ?? false,
      request.nodeKey,
    );

    // La MISMA validación que aplica la subida por HTTP: tamaño, firma real del
    // contenido y formato. Que las imágenes entren por un nodo en vez de por un
    // formulario no puede relajar lo que se acepta.
    const validated = validateIdentityUpload(
      {
        document: {
          originalname: 'carnet.jpg',
          buffer: decodeBase64(request, 'documentBase64', 'identity-verification.verify'),
        },
        documentBack: stringArgument(request, 'documentBackBase64')
          ? {
              originalname: 'carnet-reverso.jpg',
              buffer: decodeBase64(request, 'documentBackBase64', 'identity-verification.verify'),
            }
          : undefined,
        selfie: {
          originalname: 'selfie.jpg',
          buffer: decodeBase64(request, 'selfieBase64', 'identity-verification.verify'),
        },
      },
      this.config.get<number>('IDENTITY_MAX_UPLOAD_BYTES') ?? 10_485_760,
      undefined,
      'nodo',
    );

    const documentCaptureSource = documentCaptureSourceFromContext(context);
    const documentCountry =
      stringArgument(request, 'documentCountry') ??
      this.config.get<string>('IDENTITY_DEFAULT_DOCUMENT_COUNTRY') ??
      'BO';
    try {
      const outcome = await withTimeout(
        this.identity.run({
          documentImage: validated.document.bytes,
          documentBackImage: validated.documentBack?.bytes ?? null,
          selfieImage: validated.selfie.bytes,
          documentCountry,
          correlationId: request.nodeKey,
          /*
           * De dónde salió la imagen del carnet, si la petición lo dice. Sólo se
           * pasa un valor conocido; `camera`, igual que la ausencia o un valor
           * desconocido, deja al pipeline en su camino de siempre.
           */
          ...(documentCaptureSource ? { documentCaptureSource } : {}),
        }),
        timeoutFor(request, this.config.get<number>('IDENTITY_TIMEOUT_MS') ?? 90_000),
        request,
      );

      const limpio = outcome.decision === 'VERIFIED';
      /*
       * Las marcas de la población de la captura, en la TRAZA del nodo.
       *
       * El artefacto no proyecta `riskFlags` —y cambiarlo exige una versión
       * firmada por dos personas—, así que por `result` no llegan a ninguna
       * parte que se guarde. `warnings` sí: el motor de grafo las copia a la
       * traza de cada paso (`evaluation.worker.warnings`), que se persiste con la
       * ejecución y es lo que abre quien revisa el caso. Sólo con el escáner del
       * sistema, así que por la cámara la traza sale como siempre.
       *
       * El `status` NO cambia por ellas: un VERIFICADO del escáner sigue
       * `SUCCEEDED`, porque `IDENTIDAD_CONFIRMADA` exige ese estado y dejarlo en
       * `SUCCEEDED_WITH_WARNINGS` mandaría a revisión a todo el que escanea.
       */
      const deLaCaptura = outcome.capture
        ? outcome.riskFlags.filter((marca) => MARCAS_DE_LA_CAPTURA.has(marca))
        : [];
      const evidence = await this.keepIdentityEvidence(
        tenantId,
        principal,
        validated,
        outcome,
        documentCountry,
        request,
      );
      return {
        status: limpio ? 'SUCCEEDED' : 'SUCCEEDED_WITH_WARNINGS',
        result: toIdentityResult(outcome),
        warnings: [
          ...new Set([
            ...(limpio ? [] : [outcome.decision, ...outcome.reasonCodes]),
            ...deLaCaptura,
            ...(evidence ? [] : [IDENTITY_EVIDENCE_NOT_KEPT]),
          ]),
        ],
        durationMs: Date.now() - started,
        ...(evidence ? { evidenceRequestId: evidence } : {}),
      };
    } catch (error) {
      throw toDomainException(error, request);
    }
  }

  /**
   * Guarda la cara y el carnet sobre los que el nodo decidió, para que el detalle de la ejecución
   * pueda enseñarlos (`IdentityVerificationService.recordInlineEvidence`).
   *
   * Best-effort a propósito: el veredicto ya está calculado, y tirar la decisión porque el almacén
   * no respondió castigaría al solicitante por una avería ajena. Lo que no puede es pasar en
   * silencio: la traza del paso lleva `IDENTITY_EVIDENCE_NOT_KEPT` y queda en el log.
   */
  private async keepIdentityEvidence(
    tenantId: bigint,
    principal: AuthenticatedPrincipal,
    validated: ReturnType<typeof validateIdentityUpload>,
    outcome: IdentityVerificationOutcome,
    documentCountry: string,
    request: WorkerServiceRequest,
  ): Promise<string | null> {
    try {
      return await this.identityRuns.recordInlineEvidence(
        tenantId,
        principal,
        validated,
        outcome,
        documentCountry,
      );
    } catch (error) {
      this.logger.error(
        `No se pudo conservar la evidencia de identidad del nodo ${request.nodeKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}

/**
 * Lo que la decisión ve de una verificación de identidad.
 *
 * Se proyecta a mano y no se entrega el desenlace entero por una razón de
 * privacidad, no de tamaño: el resultado completo trae los campos leídos del
 * carnet —nombre, fecha de nacimiento, domicilio— y todo lo que un nodo publica
 * puede acabar en una variable intermedia y, desde ahí, en la traza de la
 * ejecución, que se conserva años. Un algoritmo de decisión necesita saber si la
 * persona es quien dice ser, no cómo se llama su madre.
 */
function toIdentityResult(outcome: IdentityVerificationOutcome): Record<string, unknown> {
  return {
    decision: outcome.decision,
    reasonCodes: outcome.reasonCodes,
    documentType: outcome.documentType,
    documentCountry: outcome.documentCountry,
    // Las dos confianzas, que responden a preguntas distintas: si es un
    // documento de identidad, y cuál.
    documentEvidence: outcome.documentEvidence.confidence,
    classificationConfidence: outcome.classification.confidence,
    faceSimilarity: outcome.faceMatch?.similarityScore ?? null,
    faceDecision: outcome.calibratedFaceDecision,
    liveness: outcome.liveness.outcome,
    thresholdProfileVersion: outcome.thresholdProfileVersion,
    documentExpiresAt: outcome.fields.expirationDate?.value ?? null,
    /*
     * La AUTENTICIDAD del documento, en dos escalares.
     *
     * Sube el veredicto y el riesgo, no el desglose entero: el desglose es
     * evidencia para quien revisa el caso —y viaja en `result_json` de la
     * ejecución del worker, que es donde el portal lo lee— mientras que lo que un
     * algoritmo de decisión necesita para enrutar son estos dos números. Publicar
     * el desglose aquí lo metería en variables intermedias y, desde ahí, en una
     * traza que se conserva años.
     *
     * `null` cuando la detección está apagada, y ese `null` es información: el
     * artefacto puede distinguir «se comprobó y salió limpio» de «no se
     * comprobó», que son cosas opuestas y que un `0` fundiría en una.
     */
    fraudVerdict: outcome.fraud?.veredicto ?? null,
    fraudRisk: outcome.fraud?.riesgo ?? null,
    riskFlags: outcome.riskFlags,
    /*
     * Sólo con el escáner del sistema: el origen y la medida del color (una
     * fracción de píxeles, sin nada de la persona). Queda al alcance de una
     * versión del artefacto que quiera leerlo; la de hoy no lo proyecta.
     */
    ...(outcome.capture ? { capture: outcome.capture } : {}),
  };
}
