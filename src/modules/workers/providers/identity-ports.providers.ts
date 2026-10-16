import { ConfigService } from '@nestjs/config';
import {
  DisabledLivenessAdapter,
  HeuristicDocumentClassifierAdapter,
} from '../identity-verification/core/adapters/local-providers.adapter';
import {
  HumanFaceDetectorAdapter,
  HumanFaceMatchAdapter,
  HumanLivenessAdapter,
} from '../identity-verification/core/adapters/human-face.adapter';
import { TesseractOcrAdapter } from '../identity-verification/core/adapters/tesseract-ocr.adapter';
import { SharpImageAdapter } from '../identity-verification/core/adapters/sharp-image.adapter';
import {
  HumanIdentityArbitrationAdapter,
  OpenRouterIdentityArbitrationAdapter,
} from '../identity-verification/core/adapters/identity-arbitration.adapter';
import {
  IDENTITY_ARBITRATION_PORT,
  IDENTITY_SECOND_READER_PORT,
  IDENTITY_CLASSIFIER_PORT,
  IDENTITY_EMBEDDER_PORT,
  IDENTITY_FACE_DETECTOR_PORT,
  IDENTITY_FACE_MATCH_PORT,
  IDENTITY_LIVENESS_PORT,
  IDENTITY_NORMALIZER_PORT,
  IDENTITY_OCR_PORT,
  IDENTITY_OPTIONS,
  type IdentityOptions,
} from '../identity-verification/core/identity-options';
import { numeroDeConfig } from '../../../common/config/config-coercion.util';
import { TransformerIdentityEmbedderAdapter } from '../identity-verification/core/adapters/transformer-identity.adapter';
import { buildIdentityOptions } from '../identity-verification/identity-config.bridge';
import { OpenRouterChatClient } from '../../../common/llm/openrouter-chat.client';
import { OpenRouterSecondReaderAdapter } from '../identity-verification/core/adapters/openrouter-second-reader.adapter';

/**
 * Workers adicionales (ADR-0026): análisis semántico, extractos bancarios,
 * verificación de identidad y locución.
 *
 * Un módulo con **cuatro workers independientes dentro**. Comparten el catálogo
 * (`/v1/workers`) y la forma de sus ejecuciones, y nada más: cada uno tiene su
 * tabla, su trabajo de fondo, su processor, su configuración y sus pruebas.
 * Fundirlos en un processor común para ahorrar archivos habría acoplado un
 * fallo del lector de PDF con la cuota de un proveedor de modelos.
 *
 * El grueso de este archivo es el cableado de los puertos del worker semántico,
 * y ese es justamente el trabajo que su arquitectura hexagonal permitía hacer
 * **sin tocar su núcleo**: donde el paquete traía pg-boss, Sequelize y un
 * registro de Prometheus propios, ahora hay adaptadores contra la cola, el ORM
 * y el recolector que el motor ya tenía.
 *
 * No declara `imports`: los dos trabajos se registran solos en
 * `JobSchedulerService`, que es global, y la persistencia va por `PrismaService`.
 * Los servicios de fondo consultan `WORKER_ROLE` en su propio `onModuleInit`,
 * así que cargar este módulo en una réplica de API no arranca ningún worker.
 */
/**
 * El modelo por omisión del árbitro de identidad.
 *
 * Se elige barato y rápido a propósito: la pregunta que contesta es «¿esto ni
 * siquiera parece una cédula?», que no necesita un modelo de razonamiento, y
 * está en el camino de una petición que el móvil está sondeando.
 */
const DEFAULT_ARBITRATION_MODEL = 'openai/gpt-4.1-mini';

/**
 * El modelo por omisión del segundo lector.
 *
 * Aquí sí hace falta uno multimodal y bueno leyendo texto pequeño sobre fondo
 * impreso: la pregunta es «¿qué dice exactamente este renglón?», que es donde un
 * modelo flojo inventa un dígito con la misma seguridad con la que acierta.
 */
const DEFAULT_SECOND_READER_MODEL = 'google/gemini-2.5-flash';

/**
 * Añade una clave sólo si tiene valor.
 *
 * `exactOptionalPropertyTypes` distingue «ausente» de «presente y undefined», y
 * el cliente aplica su propio valor por omisión sólo ante la primera. Pasar
 * `{ baseUrl: undefined }` lo dejaría sin base.
 */
function maybe<K extends string, V>(
  key: K,
  value: V | undefined,
): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

export const IDENTITY_PORT_PROVIDERS = [
  {
    provide: IDENTITY_OPTIONS,
    useFactory: buildIdentityOptions,
    inject: [ConfigService],
  },
  /*
   * `sharp` sirve a la vez de normalizador y de recortador: el puerto
   * `FaceCropPort` es una interfaz aparte —para que un despliegue pueda
   * recortar con otra cosa— pero la MISMA instancia los cumple los dos, y
   * registrarla dos veces crearía dos procesos de imagen distintos donde el
   * pipeline espera uno.
   */
  SharpImageAdapter,
  { provide: IDENTITY_NORMALIZER_PORT, useExisting: SharpImageAdapter },
  /*
   * La lectura del documento es REAL, también en desarrollo: es lo único que
   * permite distinguir una cédula de una foto cualquiera. Corre en local
   * sobre WebAssembly y no abre ninguna conexión de red.
   */
  TesseractOcrAdapter,
  { provide: IDENTITY_OCR_PORT, useExisting: TesseractOcrAdapter },
  { provide: IDENTITY_CLASSIFIER_PORT, useClass: HeuristicDocumentClassifierAdapter },
  /*
   * La BIOMETRÍA también es real, y por el mismo motivo que la lectura.
   *
   * Detección, descriptor de 1024 dimensiones para comparar 1:1, antispoof y
   * prueba de vida salen de `@vladmandic/human`, que trae sus cinco redes
   * dentro del paquete y corre sobre WebAssembly en este mismo proceso: sin
   * credenciales, sin salir a la red y sin coste por verificación. Lo que
   * había aquí devolvía un parecido fijo elegido por el nombre del escenario,
   * de modo que un «VERIFICADO» sólo podía afirmar que se había leído un
   * documento válido —nunca que las dos caras fueran de la misma persona—.
   */
  { provide: IDENTITY_FACE_DETECTOR_PORT, useClass: HumanFaceDetectorAdapter },
  { provide: IDENTITY_FACE_MATCH_PORT, useClass: HumanFaceMatchAdapter },
  /*
   * La prueba de vida se puede apagar, y apagarla tiene consecuencias: sin
   * ella, una foto impresa del documento junto a una foto impresa de su
   * titular pasa una comparación 1:1. Por eso el esquema de entorno obliga a
   * declarar esa aceptación de riesgo por escrito para apagarla en producción.
   * El adaptador deshabilitado devuelve `NOT_RUN`, que el motor de decisión
   * trata como señal ausente y no como éxito.
   */
  {
    provide: IDENTITY_LIVENESS_PORT,
    useFactory: (config: ConfigService, options: IdentityOptions) =>
      (config.get<boolean>('IDENTITY_LIVENESS_ENABLED') ?? true)
        ? new HumanLivenessAdapter(options)
        : new DisabledLivenessAdapter(),
    inject: [ConfigService, IDENTITY_OPTIONS],
  },
  /*
   * Quién arbitra la franja de duda de la puerta de documentos.
   *
   * El puerto tiene dos implementaciones y la elige el ENTORNO, no el código:
   * es lo que hace que enchufar un modelo de arbitraje sea cambiar una
   * variable. Hoy la humana está puesta por omisión porque es la única con un
   * destinatario real —la pestaña del portal—; la de IA está declarada, falla
   * hacia la cola humana y lo dice en su `health()`, de modo que un despliegue
   * que la seleccione sin modelo detrás se ve en el estado del worker y no
   * como una cola que crece sin explicación.
   */
  {
    provide: IDENTITY_ARBITRATION_PORT,
    useFactory: (config: ConfigService, options: IdentityOptions) => {
      if (options.arbitrationMode !== 'AI') return new HumanIdentityArbitrationAdapter();
      /*
       * Sin clave no se llega aquí: `env.schema.ts` se niega a arrancar con
       * `IDENTITY_ARBITRATION_MODE=AI` y `OPENROUTER_API_KEY` ausente. El
       * `?? ''` está para que el tipo cierre, y el cliente vuelve a
       * comprobarlo por si alguien construye el módulo sin pasar por el
       * esquema (las pruebas lo hacen).
       */
      return new OpenRouterIdentityArbitrationAdapter(
        new OpenRouterChatClient({
          apiKey: config.get<string>('OPENROUTER_API_KEY') ?? '',
          model: config.get<string>('IDENTITY_ARBITRATION_MODEL') ?? DEFAULT_ARBITRATION_MODEL,
          ...maybe('baseUrl', config.get<string>('OPENROUTER_BASE_URL')),
          ...maybe('appUrl', config.get<string>('OPENROUTER_APP_URL')),
          ...maybe('appTitle', config.get<string>('OPENROUTER_APP_TITLE')),
          ...maybe('timeoutMs', config.get<number>('OPENROUTER_TIMEOUT_MS')),
          ...maybe('maxAttempts', config.get<number>('OPENROUTER_MAX_ATTEMPTS')),
        }),
      );
    },
    inject: [ConfigService, IDENTITY_OPTIONS],
  },
  /*
   * El segundo lector de campos del carnet.
   *
   * `null` por omisión, y esa omisión es una decisión de datos, no una función
   * a medias: a diferencia del árbitro —que sólo ve el DICTAMEN de la puerta,
   * sin imagen ni datos del titular— este adaptador manda la fotografía del
   * documento a un enrutador que elige proveedor físico por su cuenta. Se
   * enciende a mano, con `IDENTITY_SECOND_READER_ENABLED`, después de decidir
   * eso; nunca de rebote al encender el arbitraje.
   *
   * Sin credencial se queda apagado en vez de romper el arranque, al revés que
   * el árbitro. La diferencia está en el modo de fallo: un árbitro sin llave
   * DIFIERE todos los casos y su avería se confunde con trabajo real; un
   * segundo lector ausente deja el caso exactamente donde estaba sin él.
   */
  {
    provide: IDENTITY_SECOND_READER_PORT,
    useFactory: (config: ConfigService) => {
      if (config.get<boolean>('IDENTITY_SECOND_READER_ENABLED') !== true) return null;
      const apiKey = config.get<string>('OPENROUTER_API_KEY') ?? '';
      if (apiKey === '') return null;
      return new OpenRouterSecondReaderAdapter(
        new OpenRouterChatClient({
          apiKey,
          model: config.get<string>('IDENTITY_SECOND_READER_MODEL') ?? DEFAULT_SECOND_READER_MODEL,
          ...maybe('baseUrl', config.get<string>('OPENROUTER_BASE_URL')),
          ...maybe('appUrl', config.get<string>('OPENROUTER_APP_URL')),
          ...maybe('appTitle', config.get<string>('OPENROUTER_APP_TITLE')),
          ...maybe('timeoutMs', config.get<number>('OPENROUTER_TIMEOUT_MS')),
        }),
      );
    },
    inject: [ConfigService],
  },
  /*
   * El codificador que sostiene la detección de fraude documental.
   *
   * Se registra como `null` cuando la detección está apagada, y ese `null` es
   * parte del diseño: el clasificador lo trata como PRUEBA AUSENTE —no como
   * prueba superada— y en modo estricto eso escala el caso a una persona. Lo
   * que no puede pasar es que un despliegue sin servidor de embeddings
   * apruebe identidades como si las hubiera comprobado.
   *
   * La conexión NO se verifica aquí. Levantar el módulo depende de que el
   * servidor de embeddings esté arriba sería atar el arranque del motor entero
   * a un servicio auxiliar; el fallo se descubre en la primera verificación,
   * se registra como prueba ausente y se ve en el resultado.
   */
  {
    provide: IDENTITY_EMBEDDER_PORT,
    useFactory: (config: ConfigService, options: IdentityOptions) => {
      if (!options.fraudDetectionEnabled) return null;
      return new TransformerIdentityEmbedderAdapter({
        baseUrl: config.get<string>('TRANSFORMER_BASE_URL') ?? 'http://127.0.0.1:8080',
        ...(config.get<string>('TRANSFORMER_API_KEY')
          ? { apiKey: config.get<string>('TRANSFORMER_API_KEY') as string }
          : {}),
        model: config.get<string>('SEMANTIC_TRANSFORMER_MODEL') ?? 'intfloat/multilingual-e5-small',
        /*
         * Con `numeroDeConfig` y no con `config.get<number>`, que es un cast y no una
         * conversión. Estas tres variables NO están en el esquema de entorno, así que llegan
         * crudas: `SEMANTIC_TRANSFORMER_TIMEOUT_MS=15000` entraba como la cadena `'15000'` y
         * `AbortSignal.timeout('15000')` lanza un `TypeError`. Medido sobre una cédula real: la
         * prueba semántica se registraba como ausente con el mensaje del TypeError por motivo,
         * de modo que un defecto de tipos se leía como «no había codificador».
         */
        timeoutMs: numeroDeConfig(config, 'SEMANTIC_TRANSFORMER_TIMEOUT_MS', 15_000),
        maxAttempts: numeroDeConfig(config, 'SEMANTIC_TRANSFORMER_MAX_ATTEMPTS', 3),
        retryBackoffMs: numeroDeConfig(config, 'SEMANTIC_TRANSFORMER_RETRY_BACKOFF_MS', 250),
        queryPrefix: config.get<string>('SEMANTIC_TRANSFORMER_QUERY_PREFIX') ?? 'query: ',
        passagePrefix: config.get<string>('SEMANTIC_TRANSFORMER_PASSAGE_PREFIX') ?? 'passage: ',
      });
    },
    inject: [ConfigService, IDENTITY_OPTIONS],
  },
];
