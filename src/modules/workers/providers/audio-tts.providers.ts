import { AudioTtsRunWorkerService } from '../audio-tts/audio-tts-run-worker.service';
import { AudioTtsRuntimeFactory } from '../audio-tts/audio-tts.runtime';
import { AudioTtsService } from '../audio-tts/audio-tts.service';

export const AUDIO_TTS_PROVIDERS = [
  // --- Worker D: locución -------------------------------------------------
  //
  // Se declaran TRES piezas y ninguna es el núcleo. El núcleo absorbido no
  // entra en el contenedor de Nest a propósito: sus repositorios van atados a
  // un tenant y un singleton no puede estarlo, así que lo arma
  // `AudioTtsRuntimeFactory` por ejecución. Ver ese archivo.
  AudioTtsService,
  AudioTtsRunWorkerService,
  AudioTtsRuntimeFactory,
];
