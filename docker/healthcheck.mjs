/**
 * Sonda de vida para el HEALTHCHECK de Docker, compartida por la API y el worker.
 *
 * Por qué un fichero y no un `node -e` en línea: la sonda es la misma para los dos procesos
 * —solo cambia el puerto— y tenerla escrita dos veces dentro del Dockerfile ya había
 * producido dos cadenas que se editan por separado.
 *
 * Por qué `node:http` y NO `fetch`: `fetch` inicializa undici la primera vez que se invoca,
 * y ese arranque cuesta caro en un contenedor con la CPU acotada. Medido dentro del
 * contenedor de la API (5 repeticiones, cgroup de 2 CPUs):
 *
 *     arranque de node (noop)   min=73ms    mediana=328ms   max=901ms
 *     sonda con fetch()         min=2532ms  mediana=3398ms  max=11970ms
 *     sonda con node:http       min=435ms   mediana=844ms   max=1461ms
 *
 * Con el `--timeout=3s` que tenía el HEALTHCHECK, la variante con `fetch` superaba el plazo
 * ya en la MEDIANA: Docker mataba la sonda, la contaba como fallo y marcaba `unhealthy` un
 * contenedor que respondía 200. El efecto no era cosmético — `depends_on: service_healthy`
 * no se satisfacía nunca y cualquier orquestador que actúe sobre el estado (Swarm, Coolify,
 * un liveness de Kubernetes) reinicia en bucle un proceso sano.
 *
 * Se usan solo módulos del núcleo: la imagen de runtime no debe necesitar `curl` ni `wget`
 * para sondearse, y añadirlos ampliaría la superficie del contenedor.
 */
import { get } from 'node:http';

// El orden refleja CÓMO elige su puerto cada proceso, y no es intercambiable:
//
//   HEALTHCHECK_PORT   escape explícito, por si alguna vez hay que sondear otro puerto
//   WORKER_HEALTH_PORT lo que `worker.ts` abre de verdad, y lo que el orquestador puede
//                      sobrescribir por servicio
//   PORT               lo que `main.ts` abre en el proceso de API
//
// `WORKER_HEALTH_PORT` va ANTES que `PORT` porque el worker no define `PORT`, y por delante
// de cualquier valor fijado en la imagen: si el despliegue mueve el puerto de sondas del
// worker, la sonda tiene que seguirlo. Fijarlo en la imagen y no leer esta variable era un
// fallo latente — habría dado por muerto a un worker perfectamente sano.
const port = Number(
  process.env.HEALTHCHECK_PORT ??
    process.env.WORKER_HEALTH_PORT ??
    process.env.PORT ??
    3000,
);

// Cota propia, por debajo del `--timeout` del HEALTHCHECK: si el servidor acepta la conexión
// pero no contesta, `node:http` esperaría indefinidamente y sería Docker quien matara el
// proceso. Fallar aquí deja un código de salida propio en vez de una sonda degollada.
const timeoutMs = Number(process.env.HEALTHCHECK_TIMEOUT_MS ?? 4000);

const request = get(
  { host: '127.0.0.1', port, path: '/health/live', timeout: timeoutMs },
  (response) => {
    // El cuerpo se descarta a propósito: `/health/live` responde si el proceso está vivo y
    // atiende el bucle de eventos. Comprobar dependencias aquí convertiría la caída de
    // Postgres en un reinicio del contenedor de la API, que es justo lo que no ayuda —
    // para eso está `/health/ready`, que el orquestador consulta para sacar de rotación.
    response.resume();
    process.exit(response.statusCode === 200 ? 0 : 1);
  },
);

request.on('timeout', () => {
  request.destroy();
  process.exit(1);
});
request.on('error', () => process.exit(1));
