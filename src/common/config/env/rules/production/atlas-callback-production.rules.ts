import type { EnvRule } from '../env-rule';

export const requireAtlasCallbackPair: EnvRule = (value, ctx) => {
  /*
   * El aviso de vuelta a AtlasBackend: las dos claves JUNTAS, o la renuncia declarada.
   *
   * Con una sola, el despliegue arranca sano y cada resolución humana —identidad, riesgo,
   * crédito, extracto— se queda en el motor: el analista ve el caso cerrado y el cliente
   * sigue «en revisión» en AtlasBackend. El dispatcher ya no lo da por entregado, pero
   * descubrirlo en la cola muerta es peor que descubrirlo al arrancar.
   */
  if (!value.ATLAS_CALLBACK_DISABLED) {
    const faltantes = (
      [
        ['ATLAS_BACKEND_BASE_URL', value.ATLAS_BACKEND_BASE_URL],
        ['ENGINE_CALLBACK_API_KEY', value.ENGINE_CALLBACK_API_KEY],
      ] as const
    ).filter(([, configured]) => !configured);
    for (const [key] of faltantes) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message:
          'El aviso de vuelta a AtlasBackend necesita ATLAS_BACKEND_BASE_URL y ' +
          'ENGINE_CALLBACK_API_KEY juntas: sin ellas, cada resolución humana (identidad, ' +
          'riesgo, crédito, extracto) se queda en el motor y el cliente sigue «en revisión» ' +
          'en AtlasBackend. Si este despliegue opera sin AtlasBackend a propósito, ' +
          'decláralo con ATLAS_CALLBACK_DISABLED=true.',
      });
    }
  }
};
