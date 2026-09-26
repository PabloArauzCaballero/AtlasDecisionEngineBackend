/**
 * Licitud de USO de los datos que alimentan una decisión.
 *
 * El catálogo ya clasificaba la sensibilidad de cada variable (`sensitivityClass`), pero eso
 * responde a «cuánto hay que proteger este dato», no a «puede este dato influir en el
 * resultado». Son ejes distintos y confundirlos dejaba el segundo sin ningún control: un
 * ingreso mensual es `CONFIDENTIAL` y perfectamente utilizable, mientras que la etnia puede
 * estar impecablemente protegida y aun así no poder tocar una decisión de crédito.
 *
 * Se comprueba al PUBLICAR y no en ejecución por la misma razón que el resto de validadores
 * del contrato: descubrirlo en la primera decisión real significa que ya se tomó una decisión
 * ilícita. Aquí el artefacto simplemente no llega a aprobarse.
 *
 * Las dos restricciones no se tratan igual, porque las normas no dicen lo mismo:
 *
 *  - `PROHIBITED_BASIS` — ECOA §1002.6(b)(9) y Regulation B prohíben que raza, color,
 *    religión, origen nacional, sexo, estado civil, edad o la recepción de asistencia
 *    pública influyan en una decisión crediticia. Es absoluto: no hay base legal ni
 *    configuración que lo habilite, así que el error no admite excepción.
 *  - `SPECIAL_CATEGORY` — LGPD art. 11 no prohíbe el dato sensible, lo condiciona a una base
 *    legal específica. Por eso se admite cuando la versión declara la suya, y se rechaza
 *    cuando no: lo que no puede pasar es que se use sin que nadie haya afirmado bajo qué
 *    amparo.
 */
import type { ArtifactGraphSnapshot, ValidationIssue } from '../graph.types';
import { issue } from './validation-issue';

export interface GraphDecisionUseResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

const PROHIBITED = 'PROHIBITED_BASIS';
const SPECIAL = 'SPECIAL_CATEGORY';

export function validateDecisionUse(snapshot: ArtifactGraphSnapshot): GraphDecisionUseResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Solo las ENTRADAS: una salida marcada como categoría especial es un resultado que el
  // artefacto produce, no un dato ajeno que consume, y ahí la restricción no aplica igual.
  const inputs = snapshot.variables.filter(
    (variable) => !String(variable.usageType ?? 'INPUT').startsWith('OUTPUT'),
  );
  const legalBasis = snapshot.version.legalBasis?.trim();

  for (const input of inputs) {
    const restriction = String(input.decisionUseRestriction ?? 'NONE').toUpperCase();

    if (restriction === PROHIBITED) {
      errors.push(
        issue(
          'PROHIBITED_BASIS_VARIABLE',
          `La entrada ${input.code} está marcada como base prohibida y no puede influir en una ` +
            'decisión (ECOA §1002.6(b)(9) / Regulation B). Retírala del contrato: no existe ' +
            'base legal que la habilite',
          'VARIABLE',
          input.code,
        ),
      );
      continue;
    }

    if (restriction === SPECIAL && !legalBasis) {
      errors.push(
        issue(
          'SPECIAL_CATEGORY_WITHOUT_LEGAL_BASIS',
          `La entrada ${input.code} es una categoría especial de datos personales y esta ` +
            'versión no declara base legal (LGPD art. 11). Declara `legalBasis` en la ' +
            'versión o retira la variable del contrato',
          'VARIABLE',
          input.code,
        ),
      );
    }
  }

  // La finalidad no bloquea —hay artefactos anteriores a que existiera el campo—, pero un
  // tratamiento sin finalidad declarada es un incumplimiento del principio del art. 6 I que
  // conviene ver antes de aprobar, no en la primera inspección.
  if (!snapshot.version.processingPurpose?.trim()) {
    warnings.push(
      issue(
        'PROCESSING_PURPOSE_NOT_DECLARED',
        'La versión no declara la finalidad del tratamiento (LGPD art. 6 I: finalidades ' +
          'legítimas, específicas y explícitas)',
        'VERSION',
        snapshot.version.id,
        'WARNING',
      ),
    );
  }

  return { errors, warnings };
}
