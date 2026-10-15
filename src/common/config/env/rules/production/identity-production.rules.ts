import type { EnvRule } from '../env-rule';

export const requireCalibratedIdentityInProduction: EnvRule = (value, ctx) => {
  /*
   * Verificación de identidad: lo que NO puede salir a producción.
   *
   * Estas cuatro guardas vienen del paquete original y se perdieron al
   * absorberlo; sin ellas, un despliegue que sólo encendiera el worker
   * decidiría sobre la identidad de personas reales con un comparador
   * sintético y sin que nadie lo hubiera decidido. El worker apagado no las
   * dispara: son el precio de encenderlo, no del despliegue.
   */
  if (value.IDENTITY_VERIFICATION_WORKER_ENABLED) {
    /*
     * Un perfil calibrado sobre rostros SINTÉTICOS no vale para personas.
     *
     * El comparador ya es real, así que la pregunta dejó de ser «¿mira las
     * imágenes?» y pasó a ser «¿contra qué población se midió el corte?».
     * `scripts/calibrar-identidad.mjs` mide sobre la población dibujada que
     * vive en este repositorio y nombra el perfil `sintetico-…` justamente
     * para que se note: esos rostros no cubren el espacio de rasgos que
     * cubren las personas, y un umbral medido sobre ellos no predice la tasa
     * de falsas aceptaciones sobre caras de verdad.
     *
     * Sirve para demostrar el worker y para las pruebas. En producción hay
     * que recalibrar contra un corpus real —el mismo comando, apuntado a
     * otra carpeta— y el perfil pasará a llamarse de otra manera.
     */
    if (/^sintetico/i.test(value.IDENTITY_THRESHOLD_PROFILE_VERSION)) {
      ctx.addIssue({
        code: 'custom',
        path: ['IDENTITY_THRESHOLD_PROFILE_VERSION'],
        message:
          'El perfil de umbrales está calibrado sobre rostros sintéticos y no predice la ' +
          'tasa de falsas aceptaciones sobre personas reales. Recalibra contra un corpus ' +
          'real con `yarn calibrar:identidad <carpeta>` y usa el perfil que emita, o apaga ' +
          'IDENTITY_VERIFICATION_WORKER_ENABLED.',
      });
    }
    if (value.IDENTITY_THRESHOLD_PROFILE_VERSION === 'unconfigured') {
      ctx.addIssue({
        code: 'custom',
        path: ['IDENTITY_THRESHOLD_PROFILE_VERSION'],
        message:
          'IDENTITY_THRESHOLD_PROFILE_VERSION debe nombrar el perfil calibrado del que ' +
          'salen los umbrales. Sin él, el veredicto no dice contra qué se decidió y no ' +
          'hay forma de auditarlo después.',
      });
    }
    if (!value.IDENTITY_LIVENESS_ENABLED && !value.IDENTITY_ACCEPT_NO_LIVENESS_RISK) {
      ctx.addIssue({
        code: 'custom',
        path: ['IDENTITY_LIVENESS_ENABLED'],
        message:
          'Sin prueba de vida, una foto impresa del documento junto a una foto impresa ' +
          'de su titular pasa la comparación 1:1. Enciende IDENTITY_LIVENESS_ENABLED o, ' +
          'para aceptar ese riesgo a sabiendas, declara ' +
          'IDENTITY_ACCEPT_NO_LIVENESS_RISK=true y documenta la excepción.',
      });
    }
    /*
     * La detección de fraude documental, ENCENDIDA y ESTRICTA en producción.
     *
     * Son dos exigencias y responden a dos fallos distintos. Apagarla deja el
     * worker contestando sólo «¿es un carnet?», que es la pregunta que una
     * falsificación bien hecha aprueba: el texto de un montaje es el de un
     * documento auténtico porque se copió de uno.
     *
     * No ponerla estricta es peor, porque no se nota: el flujo funciona, los
     * casos salen VERIFICADOS y lo único que ha pasado es que el servidor de
     * embeddings dejó de contestar hace tres días y desde entonces nadie
     * comprueba la conformidad semántica de nada. Una prueba que falta no es
     * una prueba superada, y en estricto el caso escala a una persona.
     */
    if (!value.IDENTITY_FRAUD_DETECTION_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['IDENTITY_FRAUD_DETECTION_ENABLED'],
        message:
          'Sin detección de fraude documental el worker sólo comprueba que la imagen sea ' +
          'un carnet, y el texto de una falsificación es el de un documento auténtico ' +
          'porque se copió de uno. Enciende IDENTITY_FRAUD_DETECTION_ENABLED.',
      });
    }
    if (value.IDENTITY_FRAUD_DETECTION_ENABLED && !value.IDENTITY_FRAUD_STRICT) {
      ctx.addIssue({
        code: 'custom',
        path: ['IDENTITY_FRAUD_STRICT'],
        message:
          'IDENTITY_FRAUD_STRICT=true es obligatorio en producción: sin él, una caída del ' +
          'servidor de embeddings deja de comprobar la conformidad del documento sin que ' +
          'nada lo delate, y los casos siguen saliendo verificados.',
      });
    }
    if (value.IDENTITY_FRAUD_REVIEW_RISK >= value.IDENTITY_FRAUD_SUSPICION_RISK) {
      ctx.addIssue({
        code: 'custom',
        path: ['IDENTITY_FRAUD_REVIEW_RISK'],
        message:
          'IDENTITY_FRAUD_REVIEW_RISK tiene que ser MENOR que ' +
          'IDENTITY_FRAUD_SUSPICION_RISK: entre los dos vive la franja que se delega a una ' +
          'persona, y con el orden invertido esa franja queda vacía.',
      });
    }
  }
};
