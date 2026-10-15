import type { EnvRule } from '../env-rule';

export const requireSemanticWorkerSafeguards: EnvRule = (value, ctx) => {
  // Transferencia internacional de datos personales.
  //
  // El proveedor `openai` manda a `api.openai.com` el texto que clasifica, y ese texto
  // sale de extractos y descripciones de movimientos. Es un dato personal cruzando la
  // frontera, con obligaciones propias (LGPD art. 33 + Res. CD/ANPD 19/2024; y para una
  // institución financiera brasileña, la notificación previa a BACEN de la Res. 4.658
  // arts. 11-15). El proveedor por defecto de la fábrica es `openai`, así que sin esta
  // guarda un despliegue que solo encendiera el worker transferiría datos al exterior
  // sin que nadie hubiera decidido hacerlo. `transformer` corre dentro del perímetro y
  // no la necesita.
  if (
    value.SEMANTIC_ANALYSIS_WORKER_ENABLED &&
    value.SEMANTIC_ANALYSIS_PROVIDER !== 'transformer' &&
    !value.SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER'],
      message:
        'El worker semántico con un proveedor alojado envía el texto analizado fuera del ' +
        'país. Declara SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER=true una vez cubiertas las ' +
        'obligaciones de transferencia internacional, o usa SEMANTIC_ANALYSIS_PROVIDER=' +
        'transformer, que se ejecuta dentro del perímetro.',
    });
  }
  /*
   * El gateway sin credencial arranca y falla en CADA job.
   *
   * La fábrica del núcleo la exige, pero se construye PEREZOSAMENTE (ver
   * `semantic-model-provider.bridge.ts`), así que sin esta guarda el proceso
   * levanta sano, acepta trabajo y lo convierte en pendientes de revisión uno
   * a uno. Es el modo de fallo más caro de los tres: no cae, no clasifica y
   * la bandeja crece sin que nada apunte a la configuración.
   */
  // En cascada el gateway que importa es el del escalón remoto, no «LiteLLM
  // porque sí»: con el remoto en OpenRouter, exigir LITELLM_API_KEY pediría
  // una credencial que ese despliegue no usa.
  const escalonRemoto =
    value.SEMANTIC_ANALYSIS_PROVIDER === 'cascade'
      ? (value.SEMANTIC_CASCADE_REMOTE_PROVIDER ?? 'litellm')
      : value.SEMANTIC_ANALYSIS_PROVIDER;
  if (
    value.SEMANTIC_ANALYSIS_WORKER_ENABLED &&
    escalonRemoto === 'litellm' &&
    (value.LITELLM_API_KEY ?? '') === ''
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['LITELLM_API_KEY'],
      message:
        'SEMANTIC_ANALYSIS_PROVIDER=litellm necesita la credencial del gateway. Define ' +
        'LITELLM_API_KEY (la master key o una virtual key del proxy); las claves de los ' +
        'proveedores físicos no van aquí, sino en el contenedor de LiteLLM.',
    });
  }
  // Mismo modo de fallo con el otro gateway: arranca sano y convierte cada
  // glosa en un pendiente de revisión.
  if (
    value.SEMANTIC_ANALYSIS_WORKER_ENABLED &&
    escalonRemoto === 'openrouter' &&
    (value.OPENROUTER_API_KEY ?? '') === ''
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['OPENROUTER_API_KEY'],
      message:
        'SEMANTIC_ANALYSIS_PROVIDER=openrouter (o la cascada con escalón remoto en ' +
        'OpenRouter) necesita OPENROUTER_API_KEY. Las cuentas de los proveedores físicos ' +
        'viven en OpenRouter, no aquí.',
    });
  }
  /*
   * El árbitro de identidad en modo `AI` sin credencial de OpenRouter.
   *
   * Sin llave el adaptador no falla: DIFIERE, que es su comportamiento
   * correcto ante cualquier avería. Y ahí está el problema —la bandeja se
   * llena exactamente igual que si el modelo estuviera contestando «no lo
   * sé», y nadie tiene motivo para mirar una variable de entorno—. Es el
   * mismo modo de fallo que ya se cierra arriba para el worker semántico:
   * arranca sano y no hace nada de lo que promete.
   */
  if (
    value.IDENTITY_VERIFICATION_WORKER_ENABLED &&
    value.IDENTITY_ARBITRATION_MODE === 'AI' &&
    (value.OPENROUTER_API_KEY ?? '') === ''
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['OPENROUTER_API_KEY'],
      message:
        'IDENTITY_ARBITRATION_MODE=AI necesita OPENROUTER_API_KEY: sin ella el árbitro ' +
        'difiere todos los casos y la bandeja humana crece sin que nada lo explique. ' +
        'Con HUMAN no hace falta.',
    });
  }
};
