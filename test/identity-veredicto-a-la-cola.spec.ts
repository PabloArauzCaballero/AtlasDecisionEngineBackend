import { IdentityReviewReason, WorkerRunStatus } from '@prisma/client';
import { outcomeForIdentityVerdict } from '../src/modules/workers/identity-verification/identity-outcome';
import { IdentityDecision } from '../src/modules/workers/identity-verification/core/domain/identity-enums';

/**
 * Un veredicto que dice «esto lo decide una persona» tiene que llegar a una bandeja.
 *
 * La cola de identidad existía, funcionaba y sólo la alimentaban los ERRORES de la puerta de
 * documentos. Una verificación que terminaba bien y cuyo veredicto era `REVIEW_REQUIRED` acababa
 * en `SUCCEEDED_WITH_WARNINGS` —un estado TERMINAL— y no aparecía en ninguna parte: el caso se
 * quedaba en su fila esperando a que alguien lo buscara por su cuenta.
 *
 * Medido el 2026-09-11 contra una cédula boliviana auténtica: `REVIEW_REQUIRED` con
 * `THRESHOLD_PROFILE_MISSING`, y `GET reviews` devolviendo cero elementos. Con esto, el mismo caso
 * entra como `PENDING_REVIEW · UNCALIBRATED_DECISION · prioridad 1`.
 */
describe('el veredicto decide si el caso entra en la cola', () => {
  it('un VERIFICADO no es trabajo de nadie', () => {
    const d = outcomeForIdentityVerdict(IdentityDecision.VERIFIED, []);
    expect(d.status).toBe(WorkerRunStatus.SUCCEEDED);
    expect(d.reviewReason).toBeNull();
    expect(d.reviewPriority).toBeNull();
  });

  it('un NO VERIFICADO es una decisión, no una cola', () => {
    const d = outcomeForIdentityVerdict(IdentityDecision.NOT_VERIFIED, ['FACE_NO_MATCH']);
    expect(d.status).toBe(WorkerRunStatus.SUCCEEDED_WITH_WARNINGS);
    expect(d.reviewReason).toBeNull();
  });

  it('un INCONCLUSIVE tampoco: lo que falta es una señal, no un juicio', () => {
    const d = outcomeForIdentityVerdict(IdentityDecision.INCONCLUSIVE, ['FACE_MATCH_UNAVAILABLE']);
    expect(d.status).toBe(WorkerRunStatus.SUCCEEDED_WITH_WARNINGS);
  });

  it('sin perfil de umbrales, el caso entra con el motivo que lo explica', () => {
    const d = outcomeForIdentityVerdict(IdentityDecision.REVIEW_REQUIRED, [
      'THRESHOLD_PROFILE_MISSING',
    ]);
    expect(d.status).toBe(WorkerRunStatus.PENDING_REVIEW);
    expect(d.reviewReason).toBe(IdentityReviewReason.UNCALIBRATED_DECISION);
    // Arriba del todo: es una persona con su documento en regla esperando por una carencia nuestra.
    expect(d.reviewPriority).toBe(1);
    // Lo firma una persona; el arbitraje por IA no decide identidades.
    expect(d.arbitrationMode).toBe('HUMAN');
  });

  it('una vida sin calibrar escala con el mismo motivo, no como fraude', () => {
    const d = outcomeForIdentityVerdict(IdentityDecision.REVIEW_REQUIRED, [
      'LIVENESS_FAILED',
      'LIVENESS_PROFILE_UNCALIBRATED',
    ]);
    expect(d.reviewReason).toBe(IdentityReviewReason.UNCALIBRATED_DECISION);
  });

  it('el parecido entre los dos cortes calibrados sí es una duda sobre la persona', () => {
    const d = outcomeForIdentityVerdict(IdentityDecision.REVIEW_REQUIRED, ['AMBIGUOUS_MATCH']);
    expect(d.reviewReason).toBe(IdentityReviewReason.AMBIGUOUS_FACE_MATCH);
  });

  /*
   * La precedencia es lo que hace útil la bandeja: quien la abre decide qué mirar por el motivo.
   * Un caso sin umbrales Y con un aviso de calidad no es un problema de calidad — etiquetarlo así
   * manda a esa persona al fondo de la cola por un motivo falso.
   */
  it('cuando concurren varios códigos gana el que explica por qué nadie pudo firmar', () => {
    const d = outcomeForIdentityVerdict(IdentityDecision.REVIEW_REQUIRED, [
      'LOW_FACE_QUALITY',
      'THRESHOLD_PROFILE_MISSING',
    ]);
    expect(d.reviewReason).toBe(IdentityReviewReason.UNCALIBRATED_DECISION);
    expect(d.reviewPriority).toBe(1);
  });

  it('los avisos de calidad, solos, son otra cosa y otra prioridad', () => {
    const d = outcomeForIdentityVerdict(IdentityDecision.REVIEW_REQUIRED, [
      'LOW_DOCUMENT_CONFIDENCE',
    ]);
    expect(d.reviewReason).toBe(IdentityReviewReason.LOW_IMAGE_QUALITY);
    expect(d.reviewPriority).toBe(2);
  });

  it('un motivo desconocido entra igual: quedarse fuera de toda bandeja es el fallo peor', () => {
    const d = outcomeForIdentityVerdict(IdentityDecision.REVIEW_REQUIRED, ['CODIGO_QUE_NO_EXISTE']);
    expect(d.status).toBe(WorkerRunStatus.PENDING_REVIEW);
    expect(d.reviewReason).toBe(IdentityReviewReason.MANUAL_REQUEST);
  });
});
