import type { EnvRule } from './env-rule';

export const requireCoherentIdentityThresholds: EnvRule = (value, ctx) => {
  /*
   * Umbrales biométricos: coherentes en CUALQUIER entorno.
   *
   * Un par a medias no es una configuración incompleta, es una contradicción:
   * el motor de decisión sólo puede comparar si tiene los dos, y con uno
   * suelto se comporta como si no hubiera ninguno —toda verificación a
   * revisión— sin que el que lo configuró entienda por qué. Se falla al
   * arrancar, que es donde se puede leer el mensaje, y no en la primera
   * verificación.
   */
  const tieneMatch = value.IDENTITY_MATCH_THRESHOLD !== undefined;
  const tieneReview = value.IDENTITY_REVIEW_THRESHOLD !== undefined;
  if (tieneMatch !== tieneReview) {
    ctx.addIssue({
      code: 'custom',
      path: [tieneMatch ? 'IDENTITY_REVIEW_THRESHOLD' : 'IDENTITY_MATCH_THRESHOLD'],
      message:
        'IDENTITY_MATCH_THRESHOLD e IDENTITY_REVIEW_THRESHOLD se configuran juntos o no se ' +
        'configura ninguno: con uno suelto el motor de decisión no puede decidir y manda ' +
        'todo a revisión manual.',
    });
  }
  if (
    tieneMatch &&
    tieneReview &&
    value.IDENTITY_REVIEW_THRESHOLD! >= value.IDENTITY_MATCH_THRESHOLD!
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['IDENTITY_REVIEW_THRESHOLD'],
      message:
        'IDENTITY_REVIEW_THRESHOLD tiene que ser MENOR que IDENTITY_MATCH_THRESHOLD: entre ' +
        'los dos está la franja ambigua que se manda a una persona, y al revés esa franja ' +
        'no existe.',
    });
  }
  /*
   * Los dos cortes de la prueba de vida, en el orden que tiene sentido.
   *
   * Al revés —fallar por encima de aprobar— no deja franja de duda: deja una
   * banda donde el mismo resultado supera Y falla a la vez, y gana el que se
   * evalúe primero. Es el mismo razonamiento que el par de umbrales de arriba.
   */
  if (value.IDENTITY_LIVENESS_FAIL_SCORE >= value.IDENTITY_LIVENESS_PASS_SCORE) {
    ctx.addIssue({
      code: 'custom',
      path: ['IDENTITY_LIVENESS_FAIL_SCORE'],
      message:
        'IDENTITY_LIVENESS_FAIL_SCORE tiene que ser MENOR que IDENTITY_LIVENESS_PASS_SCORE: ' +
        'entre los dos queda la franja no concluyente que se manda a una persona.',
    });
  }
  // Encender la prueba de vida y dejar el proveedor en `disabled` es pedir una
  // comprobación y a la vez apagarla; el resultado sería `NOT_RUN` para siempre.
  if (value.IDENTITY_LIVENESS_ENABLED && value.IDENTITY_LIVENESS_PROVIDER === 'disabled') {
    ctx.addIssue({
      code: 'custom',
      path: ['IDENTITY_LIVENESS_PROVIDER'],
      message:
        'IDENTITY_LIVENESS_PROVIDER no puede ser «disabled» con IDENTITY_LIVENESS_ENABLED=true.',
    });
  }
};
