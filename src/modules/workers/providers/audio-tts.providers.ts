import { AudioReaderService } from '../audio-tts/audio-reader.service';
import { AudioRenderPolicy } from '../audio-tts/audio-render.policy';
import { AudioRunFailureService } from '../audio-tts/audio-run-failure.service';
import { AudioRunIntakeService } from '../audio-tts/audio-run-intake.service';
import { AudioRunLeaseService } from '../audio-tts/audio-run-lease.service';
import { AudioRunService } from '../audio-tts/audio-run.service';
import { AudioTemplateCatalogService } from '../audio-tts/audio-template-catalog.service';
import { AudioTtsRunWorkerService } from '../audio-tts/audio-tts-run-worker.service';
import { AudioTtsRuntimeFactory } from '../audio-tts/audio-tts.runtime';

export const AUDIO_TTS_PROVIDERS = [
  // --- Worker D: locución -------------------------------------------------
  //
  // Ninguna pieza es el núcleo. El núcleo absorbido no entra en el contenedor de Nest a
  // propósito: sus repositorios van atados a un tenant y un singleton no puede estarlo, así que
  // lo arma `AudioTtsRuntimeFactory` por ejecución. Ver ese archivo.
  AudioTemplateCatalogService,
  AudioRunIntakeService,
  AudioRunService,
  AudioReaderService,
  AudioRenderPolicy,
  AudioRunLeaseService,
  AudioRunFailureService,
  AudioTtsRunWorkerService,
  AudioTtsRuntimeFactory,
];
