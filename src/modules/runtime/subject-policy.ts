/**
 * Cuándo una decisión puede tomarse sin saber sobre quién.
 *
 * `subjectReference` nació opcional. De él cuelgan el historial del solicitante, el desenlace
 * observado, la exposición acumulada y el derecho de acceso del titular — y un campo opcional
 * del que depende todo eso acaba vacío. El daño es peor de lo que parece porque es silencioso
 * en las dos direcciones: las consultas devuelven cero filas, «cero filas» no se distingue de
 * «no hubo», y como la referencia se guarda en HMAC de una vía, una ejecución escrita sin
 * sujeto NO SE PUEDE REPARAR más tarde.
 *
 * La exigencia se sube por política y no de golpe: `REQUIRED` global el día del despliegue
 * rompe a todo integrador vivo, y la reversión se lleva por delante la migración entera. Se
 * mide primero (`WARN` + cobertura), se endurece después.
 */
import { HttpStatus } from '@nestjs/common';
import { SubjectReferencePolicy } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';

/** Lo que la política decide para UNA ejecución concreta. */
export interface SubjectPolicyOutcome {
  /** La referencia que se usará, si la hay. */
  subjectReference?: string;
  /**
   * Por qué no hay sujeto, cuando no lo hay. `WARN` = el integrador no lo mandó;
   * `NOT_APPLICABLE` = esta decisión declara que no tiene sujeto. Nulo si sí lo lleva.
   *
   * Distinguirlos no es un lujo: sin esta columna la cobertura mentiría en las dos
   * direcciones, contando como fallo las reglas de sistema y escondiendo a los integradores
   * que no migraron.
   */
  absenceReason: SubjectReferencePolicy | null;
}

/**
 * Política efectiva para una ejecución: la del ambiente, afinada por la versión.
 *
 * La versión puede ENDURECER siempre. No puede relajar un `REQUIRED` de ambiente a `WARN`:
 * eso sería una puerta trasera al control, abierta por quien publica el artefacto y no por
 * quien gobierna el ambiente.
 *
 * `NOT_APPLICABLE` es la excepción real, y por eso es la única que exige justificación
 * escrita. Hay decisiones que legítimamente no tienen sujeto —enrutado interno, reglas de
 * sistema— y negarlo obligaría a inventar un sujeto falso, que es mucho peor que declarar la
 * ausencia. Sin justificación se ignora y manda el ambiente: una exención sin motivo no es
 * una decisión, es un descuido, y el descuido no debe poder desactivar un control.
 */
export function effectiveSubjectPolicy(
  environmentPolicy: SubjectReferencePolicy,
  versionPolicy: SubjectReferencePolicy | null | undefined,
  versionJustification: string | null | undefined,
): SubjectReferencePolicy {
  if (!versionPolicy) return environmentPolicy;
  if (versionPolicy === SubjectReferencePolicy.REQUIRED) return SubjectReferencePolicy.REQUIRED;
  if (versionPolicy === SubjectReferencePolicy.NOT_APPLICABLE) {
    return versionJustification?.trim()
      ? SubjectReferencePolicy.NOT_APPLICABLE
      : environmentPolicy;
  }
  // versionPolicy === WARN: sólo vale donde el ambiente no exige más.
  return environmentPolicy === SubjectReferencePolicy.REQUIRED
    ? SubjectReferencePolicy.REQUIRED
    : SubjectReferencePolicy.WARN;
}

/**
 * Aplica la política a la petición.
 *
 * Con `REQUIRED` y sin referencia, lanza 400 con un código estable en vez de ejecutar: es el
 * único punto donde el sistema puede negarse todavía a crear evidencia irreparable.
 *
 * Ojo con `NOT_APPLICABLE`: si la petición TRAE una referencia, se usa igual. La política dice
 * «no exijo sujeto», no «prohíbo sujeto», y descartar un dato que el integrador se molestó en
 * mandar sería tirar a la basura la única forma de atar esa decisión a su titular.
 */
export function applySubjectPolicy(
  policy: SubjectReferencePolicy,
  subjectReference: string | undefined,
): SubjectPolicyOutcome {
  const reference = subjectReference?.trim();
  if (reference) return { subjectReference: reference, absenceReason: null };
  if (policy === SubjectReferencePolicy.REQUIRED) {
    throw new DomainException(
      'SUBJECT_REFERENCE_REQUIRED',
      'This environment requires subjectReference: a decision that cannot be attributed to ' +
        'a subject can never be given an observed outcome, and the reference is hashed one-way ' +
        'so it cannot be added afterwards.',
      HttpStatus.BAD_REQUEST,
    );
  }
  return { absenceReason: policy };
}

/**
 * Comprueba la política declarada en una versión antes de publicarla.
 *
 * Se valida al publicar y no al ejecutar porque un artefacto mal declarado tiene que parar en
 * gobierno, no en producción a las tres de la mañana.
 */
export function validateVersionSubjectPolicy(
  versionPolicy: SubjectReferencePolicy | null | undefined,
  versionJustification: string | null | undefined,
): string[] {
  const problems: string[] = [];
  if (versionPolicy === SubjectReferencePolicy.NOT_APPLICABLE && !versionJustification?.trim()) {
    problems.push(
      'SUBJECT_POLICY_JUSTIFICATION_REQUIRED: declarar NOT_APPLICABLE exige explicar por qué ' +
        'esta decisión no tiene sujeto.',
    );
  }
  if (versionPolicy !== SubjectReferencePolicy.NOT_APPLICABLE && versionJustification?.trim()) {
    problems.push(
      'SUBJECT_POLICY_JUSTIFICATION_UNUSED: la justificación sólo aplica a NOT_APPLICABLE; ' +
        'dejarla escrita con otra política hace creer que hay una exención que no existe.',
    );
  }
  return problems;
}
