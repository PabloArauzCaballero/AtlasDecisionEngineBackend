import * as path from 'node:path';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { ManifiestoDeModelo } from './engine';

export const require_ = createRequire(__filename);

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

export interface HumanLike {
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
export function rutas() {
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
export function registrarLectorDeDisco(tf: {
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
