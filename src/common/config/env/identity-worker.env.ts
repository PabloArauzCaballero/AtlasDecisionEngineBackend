import { z } from 'zod';
import { booleanFromString, emptyAsUndefined } from './helpers';

export const identityWorkerEnv = {
  // --- Worker C: verificación de identidad (ADR-0026) ---------------------
  IDENTITY_VERIFICATION_WORKER_ENABLED: booleanFromString.default(false),
  IDENTITY_WORKER_POLL_MS: z.coerce.number().int().min(50).max(10_000).default(500),
  IDENTITY_WORKER_MAX_POLL_MS: z.coerce.number().int().min(500).max(600_000).default(30_000),
  IDENTITY_RECOVERY_INTERVAL_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
  // Cada job carga tres imágenes en memoria y las remuestrea con `sharp`, que
  // reserva su propio búfer: la misma cota que el worker de extractos.
  IDENTITY_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  IDENTITY_LEASE_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
  IDENTITY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  // Por IMAGEN, no por petición: 10 MiB es lo que pesa una foto de un móvil
  // moderno sin recortar.
  IDENTITY_MAX_UPLOAD_BYTES: z.coerce.number().int().min(1_024).max(52_428_800).default(10_485_760),
  IDENTITY_DEFAULT_DOCUMENT_COUNTRY: z.string().length(2).default('BO'),

  /*
   * La puerta de documentos del worker de identidad.
   *
   * `IDENTITY_ACCEPTED_DOCUMENT_TYPES` es la lista, separada por comas, de lo
   * que este despliegue admite. Por omisión sólo el carnet boliviano: es el
   * único con analizador verificado, y abrir la puerta a un pasaporte sin su
   * analizador no lo verifica mejor, sólo lo acepta peor.
   *
   * Las dos confianzas separan rechazar de preguntar. Se recalibran con
   * documentos reales y son lo primero que hay que mover al abrir el flujo a
   * otro país.
   *
   * `IDENTITY_ARBITRATION_MODE` elige QUIÉN resuelve la franja de duda.
   * `HUMAN` la manda a la bandeja del portal; `AI` la consulta con un modelo
   * por OpenRouter, que sólo puede ESCALAR —nunca aprobar— y necesita
   * `OPENROUTER_API_KEY`. La regla cruzada de más abajo impide arrancar en
   * `AI` sin credencial: un árbitro sin llave no falla, difiere, y una cola
   * que crece por una variable ausente no se distingue de una cola que crece
   * porque llegan casos dudosos.
   *
   * `IDENTITY_ARBITRATION_MODEL` es el identificador físico `proveedor/modelo`
   * de OpenRouter. Ausente, el módulo pone uno barato por omisión: la pregunta
   * es «¿esto ni siquiera parece una cédula?» y está en el camino de una
   * petición que el móvil sondea.
   */
  IDENTITY_ACCEPTED_DOCUMENT_TYPES: z.string().default('BOLIVIA_CI'),
  IDENTITY_DOCUMENT_ACCEPT_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.55),
  IDENTITY_DOCUMENT_REVIEW_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.25),
  IDENTITY_ARBITRATION_MODE: z.enum(['HUMAN', 'AI']).default('HUMAN'),
  IDENTITY_ARBITRATION_MODEL: emptyAsUndefined(z.string().trim().min(1).optional()),
  /*
   * El segundo lector de campos del carnet, APAGADO por omisión.
   *
   * No es una función a medias: encenderlo manda la fotografía del documento a
   * OpenRouter, que enruta a un proveedor físico por su cuenta. El árbitro no
   * lo hace —sólo ve el dictamen de la puerta— y por eso son dos banderas y no
   * una. Sin `OPENROUTER_API_KEY` se queda apagado en silencio, que aquí sí es
   * el comportamiento correcto: ausente, el caso queda igual que si nunca se
   * hubiera pedido la relectura.
   */
  IDENTITY_SECOND_READER_ENABLED: booleanFromString.default(false),
  IDENTITY_SECOND_READER_MODEL: emptyAsUndefined(z.string().trim().min(1).optional()),
  /*
   * Umbrales de la comparación biométrica. **Sin valor por omisión y
   * acoplados**: o se configuran los dos, o el motor de decisión devuelve
   * `REVIEW_REQUIRED` con `THRESHOLD_PROFILE_MISSING`.
   *
   * Es la decisión del paquete original y se conserva tal cual. Un umbral por
   * omisión decidiría sobre la identidad de una persona con una cifra que
   * nadie midió contra un corpus etiquetado, y lo haría en silencio; que haya
   * que declararlos —junto al nombre del perfil del que salieron— convierte
   * esa calibración en algo que alguien firmó.
   */
  IDENTITY_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).optional(),
  IDENTITY_REVIEW_THRESHOLD: z.coerce.number().min(0).max(1).optional(),
  IDENTITY_THRESHOLD_PROFILE_VERSION: z.string().min(1).max(128).default('unconfigured'),
  /**
   * El perfil calibrado de la prueba de VIDA.
   *
   * Mientras diga `unconfigured`, un fallo de vida no rechaza: escala. Ver
   * `IdentityOptions.livenessProfileVersion` para el porqué —los cortes
   * 0,55/0,35 no están medidos contra ninguna población de ataques—.
   */
  IDENTITY_LIVENESS_PROFILE_VERSION: z.string().min(1).max(128).default('unconfigured'),
  IDENTITY_MIN_DOCUMENT_QUALITY: z.coerce.number().min(0).max(1).default(0.5),
  IDENTITY_MIN_SELFIE_QUALITY: z.coerce.number().min(0).max(1).default(0.5),
  IDENTITY_MIN_FACE_AREA_RATIO: z.coerce.number().min(0.002).max(0.8).default(0.012),
  IDENTITY_DOCUMENT_EXPIRY_GRACE_DAYS: z.coerce.number().int().min(0).max(365).default(0),
  IDENTITY_MAX_IMAGE_PIXELS: z.coerce.number().int().positive().max(80_000_000).default(25_000_000),
  IDENTITY_MIN_IMAGE_WIDTH: z.coerce.number().int().min(160).max(10_000).default(480),
  IDENTITY_MIN_IMAGE_HEIGHT: z.coerce.number().int().min(120).max(10_000).default(480),
  IDENTITY_MIN_IMAGE_PIXELS: z.coerce.number().int().min(10_000).max(20_000_000).default(230_400),
  /*
   * El suelo por debajo del cual no se intenta leer, POR EJE.
   *
   * Los tres de arriba sólo emiten el aviso `LOW_RESOLUTION`; éstos son los
   * que rechazan. Van por eje largo y eje corto —y no como `WIDTH`/`HEIGHT`—
   * porque una cédula es apaisada: pedirle el mismo mínimo a lo alto que a lo
   * ancho exige de hecho un ancho mucho mayor del que hace falta. Los valores
   * salen de medir dónde deja de leerse algo, no de una estimación:
   * `scripts/medir-resolucion-identidad.ts`.
   */
  IDENTITY_MIN_READABLE_LONG_EDGE: z.coerce.number().int().min(120).max(4_000).default(240),
  IDENTITY_MIN_READABLE_SHORT_EDGE: z.coerce.number().int().min(80).max(4_000).default(150),
  /*
   * Tope de la imagen que se le da al reconocedor. `0` = sin tope.
   *
   * Es la palanca de VELOCIDAD del worker, y no es gratis: por debajo de cierto
   * tamaño se pierde la MRZ, y con ella el número y las fechas, así que el caso
   * termina en la bandeja humana en vez de verificarse solo. Se mide con
   * `scripts/medir-resolucion-ocr-identidad.ts` mirando los CAMPOS.
   */
  IDENTITY_OCR_MAX_LONG_EDGE: z.coerce.number().int().min(0).max(6_000).default(600),
  /**
   * Lado largo de la RELECTURA del documento, una vez que el catálogo ya
   * reconoció una cédula. Por debajo o igual a `IDENTITY_OCR_MAX_LONG_EDGE`
   * desactiva la relectura y deja la lectura barata como definitiva — que es
   * lo que había antes, y lo que descartaba el número de cédula por un dígito
   * de control mal leído.
   */
  IDENTITY_OCR_FINE_LONG_EDGE: z.coerce.number().int().min(0).max(6_000).default(1_200),
  IDENTITY_FACE_CROP_PADDING_RATIO: z.coerce.number().min(0).max(1).default(0.25),
  IDENTITY_MIN_DOCUMENT_FACE_PX: z.coerce.number().int().min(40).max(2_000).default(80),
  IDENTITY_LIVENESS_ENABLED: booleanFromString.default(true),
  /*
   * Cortes de la prueba de vida, sobre el mínimo de las dos redes.
   *
   * Por encima de PASS se da por superada; por debajo de FAIL se rechaza; en
   * medio queda NO CONCLUYENTE, que el motor de decisión trata como aviso y
   * manda a revisión humana. La franja del medio existe a propósito: una
   * prueba pasiva sobre una imagen fija acierta mucho y no siempre, y forzarla
   * a un sí o un no convertiría cada duda en un rechazo silencioso.
   */
  IDENTITY_LIVENESS_PASS_SCORE: z.coerce.number().min(0).max(1).default(0.55),
  IDENTITY_LIVENESS_FAIL_SCORE: z.coerce.number().min(0).max(1).default(0.35),
  /*
   * Aceptación EXPLÍCITA del riesgo de no tener prueba de vida.
   *
   * Sin ella, una foto impresa del documento junto a una foto impresa de su
   * titular pasa una comparación 1:1. Que apagarla en producción obligue a
   * declarar esto convierte un descuido de configuración en una decisión que
   * alguien firma. Se conserva del paquete original.
   */
  IDENTITY_ACCEPT_NO_LIVENESS_RISK: booleanFromString.default(false),
  IDENTITY_DOCUMENT_CLASSIFICATION_ENABLED: booleanFromString.default(true),
  /*
   * Proveedores. Los tres son REALES y los tres corren en esta máquina.
   *
   * La LECTURA del documento es Tesseract sobre WebAssembly, con los datos del
   * idioma como paquete de npm. La BIOMETRÍA —detección, descriptor de 1024
   * dimensiones para comparar 1:1, antispoof y prueba de vida— es
   * `@vladmandic/human`, que trae sus cinco redes dentro del paquete y también
   * se ejecuta sobre WebAssembly.
   *
   * Ninguno necesita credenciales, ninguno sale a la red y ninguno cobra por
   * verificación. Eso es lo que hace que se pueda desplegar igual aquí y en el
   * servidor: no hay un proveedor externo del que dependa el servicio ni una
   * factura que crezca con el uso.
   *
   * Ya NO hay opción simulada. La había, y era el motivo de que un
   * «VERIFICADO» sólo pudiera afirmar que se había leído un documento válido:
   * el comparador devolvía una cifra fija elegida por el nombre del escenario.
   * Quitarla del enum es lo que impide que vuelva por una variable de entorno.
   */
  IDENTITY_OCR_PROVIDER: z.enum(['tesseract']).default('tesseract'),
  IDENTITY_FACE_PROVIDER: z.enum(['human']).default('human'),
  IDENTITY_LIVENESS_PROVIDER: z.enum(['disabled', 'human']).default('human'),

  /*
   * ── Detección de fraude documental ──────────────────────────────────────
   *
   * La puerta de documentos contesta «¿es un carnet?»; esto contesta la
   * siguiente, que es la que separa el fraude: «¿es un carnet AUTÉNTICO?». Se
   * configura aparte porque se calibra contra otra población —documentos
   * falsificados, no documentos mal fotografiados— y porque un despliegue
   * puede querer la primera sin la segunda mientras monta el servidor de
   * embeddings.
   *
   * `IDENTITY_FRAUD_STRICT` es la variable que hay que entender antes de
   * tocar ninguna otra: en estricto, una prueba que NO se pudo ejecutar
   * —servidor de embeddings caído, `sharp` incapaz de leer la imagen— escala
   * el caso a una persona en vez de dejarlo pasar. Es lo que debe estar puesto
   * en producción, y el refinamiento de más abajo lo exige allí: sin ella una
   * caída de un servicio auxiliar se convierte en una puerta abierta, que es
   * el fallo que un flujo de identidad no puede permitirse.
   */
  IDENTITY_FRAUD_DETECTION_ENABLED: booleanFromString.default(true),
  IDENTITY_FRAUD_STRICT: booleanFromString.default(false),
  /*
   * 0,4 y no 0,55, y el número está medido contra CÉDULAS REALES.
   *
   * El 0,55 salía de los ejemplares sintéticos, que están dibujados con los
   * rótulos del catálogo y por construcción puntúan cerca de 1. Una cédula
   * boliviana auténtica fotografiada con un móvil llega como mucho a 0,66 y
   * normalmente a 0,52, así que aquel corte marcaba `TEMPLATE_COVERAGE_LOW`
   * —plantilla incompleta— en todas. Ver `identity-fraud.scorer.ts`, que lleva
   * la tabla de las cuatro resoluciones.
   *
   * Tiene que coincidir con `UMBRALES_DE_FRAUDE_POR_DEFECTO.coberturaMinima`:
   * el puente lee `config.get(...) ?? IDENTITY_DEFAULTS...`, y como este
   * esquema SIEMPRE entrega su valor por omisión, el de la constante nunca se
   * aplica. Dos números distintos aquí y allí significan que el de la
   * constante es decorativo.
   */
  IDENTITY_FRAUD_TEMPLATE_COVERAGE_MIN: z.coerce.number().min(0).max(1).default(0.4),
  IDENTITY_FRAUD_REVIEW_RISK: z.coerce.number().min(0).max(1).default(0.3),
  IDENTITY_FRAUD_SUSPICION_RISK: z.coerce.number().min(0).max(1).default(0.6),
  /*
   * Los dos umbrales del codificador son propiedad del MODELO servido, no del
   * dominio: al cambiar de `multilingual-e5-small` a un BGE hay que volver a
   * medirlos en vez de heredarlos. La medición está documentada en
   * `UmbralesSemanticos` (core/forensics/identity-semantic.classifier.ts).
   */
  IDENTITY_FRAUD_SEMANTIC_FLOOR: z.coerce.number().min(0).max(1).default(0.8),
  IDENTITY_FRAUD_SEMANTIC_MARGIN: z.coerce.number().min(0).max(1).default(0.015),
};
