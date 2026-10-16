import { HumanLike, registrarLectorDeDisco, require_, rutas } from './paths';

/** La forma del `model.json` que publica el conversor de TensorFlow. */
export interface ManifiestoDeModelo {
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
      /*
       * `rotation: true` ALINEA el rostro con la malla antes de describirlo, y
       * estaba apagado.
       *
       * Encenderlo es lo único que mejoró las DOS poblaciones a la vez, que es
       * el listón que tiene que pasar cualquier cambio en la comparación
       * biométrica: subir el parecido de un par genuino es fácil —basta con
       * acercar todos los rostros entre sí— y también es exactamente cómo se
       * cuela un impostor.
       *
       *   | rotation | par real (documento↔selfie) | genuinas p05 | impostoras p99 | d'    |
       *   | -------- | --------------------------- | ------------ | -------------- | ----- |
       *   | false    | 0,6606                      | 0,8315       | 0,8572         | 3,299 |
       *   | true     | 0,6930                      | 0,8436       | 0,8460         | 3,395 |
       *
       * Las genuinas suben, las impostoras BAJAN y la separación mejora. Tiene
       * sentido: el descriptor deja de gastar capacidad en compensar la
       * inclinación de la cabeza, que es justo lo que distingue una selfie
       * tomada a pulso de un retrato de estudio pegado a un carnet.
       *
       * Cuesta 16 ms por imagen (72 → 88 ms), sobre una verificación completa de
       * unos 3,6 s. No hay nada que discutir en ese reparto.
       *
       * Las impostoras son de la población SINTÉTICA —rostros dibujados— porque
       * es la única con impostores que este repositorio puede tener. El par real
       * es uno. Ninguna de las dos poblaciones basta por su cuenta; que las dos
       * apunten al mismo lado es lo que sostiene el cambio.
       */
      detector: { enabled: true, rotation: true, maxDetected: 4, minConfidence: 0.2 },
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
