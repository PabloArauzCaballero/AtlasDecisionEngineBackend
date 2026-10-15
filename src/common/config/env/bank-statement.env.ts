import { z } from 'zod';
import { booleanFromString, emptyAsUndefined } from './helpers';

export const bankStatementEnv = {
  BANK_STATEMENT_WORKER_ENABLED: booleanFromString.default(false),
  BANK_STATEMENT_WORKER_POLL_MS: z.coerce.number().int().min(50).max(10_000).default(500),
  BANK_STATEMENT_WORKER_MAX_POLL_MS: z.coerce.number().int().min(500).max(600_000).default(30_000),
  BANK_STATEMENT_RECOVERY_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(600_000)
    .default(30_000),
  // Menor que la del semántico: cada job carga un PDF entero en memoria.
  BANK_STATEMENT_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  BANK_STATEMENT_LEASE_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
  BANK_STATEMENT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  // 10 MiB. Acota a la vez la memoria del worker y el tamaño de la fila, porque
  // el documento se guarda en la propia base (ADR-0026).
  BANK_STATEMENT_MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(52_428_800)
    .default(10_485_760),
  // Un PDF hostil puede hacer trabajar al lector indefinidamente. El presupuesto
  // corta el job, no el proceso.
  BANK_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(60_000),
  /*
   * Techo de una verificación de identidad invocada DESDE UN NODO de decisión.
   *
   * Holgado a propósito: el worker lee el documento, detecta dos rostros y los
   * compara, todo en el mismo proceso. Un tope corto convertiría un teléfono
   * lento en un rechazo. No gobierna la cola —esa tiene su propio lease
   * (`IDENTITY_LEASE_SECONDS`)—, sólo la llamada en línea.
   */
  IDENTITY_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(90_000),
  /*
   * Las TRES fronteras del triage, configurables porque son lo primero que hay
   * que recalibrar con documentos reales y hacerlo no puede exigir recompilar.
   * Están aquí y no en un componente del portal a propósito: una regla de
   * negocio escrita en el frontend no gobierna a quien llama la API sin pasar
   * por él, que es cualquiera con credencial.
   *
   * Las dos primeras miden si el documento ES un extracto: desde ACCEPT se
   * procesa, desde REVIEW se pregunta a una persona, y por debajo se rechaza.
   * `normalizeThresholds` ordena el par, así que un ACCEPT por debajo del
   * REVIEW no abre una franja vacía en silencio.
   */
  BANK_STATEMENT_DOCUMENT_ACCEPT_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.55),
  BANK_STATEMENT_DOCUMENT_REVIEW_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.3),
  /*
   * La tercera mide la EXTRACCIÓN, no la clasificación, y por eso es otra
   * frontera: 0.5 es donde la banda publicada pasa a `NO_CONFIABLE`. Entre 0.5
   * y 0.75 el resultado se entrega con advertencias —hay dato y se dice que
   * mirarlo—; por debajo no hay nada utilizable que entregar y la única salida
   * honesta es una persona.
   */
  BANK_STATEMENT_REVIEW_EXTRACTION_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.5),
  /*
   * La cuarta no es un umbral: es una EXIGENCIA sobre quién emitió el
   * documento. Con `true`, un extracto que no se atribuye a ninguna entidad
   * con licencia de ASFI no se procesa —se rechaza si además no queda ninguna
   * señal financiera en la carátula, o se manda a una persona si queda alguna—.
   *
   * Existe el `false` porque encender una exigencia nueva sobre un motor en
   * marcha rechaza documentos que ayer pasaban, y esa decisión es de quien
   * opera el sistema. En modo de medición la compuerta sigue evaluando y
   * dejando constancia del veredicto real: se puede ver cuánto rechazaría
   * antes de dejar que rechace.
   */
  BANK_STATEMENT_REQUIRE_LICENSED_ISSUER: booleanFromString.default(true),
  /*
   * La compuerta del CONTENEDOR, que hasta ahora no tenía ninguna perilla y era
   * la que más documentos legítimos detenía.
   *
   * Los pesos de `pdf-forensics.ts` NO se tocan desde aquí a propósito —son la
   * medida, y moverla es cambiar lo que la señal significa—; lo que se mueve es
   * dónde se corta. `REJECT_SCORE` por debajo de 70 empieza a rechazar
   * combinaciones de señales débiles; `REVIEW_SCORE` por debajo de 30 llena la
   * cola de ruido de generador. Súbelos para dejar pasar más, con la
   * consecuencia escrita: cada punto que sube el corte es un intento de
   * composición que ya no se detiene.
   *
   * `ENFORCE=false` deja la compuerta midiendo sin bloquear, que es la forma de
   * ver cuánto rechazaría antes de dejarla rechazar.
   */
  BANK_STATEMENT_AUTHENTICITY_ENFORCE: booleanFromString.default(true),
  BANK_STATEMENT_AUTHENTICITY_REJECT_SCORE: z.coerce.number().int().min(1).max(100).default(70),
  BANK_STATEMENT_AUTHENTICITY_REVIEW_SCORE: z.coerce.number().int().min(1).max(100).default(30),
  /*
   * Si la cobertura mínima de meses RECHAZA o sólo advierte.
   *
   * Por omisión advierte, y el porqué está en `affordability-policy.ts`: los
   * meses se cuentan NATURALES y COMPLETOS, así que el extracto que la banca por
   * internet entrega como «últimos 3 meses» aporta dos, y exigir tres rechazaba
   * a quien había hecho exactamente lo que se le pidió. La cobertura sigue
   * midiéndose y viaja como advertencia con el resultado.
   *
   * El mínimo en sí NO es configurable —`normalizeAffordabilityPolicy` lo
   * sostiene en tres— porque es la exigencia que da sentido al módulo. Lo
   * configurable es si bloquea.
   */
  BANK_STATEMENT_ENFORCE_MINIMUM_MONTHS: booleanFromString.default(false),
  /*
   * La compuerta de VIGENCIA: hasta cuándo tiene que llegar el extracto.
   *
   * Se mide el FINAL de la ventana observada contra hoy. La tolerancia existe
   * porque «hasta hoy» no existe en ningún banco: el extracto cierra en el
   * último movimiento, y un fin de semana sin movimientos deja el último apunte
   * tres días atrás sin que el documento tenga nada de malo. Bajarla a 0
   * rechazaría a quien descarga su extracto un lunes por la mañana.
   */
  BANK_STATEMENT_RECENCY_ENFORCE: booleanFromString.default(true),
  BANK_STATEMENT_RECENCY_TOLERANCE_DAYS: z.coerce.number().int().min(0).max(365).default(3),
  BANK_STATEMENT_RECENCY_FUTURE_TOLERANCE_DAYS: z.coerce.number().int().min(0).max(365).default(3),
  /*
   * El PARECIDO con el descriptor de señales de la entidad.
   *
   * `CORROBORATE` —por omisión— deja que un parecido alto sostenga un documento
   * que la compuerta del contenedor dejó en duda; nunca al revés. No existe un
   * modo que rechace por NO parecerse, y la ausencia es deliberada: no
   * parecerse es una ausencia de evidencia con causas inocentes —el banco
   * cambió su maqueta, el descriptor está incompleto— y rechazar por ella
   * castigaría al cliente por lo que no sabemos de su banco.
   *
   * El modo por omisión es seguro aunque suene atrevido: rescatar exige un
   * descriptor `MEASURED` con muestra suficiente, y hoy no hay ninguno. La
   * palanca queda lista y el dato decide cuándo empieza a tener efecto.
   */
  BANK_STATEMENT_SIMILARITY_MODE: z.enum(['OFF', 'MEASURE', 'CORROBORATE']).default('CORROBORATE'),
  BANK_STATEMENT_SIMILARITY_MATCH_SCORE: z.coerce.number().int().min(1).max(100).default(70),
  BANK_STATEMENT_SIMILARITY_PARTIAL_SCORE: z.coerce.number().int().min(0).max(100).default(35),
  /*
   * Muestra mínima para que un descriptor medido pueda corroborar. Tres, por lo
   * mismo que la política de meses pide tres observaciones: con uno o dos
   * documentos no se distingue la plantilla del banco de las manías de un
   * cliente.
   */
  BANK_STATEMENT_SIMILARITY_MIN_SAMPLE: z.coerce.number().int().min(1).max(1_000).default(3),
  /*
   * El consejero de columnas del motor generalista, APAGADO por omisión.
   *
   * Interviene sólo con los extractos de entidades sin analizador propio, y
   * sólo cuando el saldo corriente NO cuadra: su propuesta se acepta
   * únicamente si el saldo pasa a cuadrar entero, así que no puede producir
   * una lectura peor que la que había. Lo que sale de la máquina son los
   * RÓTULOS de la cabecera, nunca filas ni importes.
   *
   * Sin `OPENROUTER_API_KEY` se queda apagado en silencio: el documento se lee
   * como se leía antes de que existiera.
   */
  BANK_STATEMENT_COLUMN_ADVISOR_ENABLED: booleanFromString.default(false),
  BANK_STATEMENT_COLUMN_ADVISOR_MODEL: emptyAsUndefined(z.string().trim().min(1).optional()),
  /*
   * Cuánto puede esperar un documento en la cola antes de derivarse solo.
   * Cubre el caso que el presupuesto de procesamiento no ve: el worker apagado
   * o saturado, donde nadie llega a empezar el trabajo y por tanto ningún reloj
   * de procesamiento corre. Sin esto, «tarda mucho» y «no lo va a tomar nadie»
   * se ven igual desde la pantalla: en cola, para siempre.
   */
  BANK_STATEMENT_QUEUE_WAIT_BUDGET_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(3_600_000)
    .default(180_000),
};
