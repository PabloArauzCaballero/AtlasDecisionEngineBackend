/**
 * La exigencia de sujeto: lo único que impide seguir escribiendo evidencia irreparable.
 *
 * Cada caso de aquí corresponde a una forma concreta de perder el control:
 *  - que la versión pueda relajar lo que el ambiente exige;
 *  - que `NOT_APPLICABLE` sirva de puerta trasera sin que nadie escriba por qué;
 *  - que una política `NOT_APPLICABLE` tire una referencia que el integrador SÍ mandó.
 */
import { SubjectReferencePolicy } from '@prisma/client';
import { DomainException } from '../src/common/errors/domain-exception';
import {
  applySubjectPolicy,
  effectiveSubjectPolicy,
  validateVersionSubjectPolicy,
} from '../src/modules/runtime/subject-policy';

const { REQUIRED, WARN, NOT_APPLICABLE } = SubjectReferencePolicy;

describe('effectiveSubjectPolicy', () => {
  it('sin política de versión manda el ambiente', () => {
    expect(effectiveSubjectPolicy(REQUIRED, null, null)).toBe(REQUIRED);
    expect(effectiveSubjectPolicy(WARN, undefined, undefined)).toBe(WARN);
  });

  it('la versión puede endurecer un ambiente permisivo', () => {
    expect(effectiveSubjectPolicy(WARN, REQUIRED, null)).toBe(REQUIRED);
  });

  it('la versión NO puede relajar un ambiente que exige sujeto', () => {
    // Es la puerta trasera que este módulo existe para cerrar: quien publica el artefacto
    // podría desactivar un control del ambiente sin pasar por quien gobierna el ambiente.
    expect(effectiveSubjectPolicy(REQUIRED, WARN, null)).toBe(REQUIRED);
  });

  it('NOT_APPLICABLE sólo vale con justificación escrita', () => {
    expect(effectiveSubjectPolicy(REQUIRED, NOT_APPLICABLE, 'Regla de enrutado interno')).toBe(
      NOT_APPLICABLE,
    );
    // Sin motivo, se ignora y manda el ambiente: una exención sin explicar es un descuido, y
    // un descuido no puede desactivar un control.
    expect(effectiveSubjectPolicy(REQUIRED, NOT_APPLICABLE, null)).toBe(REQUIRED);
    expect(effectiveSubjectPolicy(REQUIRED, NOT_APPLICABLE, '   ')).toBe(REQUIRED);
  });
});

describe('applySubjectPolicy', () => {
  it('acepta la referencia y no marca ausencia', () => {
    expect(applySubjectPolicy(REQUIRED, ' ABC-1 ')).toEqual({
      subjectReference: 'ABC-1',
      absenceReason: null,
    });
  });

  it('rechaza con código estable cuando el ambiente lo exige', () => {
    expect(() => applySubjectPolicy(REQUIRED, undefined)).toThrow(DomainException);
    try {
      applySubjectPolicy(REQUIRED, '   ');
      fail('debería haber lanzado');
    } catch (error) {
      expect((error as DomainException).code).toBe('SUBJECT_REFERENCE_REQUIRED');
      expect((error as DomainException).status).toBe(400);
    }
  });

  it('distingue «faltó» de «no aplica»', () => {
    // Sin esta distinción la cobertura miente en las dos direcciones: cuenta como fallo las
    // reglas de sistema y esconde a los integradores que no migraron.
    expect(applySubjectPolicy(WARN, undefined).absenceReason).toBe(WARN);
    expect(applySubjectPolicy(NOT_APPLICABLE, undefined).absenceReason).toBe(NOT_APPLICABLE);
  });

  it('NOT_APPLICABLE no descarta una referencia que sí llegó', () => {
    // «No exijo sujeto» no es «prohíbo sujeto». Tirar el dato dejaría esa decisión sin forma
    // de atarse a su titular por una política que sólo hablaba de exigencia.
    expect(applySubjectPolicy(NOT_APPLICABLE, 'ABC-1')).toEqual({
      subjectReference: 'ABC-1',
      absenceReason: null,
    });
  });
});

describe('validateVersionSubjectPolicy', () => {
  it('exige justificación para NOT_APPLICABLE', () => {
    expect(validateVersionSubjectPolicy(NOT_APPLICABLE, null)).toEqual([
      expect.stringContaining('SUBJECT_POLICY_JUSTIFICATION_REQUIRED'),
    ]);
  });

  it('rechaza una justificación huérfana', () => {
    // Dejarla escrita con otra política hace creer que hay una exención que no existe.
    expect(validateVersionSubjectPolicy(REQUIRED, 'porque sí')).toEqual([
      expect.stringContaining('SUBJECT_POLICY_JUSTIFICATION_UNUSED'),
    ]);
  });

  it('acepta la pareja coherente', () => {
    expect(validateVersionSubjectPolicy(NOT_APPLICABLE, 'Enrutado interno')).toEqual([]);
    expect(validateVersionSubjectPolicy(null, null)).toEqual([]);
  });
});
