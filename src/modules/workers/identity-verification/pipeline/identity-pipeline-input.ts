import type { IdentityDocumentType } from '../core/domain/identity-enums';
import type { DocumentCaptureSource } from '../document-capture-source';

export interface IdentityPipelineInput {
  readonly documentImage: Buffer;
  readonly documentBackImage?: Buffer | null;
  readonly selfieImage: Buffer;
  readonly documentCountry: string;
  readonly correlationId: string;
  /*
   * Aquí había una `scenarioHint`: el código del escenario, que viajaba hasta
   * los proveedores para que eligieran el desenlace. Ya no existe, y quitarla es
   * parte de que la biometría sea real. Con proveedores que miran las imágenes
   * no la lee nadie, y dejarla puesta habría conservado un canal por el que
   * quien llama podía influir en un veredicto de identidad. Hoy el desenlace de
   * un escenario lo deciden sus IMÁGENES: qué cara lleva el documento y qué cara
   * lleva la selfie.
   */
  /**
   * La entrada la FABRICÓ el motor para un escenario del catálogo.
   *
   * Sólo apaga la prueba de vida, y por una razón que no es de comodidad: una
   * imagen generada no es una captura en vivo, y el antispoof lo sabe. Medido
   * sobre los rostros dibujados de `identity-faces.ts`, puntúa entre 0,44 y 0,67
   * —ni convencido de que sea real ni de que sea un ataque—, que es justo lo que
   * debe responder ante un dibujo. Bajar el listón para que pasaran habría
   * debilitado la defensa contra una foto impresa, que es el ataque que este
   * control existe para parar.
   *
   * Así que en vez de fingir que la superó, se declara que NO SE EJECUTÓ, y el
   * resultado lo dice. El motor de decisión trata `NOT_RUN` como señal ausente,
   * nunca como éxito.
   *
   * No es una puerta trasera: lo pone el servidor a partir de que la ejecución
   * naciera del catálogo, nunca quien sube un archivo, y los escenarios están
   * apagados en producción (`WORKERS_FIXTURES_ENABLED`). La COMPARACIÓN
   * BIOMÉTRICA de un escenario es real y completa; esto sólo afecta a la prueba
   * de vida, que sobre una imagen fabricada no tiene nada que medir.
   */
  readonly entradaGenerada?: boolean;
  /**
   * El tipo de documento que YA decidió un árbitro, si alguien lo decidió.
   *
   * Es lo que cierra el bucle. Un caso derivado a la cola vuelve al worker
   * cuando una persona confirma qué documento es, y sin este dato la puerta
   * volvería a dudar exactamente igual y a devolverlo a la misma cola por el
   * mismo motivo, para siempre. Con él, la puerta no pregunta: la respuesta ya
   * está dada, se anota en las marcas de riesgo —`DOCUMENT_ARBITRATED`, para que
   * el veredicto final diga que hubo una mano humana— y el camino sigue.
   *
   * Lo pone el SERVICIO de fondo leyendo la fila resuelta, nunca quien sube un
   * archivo: es una decisión de un rol autorizado, no un parámetro de entrada.
   */
  readonly arbitratedDocumentType?: IdentityDocumentType | null;
  /**
   * Cómo se tomó la imagen del DOCUMENTO (anverso y reverso), si quien llama lo
   * sabe. Ver `document-capture-source.ts`.
   *
   * Ausente o `camera` es el camino de siempre, sin una sola diferencia. Con
   * `system_scanner` —el escáner de VisionKit o de ML Kit, que ya entrega la
   * tarjeta recortada y con la perspectiva corregida— el caso sale marcado como
   * población no medida, se mide el color del anverso y un `FACE_NO_MATCH` sobre
   * un anverso sin color va a una persona en vez de rechazar. El recorte por
   * densidad corre IGUAL que por la cámara. Es el origen del ANVERSO (la cara que
   * se recorta y se analiza; el reverso solo aporta la MRZ). Lo pone el invocador
   * desde el `context` de la ejecución, no una variable del artefacto.
   */
  readonly documentCaptureSource?: DocumentCaptureSource | null;
  /** Se invoca al terminar cada etapa, con el avance en tanto por ciento. */
  readonly onProgress?: (progress: number) => Promise<void>;
}
