import { Injectable, Logger } from '@nestjs/common';
import { FreshnessPolicy } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { HashService } from '../../common/crypto/hash.service';
import { MetricsService } from '../../common/observability/metrics.service';
import { safeRegexTest } from '../../common/validation/safe-regex';
import {
  isRequiredIn,
  parseConstraints,
  validateAgainstConstraints,
} from '../../common/contracts/constraint-engine';
import type { ConstraintScope } from '../../common/contracts/constraints.types';
import type { VariableContractSnapshot } from '../graph/graph.types';
import { evaluateFreshness, type FreshnessVerdict } from './freshness';


/** Persistable evidence describing how one variable was resolved. */
export interface ResolvedVariableSnapshot {
  variableVersionId: string;
  code: string;
  value: unknown;
  storedValue: unknown;
  valueHash: string;
  sourceCode: string;
  resolutionStatus: string;
  wasDefaulted: boolean;
  sensitive: boolean;
  /** De cuando era cierto el valor, y cuanto habia envejecido al decidir. Ver `freshness.ts`. */
  freshness?: FreshnessVerdict;
}

/** Resolved engine input plus validation and audit evidence. */
export interface VariableResolutionResult {
  valid: boolean;
  values: Record<string, unknown>;
  snapshots: ResolvedVariableSnapshot[];
  errors: Array<{ code: string; variable: string; message: string }>;
}

/**
 * Resolves declared variable contracts from request input, defaults and an optional provider.
 *
 * Undeclared request fields never enter the engine, and sensitive values are represented by
 * hashes in persisted snapshots.
 */
@Injectable()
export class VariableResolutionService {
  private readonly logger = new Logger(VariableResolutionService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly hashes: HashService,
    private readonly metrics: MetricsService,
  ) {}

  /** Resolves and validates every declared contract in deterministic contract order. */
  async resolve(
    contracts: VariableContractSnapshot[],
    input: Record<string, unknown>,
    options: {
      tenantId: bigint;
      artifactCode: string;
      requestId: string;
      allowExternal: boolean;
      /** Ejes de despliegue con los que se resuelven las restricciones acotadas (§1.1). */
      scope?: ConstraintScope;
      /**
       * De cuando es cada valor, por codigo. Quien entrega el dato es quien sabe cuando era
       * cierto; el motor no puede adivinarlo y no debe suponerlo.
       */
      metadata?: Record<string, unknown>;
    },
  ): Promise<VariableResolutionResult> {
    // Reject hidden inputs by construction: only declared, versioned contracts enter the engine.
    const values: Record<string, unknown> = Object.fromEntries(
      contracts
        .filter((contract) => Object.prototype.hasOwnProperty.call(input, contract.code))
        .map((contract) => [contract.code, input[contract.code]]),
    );
    const externalMissing = contracts
      .filter((contract) => values[contract.code] === undefined && contract.required)
      .map((contract) => contract.code);

    if (options.allowExternal && externalMissing.length) {
      const external = await this.fetchExternalValues(externalMissing, options);
      Object.assign(values, external);
    }

    // Los valores por defecto se aplican ANTES de validar nada: una regla condicional
    // ("obligatorio si país = BO") tiene que ver el contrato completo, no el estado
    // parcial del bucle. Validar y defaultear en la misma pasada hacía que el
    // resultado dependiera del orden de las variables.
    const defaulted = new Set<string>();
    for (const contract of contracts) {
      if (
        values[contract.code] === undefined &&
        contract.defaultValue !== undefined &&
        contract.fallbackPolicy !== 'FAIL'
      ) {
        values[contract.code] = contract.defaultValue;
        defaulted.add(contract.code);
      }
    }

    const snapshots: ResolvedVariableSnapshot[] = [];
    const errors: VariableResolutionResult['errors'] = [];
    for (const contract of contracts) {
      const value = values[contract.code];
      const sourceCode = defaulted.has(contract.code)
        ? 'DEFAULT'
        : value === undefined
          ? 'UNRESOLVED'
          : 'REQUEST_PAYLOAD';

      if (value === undefined || value === null) {
        const constraints = parseConstraints(contract.constraints ?? contract.validationSchema);
        const required = isRequiredIn(contract.required, constraints, {
          ...options.scope,
          siblings: values,
        });
        if (required && !contract.nullable) {
          errors.push({
            code: 'VARIABLE_MISSING_OR_INVALID',
            variable: contract.code,
            message: contract.validationMessage ?? `Required variable ${contract.code} is missing`,
          });
          continue;
        }
      } else {
        const validationErrors = this.validateValue(contract, value, values, options.scope);
        errors.push(
          ...validationErrors.map((message) => ({
            code: 'VARIABLE_MISSING_OR_INVALID',
            variable: contract.code,
            message,
          })),
        );
      }

      // Sensitive values are often low-entropy PII (an age, an ID, a boolean), for which a
      // bare SHA-256 is reversible by brute force or rainbow tables. HMAC keys the digest
      // with a secret pepper so the stored hash cannot be reversed without it (plan §2.7 /
      // D-7). Non-sensitive values keep the plain, key-independent hash.
      const valueHash = contract.sensitive
        ? this.hashes.hmac({ code: contract.code, value })
        : this.hashes.sha256({ code: contract.code, value });

      /*
       * La frescura se juzga sobre lo que el llamante DECLARO, no sobre cuando llego la peticion.
       * Un valor sin fecha declarada no se considera viejo: ver `freshness.ts` para el porque.
       *
       * El SLA sale de la fuente MAS EXIGENTE de la variable. Si una variable se puede obtener de
       * dos sitios y uno promete 60 s, ese es el compromiso que el artefacto asumio; quedarse con
       * el mas laxo convertiria la declaracion estricta en decorativa.
       */
      const freshness = evaluateFreshness(
        (options.metadata?.[contract.code] ?? undefined) as never,
        strictestSla(contract.sources),
        freshnessPolicyOf(contract.fallbackPolicy),
      );
      if (freshness.reject) {
        errors.push({
          code: 'VARIABLE_STALE',
          variable: contract.code,
          message:
            `El valor de ${contract.code} tenia ${freshness.ageSeconds} s cuando su compromiso de ` +
            `frescura es de ${strictestSla(contract.sources)} s. Un dato viejo aqui no es menos ` +
            `preciso: es la respuesta a otra pregunta.`,
        });
      }

      snapshots.push({
        variableVersionId: contract.variableVersionId,
        code: contract.code,
        value,
        storedValue: contract.sensitive ? null : value,
        valueHash,
        sourceCode,
        resolutionStatus: errors.some((error) => error.variable === contract.code)
          ? 'INVALID'
          : 'RESOLVED',
        wasDefaulted: defaulted.has(contract.code),
        sensitive: contract.sensitive,
        freshness,
      });
    }
    return { valid: errors.length === 0, values, snapshots, errors };
  }

  private validateValue(
    contract: VariableContractSnapshot,
    value: unknown,
    siblings: Record<string, unknown>,
    scope: ConstraintScope | undefined,
  ): string[] {
    const errors: string[] = [];
    // Restricciones normalizadas (§1.1). `constraints` es la fuente autoritativa;
    // `validationSchema` se sigue leyendo para contratos anteriores a la migración.
    const constraints = parseConstraints(contract.constraints ?? contract.validationSchema);
    const violations = validateAgainstConstraints(contract.dataType, constraints, value, {
      ...scope,
      siblings,
    });
    for (const violation of violations) {
      // §12: qué restricción se incumple, no solo cuántas veces falla la variable.
      this.metrics.recordContractViolation('INPUT', violation.constraint);
      errors.push(
        contract.validationMessage
          ? `${contract.code}: ${contract.validationMessage}`
          : `${contract.code} ${violation.message}`,
      );
    }

    for (const rule of contract.validationRules) {
      const config = rule.config as Record<string, unknown>;
      switch (rule.ruleType.toUpperCase()) {
        case 'MIN':
          if (typeof value === 'number' && value < Number(config.value))
            errors.push(`${rule.errorCode}: below minimum`);
          break;
        case 'MAX':
          if (typeof value === 'number' && value > Number(config.value))
            errors.push(`${rule.errorCode}: above maximum`);
          break;
        case 'REGEX':
          if (typeof value === 'string' && !safeRegexTest(String(config.pattern), value).matched)
            errors.push(`${rule.errorCode}: pattern mismatch`);
          break;
        case 'ENUM':
          if (Array.isArray(config.values) && !config.values.includes(value))
            errors.push(`${rule.errorCode}: value not allowed`);
          break;
      }
    }
    return errors;
  }

  private async fetchExternalValues(
    codes: string[],
    options: { tenantId: bigint; artifactCode: string; requestId: string },
  ): Promise<Record<string, unknown>> {
    const url = this.config.get<string>('VARIABLE_BACKEND_URL');
    if (!url) return {};
    const timeoutMs = this.config.get<number>('VARIABLE_BACKEND_TIMEOUT_MS') ?? 1500;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${url.replace(/\/$/, '')}/v1/variables/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId: options.tenantId.toString(),
          artifactCode: options.artifactCode,
          requestId: options.requestId,
          variableCodes: codes,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        // A backend that is up but rejecting the request is not the same as "no data":
        // record it so an outage does not hide behind silently missing variables. The
        // caller still degrades to defaults/validation, but the failure is now observable.
        this.reportFailure(`http_${response.status}`, codes, options);
        return {};
      }
      const body = (await response.json()) as { values?: Record<string, unknown> };
      const returned = body.values;
      if (!returned || typeof returned !== 'object' || Array.isArray(returned)) return {};
      // Solo se acepta lo que se pidió. Sin este filtro, el proveedor podía introducir
      // códigos que el artefacto no declara —que entrarían al contexto del motor por la
      // puerta de atrás— y, peor, sobrescribir un valor que sí venía en la petición del
      // cliente. Se consulta únicamente por lo que falta, así que devolver otra cosa
      // nunca es legítimo.
      const requested = new Set(codes);
      return Object.fromEntries(
        Object.entries(returned).filter(
          ([code, value]) => requested.has(code) && value !== undefined,
        ),
      );
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'unreachable';
      this.reportFailure(reason, codes, options);
      return {};
    } finally {
      clearTimeout(timer);
    }
  }

  private reportFailure(
    reason: string,
    codes: string[],
    options: { tenantId: bigint; artifactCode: string; requestId: string },
  ): void {
    this.metrics.recordProviderFailure('variable_backend', reason);
    this.logger.warn({
      event: 'VARIABLE_BACKEND_RESOLUTION_FAILED',
      reason,
      artifactCode: options.artifactCode,
      requestId: options.requestId,
      variableCount: codes.length,
    });
  }
}

/**
 * El compromiso de frescura MAS EXIGENTE entre las fuentes declaradas de una variable.
 *
 * Cero significa «sin SLA declarado» y es el valor con el que estan sembradas casi todas las
 * fuentes, asi que se ignora al buscar el minimo: quedarse con el cero haria que una variable con
 * dos fuentes -una estricta y otra sin declarar- perdiera su compromiso por tener companiia.
 */
function strictestSla(sources: Array<{ freshnessSlaSeconds: number }>): number {
  const declared = sources.map((source) => source.freshnessSlaSeconds).filter((sla) => sla > 0);
  return declared.length ? Math.min(...declared) : 0;
}

/**
 * La politica de frescura que aplica a una variable.
 *
 * Se deriva de `fallbackPolicy` mientras el compilado no la transporte por separado: una variable
 * cuyo fallo es FATAL (`FAIL`) tampoco puede decidirse con un dato caducado, y una que admite
 * respaldo tampoco deberia caerse por antiguedad. Es una aproximacion declarada, no una
 * casualidad: la columna `freshness_policy` ya existe en el esquema y este mapeo se sustituye por
 * ella en cuanto el compilador la incluya.
 */
function freshnessPolicyOf(fallbackPolicy: string): FreshnessPolicy {
  return fallbackPolicy === 'FAIL' ? FreshnessPolicy.REJECT : FreshnessPolicy.DEGRADE;
}
