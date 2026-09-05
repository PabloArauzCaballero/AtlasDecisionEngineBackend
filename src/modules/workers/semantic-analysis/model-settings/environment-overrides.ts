import type { ModelGateway } from './semantic-model-settings.dto';

/**
 * Traduce una elección de gateway y modelos a las variables que la fábrica del
 * núcleo ya sabe leer.
 *
 * Es la pieza que permite que la configuración del portal NO tenga un camino
 * de construcción propio: se expresa como si fuera entorno y pasa por la misma
 * fábrica, las mismas validaciones y la misma comprobación de presupuesto que
 * un despliegue configurado a mano. Un modelo elegido desde la pantalla y el
 * mismo modelo puesto en `.env` construyen exactamente el mismo adaptador.
 *
 * El modo (`SEMANTIC_MODEL_PROVIDER`) sólo se toca donde la elección tiene
 * sentido: en directo se sustituye por el gateway elegido; en cascada se
 * sustituye el escalón remoto y el codificador local queda como estaba.
 */
export function environmentOverridesFor(
  mode: string,
  gateway: ModelGateway,
  fastModel: string,
  deepModel: string,
): Record<string, string> {
  const models: Record<string, string> =
    gateway === 'openrouter'
      ? { OPENROUTER_FAST_MODEL: fastModel, OPENROUTER_DEEP_MODEL: deepModel }
      : { LITELLM_FAST_MODEL: fastModel, LITELLM_DEEP_MODEL: deepModel };

  if (mode === 'cascade') {
    return {
      ...models,
      SEMANTIC_MODEL_PROVIDER: 'cascade',
      SEMANTIC_CASCADE_REMOTE_PROVIDER: gateway,
    };
  }
  if (mode === 'litellm' || mode === 'openrouter') {
    return { ...models, SEMANTIC_MODEL_PROVIDER: gateway };
  }
  return models;
}
