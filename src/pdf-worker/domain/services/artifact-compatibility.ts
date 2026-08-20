/**
 * ¿Puede este artefacto alimentar este documento?
 *
 * La regla es una sola frase: **todo campo OBLIGATORIO del template tiene que
 * estar en el contrato de salida del artefacto, y con un tipo que encaje.** Si
 * falta uno, la pareja no sirve — y es mejor saberlo al vincularlos que el día
 * que una decisión real intente imprimirse y reciba un 422.
 *
 * Lo que NO es un problema, y por eso se informa aparte:
 *
 *  · Un campo del artefacto que el template no usa. Un artefacto publica su
 *    salida completa y cada documento cuenta una parte; exigir que se use todo
 *    obligaría a un template por artefacto, que es justo lo contrario de lo que
 *    se busca (un artefacto puede tener varios documentos).
 *  · Un campo OPCIONAL del template que el artefacto no produce. Es opcional:
 *    el documento sale sin esa sección.
 *
 * Y lo que se informa como ADVERTENCIA y no como fallo: un tipo `unknown`. El
 * motor no siempre puede resolver el tipo de un campo del contrato de salida
 * —lo hereda de la variable que lo produce— y rechazar la pareja por eso sería
 * castigar una limitación del emisor. Se deja pasar diciendo que no se pudo
 * comprobar, que es distinto de decir que está bien.
 */
import type { TemplateFieldDescriptor } from '../contracts/template-contract';

export type CompatibilitySeverity = 'error' | 'warning';

export interface CompatibilityFinding {
  readonly field: string;
  readonly severity: CompatibilitySeverity;
  readonly problem: string;
  readonly expected?: string;
  readonly found?: string;
}

export interface CompatibilityReport {
  readonly compatible: boolean;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly artifactId: string;
  readonly artifactVersion: string;
  /** Campos del template que el artefacto sí produce. */
  readonly matched: readonly string[];
  /** Campos del artefacto que este documento no usa. No es un problema. */
  readonly unusedByTemplate: readonly string[];
  readonly findings: readonly CompatibilityFinding[];
}

/** Tipo del artefacto → tipos del template que lo aceptan. */
const ACEPTA: Readonly<Record<string, readonly string[]>> = {
  string: ['string', 'enum', 'date'],
  // Un entero cabe donde se espera un número; al revés no: un decimal en un
  // campo declarado entero es un dato que el contrato del template rechaza.
  integer: ['integer', 'number'],
  number: ['number'],
  boolean: ['boolean'],
  date: ['date', 'string'],
  enum: ['enum', 'string'],
  array: ['array'],
  object: ['object'],
};

export interface ArtifactFieldView {
  readonly fieldCode: string;
  readonly type: string;
  readonly required: boolean;
  readonly allowedValues?: readonly string[];
}

export interface CompatibilityInput {
  readonly templateId: string;
  readonly templateVersion: string;
  readonly templateFields: Readonly<Record<string, TemplateFieldDescriptor>>;
  readonly artifactId: string;
  readonly artifactVersion: string;
  readonly artifactFields: readonly ArtifactFieldView[];
}

export function checkCompatibility(input: CompatibilityInput): CompatibilityReport {
  const porCodigo = new Map(input.artifactFields.map((field) => [field.fieldCode, field]));
  const findings: CompatibilityFinding[] = [];
  const matched: string[] = [];

  for (const [name, descriptor] of Object.entries(input.templateFields)) {
    const salida = porCodigo.get(name);

    if (!salida) {
      if (descriptor.required) {
        findings.push({
          field: name,
          severity: 'error',
          problem: 'el artefacto no publica este campo y el documento lo exige',
          expected: descriptor.type,
        });
      }
      continue;
    }

    matched.push(name);

    if (salida.type === 'unknown') {
      findings.push({
        field: name,
        severity: 'warning',
        problem:
          'el motor no pudo resolver el tipo de este campo; la compatibilidad no se comprobó',
        expected: descriptor.type,
        found: 'unknown',
      });
      continue;
    }

    const admitidos = ACEPTA[salida.type] ?? [];
    if (!admitidos.includes(descriptor.type)) {
      findings.push({
        field: name,
        severity: 'error',
        problem: 'el tipo que publica el artefacto no encaja con el que exige el documento',
        expected: descriptor.type,
        found: salida.type,
      });
      continue;
    }

    // Un campo obligatorio del documento alimentado por uno que el artefacto
    // puede no emitir: el documento fallaría en las decisiones donde falte. Es
    // advertencia y no error porque depende del caso, no de la pareja.
    if (descriptor.required && !salida.required) {
      findings.push({
        field: name,
        severity: 'warning',
        problem:
          'el documento lo exige pero el artefacto puede no emitirlo; habrá decisiones que no se puedan imprimir',
      });
    }

    // El documento acota los valores y el artefacto puede emitir otros: se
    // señala el conjunto sobrante, que es lo que hay que mapear o ampliar.
    if (descriptor.type === 'enum' && descriptor.values && salida.allowedValues) {
      const admitidosEnum = new Set(descriptor.values);
      const sobran = salida.allowedValues.filter((valor) => !admitidosEnum.has(valor));
      if (sobran.length > 0) {
        findings.push({
          field: name,
          severity: 'error',
          problem: 'el artefacto puede emitir valores que el documento no admite',
          expected: descriptor.values.join(' · '),
          found: sobran.join(' · '),
        });
      }
    }
  }

  const usados = new Set(Object.keys(input.templateFields));
  return {
    compatible: findings.every((finding) => finding.severity !== 'error'),
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    artifactId: input.artifactId,
    artifactVersion: input.artifactVersion,
    matched,
    unusedByTemplate: input.artifactFields
      .filter((field) => !usados.has(field.fieldCode))
      .map((field) => field.fieldCode),
    findings,
  };
}
