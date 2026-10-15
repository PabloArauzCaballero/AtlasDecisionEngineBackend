import type { EnvRule } from '../env-rule';

export const forbidFakeAudioInProduction: EnvRule = (value, ctx) => {
  /*
   * Locución: lo que NO puede salir a producción.
   *
   * Las tres se conservan del paquete original. Un audio de prueba servido
   * a una persona real es peor que no servir ninguno; un directorio en
   * disco dentro de un contenedor se va con el contenedor y se lleva la
   * caché entera; y la licencia de uso de una voz sintética es una decisión
   * legal que nadie debe tomar heredando un valor por omisión.
   */
  if (value.AUDIO_TTS_WORKER_ENABLED) {
    if (value.AUDIO_TTS_PROVIDER === 'fake') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUDIO_TTS_PROVIDER'],
        message:
          'AUDIO_TTS_PROVIDER=fake está prohibido en producción: sintetiza un audio ' +
          'determinista que no es una voz, y quien lo escuche creerá que sí lo es.',
      });
    }
    if (!value.AUDIO_TTS_PROD_LICENSE_CONFIRMED) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUDIO_TTS_PROD_LICENSE_CONFIRMED'],
        message:
          'Declara AUDIO_TTS_PROD_LICENSE_CONFIRMED=true para usar la voz del proveedor en ' +
          'producción. Es la confirmación de que alguien miró la licencia.',
      });
    }
    if (value.AUDIO_STORAGE_DRIVER === 'local') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUDIO_STORAGE_DRIVER'],
        message:
          'AUDIO_STORAGE_DRIVER=local guarda el audio en el disco del contenedor y se va ' +
          'con él: la caché entera se perdería y habría que volver a pagarla. Usa ' +
          '«database» en producción.',
      });
    }
  }
};
