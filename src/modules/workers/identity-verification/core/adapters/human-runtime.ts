import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import sharp from 'sharp';

/**
 * Arranque del motor biométrico REAL, en local y sin red.
 *
 * Human (`@vladmandic/human`) trae dentro del paquete las cinco redes que hacen
 * falta —detección, malla facial, descriptor de 1024 dimensiones, antispoof y
 * prueba de vida— y se ejecuta sobre WebAssembly. Eso es lo que permite que la
 * biometría sea de verdad sin credenciales de ningún proveedor y sin coste por
 * verificación: es la misma decisión que se tomó para la lectura del documento
 * con Tesseract.
 *
 * Tres cosas hay que forzar para que no toque la red, y las tres importan:
 *
 * 1. **El binario de WebAssembly, del disco.** Por omisión Human apunta a un CDN.
 *    Un worker que descarga su propio motor al arrancar falla justo cuando la
 *    red del despliegue está cerrada, que es como debe estar.
 * 2. **Los modelos, del disco.** `fetch` de Node NO admite `file://` —devuelve
 *    «not implemented... yet»—, así que se registra un lector propio en tfjs bajo
 *    el esquema `disco://`. Sin él los pesos no cargan y `human.detect()`
 *    devuelve cero rostros sin decir por qué.
 * 3. **Una sola instancia.** Cargar 10 MB de pesos por cada verificación es
 *    inviable; se hace una vez y se comparte.
 *
 * El paquete se resuelve con `createRequire` porque sus builds no son un módulo
 * ESM y el `dist` que necesitamos —el que externaliza tfjs— no está en los
 * `exports` por defecto.
 */

const require_ = createRequire(__filename);

/** Lo que este módulo necesita de un rostro. No es toda la ficha de Human. */
export interface RostroDetectado {
  /** Caja en proporciones [0,1] del ancho y alto de la imagen. */
  box: { left: number; top: number; width: number; height: number };
  /** Confianza del detector, 0..1. */
  score: number;
  /** Descriptor de 1024 dimensiones, o `null` si no se pudo describir. */
  embedding: number[] | null;
  /** Antispoof: 1 = rostro presente ante la cámara, 0 = foto de una foto. */
  real: number | null;
  /** Prueba de vida del modelo `liveness`. */
  live: number | null;
}

interface HumanLike {
  init(): Promise<void>;
  load(): Promise<void>;
  detect(input: unknown): Promise<{ face?: unknown[] }>;
  models: { stats(): { numLoadedModels: number } };
  tf: {
    tensor(data: Uint8Array, forma: number[], tipo: string): unknown;
    dispose(t: unknown): void;
    getBackend(): string;
  };
}

/**
 * Dónde vive cada cosa dentro de `node_modules`, resuelto por el propio Node.
 *
 * Se resuelven ARCHIVOS y no `package.json`: los dos paquetes declaran mapa de
 * `exports`, y ahí `./package.json` no está expuesto —pedirlo revienta con
 * «subpath is not defined by exports»—. Cada archivo que se pide aquí sí está
 * en su mapa, y de su ubicación se deducen las carpetas hermanas.
 */
function rutas() {
  /*
   * Se resuelve el paquete a secas y de ahí se deduce el hermano que hace falta.
   *
   * `@vladmandic/human` declara sus variantes en `exports` con las claves SIN el
   * `./` que exige la especificación (`"dist/human.node-wasm.js"` en vez de
   * `"./dist/…"`), así que Node no las expone y pedirlas falla con «subpath is
   * not defined». El punto de entrada por omisión sí resuelve —apunta a la
   * variante que quiere `tfjs-node`, que aquí no se puede compilar—, y desde su
   * carpeta se llega a la que sí sirve.
   */
  const porOmision = require_.resolve('@vladmandic/human');
  const dist = path.dirname(porOmision);
  const wasmDist = path.dirname(require_.resolve('@tensorflow/tfjs-backend-wasm'));
  return {
    build: path.join(dist, 'human.node-wasm.js'),
    modelos: path.join(path.dirname(dist), 'models').replace(/\\/g, '/'),
    wasm: `${wasmDist.replace(/\\/g, '/')}/`,
  };
}

/**
 * Lector de modelos desde el sistema de ficheros.
 *
 * Reproduce lo que hace `tfjs-node` con `file://`, que es el paquete que aquí no
 * se puede usar: exige compilar un binario nativo y en esta máquina —y en
 * cualquier imagen sin cadena de compilación— no se construye.
 */
function registrarLectorDeDisco(tf: {
  io: { registerLoadRouter(r: (url: unknown) => unknown): void };
}): void {
  tf.io.registerLoadRouter((url: unknown) => {
    if (typeof url !== 'string' || !url.startsWith('disco://')) return null;
    const jsonPath = url.slice('disco://'.length);
    return {
      load: async () => {
        const manifiesto = JSON.parse(await readFile(jsonPath, 'utf8')) as ManifiestoDeModelo;
        const dir = path.dirname(jsonPath);
        const specs: unknown[] = [];
        const trozos: Buffer[] = [];
        for (const grupo of manifiesto.weightsManifest ?? []) {
          specs.push(...grupo.weights);
          for (const p of grupo.paths) trozos.push(await readFile(path.join(dir, p)));
        }
        const pesos = Buffer.concat(trozos);
        return {
          modelTopology: manifiesto.modelTopology,
          weightSpecs: specs,
          weightData: pesos.buffer.slice(pesos.byteOffset, pesos.byteOffset + pesos.byteLength),
          format: manifiesto.format,
          generatedBy: manifiesto.generatedBy,
          convertedBy: manifiesto.convertedBy,
          signature: manifiesto.signature,
          userDefinedMetadata: manifiesto.userDefinedMetadata,
        };
      },
    };
  });
}

/** La forma del `model.json` que publica el conversor de TensorFlow. */
interface ManifiestoDeModelo {
  modelTopology?: unknown;
  weightsManifest?: Array<{ weights: unknown[]; paths: string[] }>;
  format?: string;
  generatedBy?: string;
  convertedBy?: string;
  signature?: unknown;
  userDefinedMetadata?: unknown;
}

/** Lo poco que se le pide a tfjs desde aquí. */
interface TfLike {
  io: { registerLoadRouter(r: (url: unknown) => unknown): void };
}

/** El constructor de Human, tal como lo exporta su build de Node. */
type ConstructorDeHuman = new (config: Record<string, unknown>) => HumanLike;

let instancia: Promise<HumanLike> | null = null;

/** El motor, cargado una sola vez para todo el proceso. */
export function motorBiometrico(): Promise<HumanLike> {
  instancia ??= arrancar();
  return instancia;
}

async function arrancar(): Promise<HumanLike> {
  const { build, modelos, wasm } = rutas();
  const tf = require_('@tensorflow/tfjs-core') as TfLike;
  require_('@tensorflow/tfjs-backend-wasm');
  registrarLectorDeDisco(tf);

  const modulo = require_(build) as { Human?: ConstructorDeHuman; default?: ConstructorDeHuman };
  const Human = modulo.Human ?? modulo.default;
  if (!Human) throw new Error(`El build biométrico ${build} no exporta la clase Human.`);
  const human: HumanLike = new Human({
    backend: 'wasm',
    wasmPath: wasm,
    modelBasePath: `disco://${modelos}/`,
    // Sin caché entre llamadas: dos verificaciones distintas no comparten nada,
    // y la caché de Human está pensada para fotogramas de vídeo consecutivos.
    cacheSensitivity: 0,
    debug: false,
    face: {
      enabled: true,
      detector: { enabled: true, rotation: false, maxDetected: 4, minConfidence: 0.2 },
      mesh: { enabled: true },
      description: { enabled: true },
      antispoof: { enabled: true },
      liveness: { enabled: true },
      iris: { enabled: false },
      emotion: { enabled: false },
    },
    body: { enabled: false },
    hand: { enabled: false },
    object: { enabled: false },
    gesture: { enabled: false },
    filter: { enabled: false },
  });

  await human.init();
  await human.load();
  const cargados = human.models.stats().numLoadedModels;
  if (cargados < 5) {
    // Falla al arrancar y no en la primera verificación: un motor con los pesos
    // a medias no da error, da CERO ROSTROS, que se lee como «no había nadie en
    // la foto» y es la peor manera posible de romperse.
    throw new Error(
      `El motor biométrico cargó ${cargados} de 5 modelos desde ${modelos}. Falta parte de @vladmandic/human.`,
    );
  }
  return human;
}

/** Sólo para las pruebas: obliga a volver a cargar. */
export function reiniciarMotorBiometrico(): void {
  instancia = null;
}

/**
 * Los rostros de una imagen.
 *
 * La imagen se decodifica con `sharp` —ya es dependencia— porque sin
 * `tfjs-node` no hay `decodeImage`, y se entrega como tensor de enteros, que es
 * lo que Human espera de una fuente que no es un lienzo del navegador.
 */
export async function detectarRostros(imagen: Buffer): Promise<RostroDetectado[]> {
  const human = await motorBiometrico();
  const { data, info } = await sharp(imagen)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const tensor = human.tf.tensor(new Uint8Array(data), [1, info.height, info.width, 3], 'int32');
  try {
    const resultado = await human.detect(tensor);
    const caras = (resultado.face ?? []) as Array<Record<string, unknown>>;
    return caras.map((cara) => {
      const caja = (cara.box as number[] | undefined) ?? [0, 0, 0, 0];
      return {
        // Human da la caja en píxeles; el puerto la quiere en proporciones, que
        // es lo único que sobrevive a un remuestreo posterior.
        box: {
          left: caja[0] / info.width,
          top: caja[1] / info.height,
          width: caja[2] / info.width,
          height: caja[3] / info.height,
        },
        score: (cara.faceScore as number | undefined) ?? (cara.score as number | undefined) ?? 0,
        embedding: Array.isArray(cara.embedding) ? (cara.embedding as number[]) : null,
        real: typeof cara.real === 'number' ? cara.real : null,
        live: typeof cara.live === 'number' ? cara.live : null,
      };
    });
  } finally {
    human.tf.dispose(tensor);
  }
}

/**
 * Parecido entre dos descriptores, como coseno en [0,1].
 *
 * Se usa el coseno y no la función de parecido que trae Human porque aquélla
 * comprime el resultado a dos decimales y aplasta el tramo que aquí decide:
 * medido sobre una población sintética, dos personas distintas daban 0,99 y la
 * misma persona 1,00. El coseno sobre el descriptor sin normalizar separa esos
 * mismos casos en 0,88 y 0,94, y es además la medida sobre la que se calibran
 * los umbrales en `scripts/calibrar-identidad.mjs`.
 */
export function parecidoCoseno(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let producto = 0;
  let normaA = 0;
  let normaB = 0;
  for (let i = 0; i < a.length; i += 1) {
    producto += a[i] * b[i];
    normaA += a[i] * a[i];
    normaB += b[i] * b[i];
  }
  if (normaA === 0 || normaB === 0) return 0;
  const coseno = producto / Math.sqrt(normaA * normaB);
  // El coseno vive en [-1,1]; el puerto promete [0,1]. Se recorta en vez de
  // reescalar: un parecido negativo significa «nada que ver», no «medio».
  return Math.min(1, Math.max(0, coseno));
}
