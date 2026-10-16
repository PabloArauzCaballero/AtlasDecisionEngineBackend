import { z } from 'zod';
import { ProviderKind } from './factory';

/** Los dos gateways que pueden atender el escalón remoto: el propio y el alojado. */
export type RemoteGatewayKind = 'litellm' | 'openrouter';

export const selectionSchema = z.object({
  SEMANTIC_MODEL_PROVIDER: z
    .enum(['openai', 'transformer', 'litellm', 'openrouter', 'cascade'])
    .default('openai'),
  /**
   * Quién atiende el escalón remoto de la cascada. Por omisión el gateway
   * propio, que es lo que había; `openrouter` deja el codificador local
   * exactamente igual y sólo cambia a quién se le pregunta lo difícil.
   */
  SEMANTIC_CASCADE_REMOTE_PROVIDER: z.enum(['litellm', 'openrouter']).default('litellm'),
  /**
   * Cuánto se le espera al clasificador local antes de escalar al modelo remoto.
   *
   * Dos segundos porque un codificador local resuelve en decenas de milisegundos:
   * pasar de ahí no significa «va a tardar un poco más», significa que algo va mal
   * —el servidor de embeddings caído, el modelo recargándose, la CPU saturada— y
   * seguir esperando sólo retrasa una respuesta que el escalón siguiente puede dar.
   */
  SEMANTIC_CASCADE_LOCAL_TIMEOUT_MS: z.coerce.number().int().min(200).max(60_000).default(2_000),
  // Se resuelve por separado para permitir la adopción por etapas: embeddings locales sobre un
  // clasificador alojado es una configuración deliberada, no una inconsistencia.
  SEMANTIC_EMBEDDING_PROVIDER: z.enum(['openai', 'transformer', 'litellm']).optional(),
  NODE_ENV: z.string().optional(),
  SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER: z
    .string()
    .optional()
    .transform((value) => value === 'true' || value === '1' || value === 'yes'),
});

/**
 * Comprueba, ya con el proveedor elegido en la mano, que nadie transfiere datos al exterior
 * sin haberlo decidido.
 *
 * Duplica la validación del env schema a propósito, igual que `ScriptNodeRunnerService`
 * duplica la del runner: el schema protege el arranque del proceso, y esto protege el punto
 * donde de verdad se construye el cliente que va a salir a internet. Si alguien monta este
 * módulo por otra vía —una prueba, un script, un arranque que se saltó la validación—, la
 * decisión sigue siendo explícita.
 *
 * `openai` envía a `api.openai.com` el texto que clasifica, que procede de extractos y
 * descripciones de movimientos: dato personal cruzando la frontera. LGPD art. 33 y, para una
 * institución financiera brasileña, Res. BACEN 4.658 arts. 11-15.
 *
 * **`litellm` cuenta igual, y el gateway propio no es la excepción que parece.** El proxy
 * corre dentro del perímetro, pero lo que hay detrás de sus alias son despliegues de OpenAI,
 * Anthropic o Vertex, y el texto sale por ahí exactamente igual. Además el motor ya no puede
 * verlo: los destinos viven en `config.yaml` del gateway, así que si la guarda tratara a
 * `litellm` como local bastaría con añadir un despliegue remoto a ESE fichero para transferir
 * datos al exterior sin tocar nada del motor y sin que nadie lo declarase. Un despliegue con
 * el gateway apuntado sólo a modelos dentro del perímetro declara la variable igualmente —una
 * afirmación de más—; lo contrario sería una transferencia de menos.
 *
 * **`openrouter` es el caso sin matiz.** No hay perímetro que valga: es un servicio alojado
 * que reenvía a proveedores alojados, y el texto sale del país en la primera llamada.
 */
export function assertTransferAllowed(
  kind: ProviderKind,
  selection: { NODE_ENV?: string; SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER: boolean },
): void {
  // `cascade` NO se exime por empezar en local: su escalón siguiente es el gateway, y
  // basta con que una glosa no la resuelva el codificador para que su texto salga
  // fuera. Eximirlo haría que la declaración dependiera de cuántas glosas resulten
  // difíciles, que no es una propiedad del despliegue sino de los extractos del día.
  if (kind === 'transformer') return;
  if (selection.NODE_ENV !== 'production') return;
  if (selection.SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER) return;
  throw new Error(
    'El proveedor semántico alojado transfiere el texto analizado fuera del país y esta ' +
      'instalación no lo ha declarado. Configura SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER=true ' +
      'una vez cubiertas las obligaciones de transferencia internacional, o usa el proveedor ' +
      '`transformer`, que se ejecuta dentro del perímetro.',
  );
}
