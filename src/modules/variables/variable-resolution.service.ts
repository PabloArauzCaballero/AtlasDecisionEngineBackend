import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HashService } from '../../common/crypto/hash.service';
import { MetricsService } from '../../common/observability/metrics.service';
import { safeRegexTest } from '../../common/validation/safe-regex';
import type { VariableContractSnapshot } from '../graph/graph.types';

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

    const snapshots: ResolvedVariableSnapshot[] = [];
    const errors: VariableResolutionResult['errors'] = [];
    for (const contract of contracts) {
      let value = values[contract.code];
      let defaulted = false;
      let sourceCode = value === undefined ? 'UNRESOLVED' : 'REQUEST_PAYLOAD';

      if (
        value === undefined &&
        contract.defaultValue !== undefined &&
        contract.fallbackPolicy !== 'FAIL'
      ) {
        value = contract.defaultValue;
        values[contract.code] = value;
        defaulted = true;
        sourceCode = 'DEFAULT';
      }

      if (value === undefined || value === null) {
        if (contract.required && !contract.nullable) {
          errors.push({
            code: 'VARIABLE_MISSING_OR_INVALID',
            variable: contract.code,
            message: `Required variable ${contract.code} is missing`,
          });
          continue;
        }
      } else {
        const validationErrors = this.validateValue(contract, value);
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
        wasDefaulted: defaulted,
        sensitive: contract.sensitive,
      });
    }
    return { valid: errors.length === 0, values, snapshots, errors };
  }

  private validateValue(contract: VariableContractSnapshot, value: unknown): string[] {
    const errors: string[] = [];
    const type = contract.dataType.toUpperCase();
    const validType =
      (['STRING', 'TEXT', 'UUID', 'DATE', 'DATETIME'].includes(type) &&
        typeof value === 'string') ||
      (['INTEGER', 'INT'].includes(type) && typeof value === 'number' && Number.isInteger(value)) ||
      (['NUMBER', 'DECIMAL', 'FLOAT'].includes(type) &&
        typeof value === 'number' &&
        Number.isFinite(value)) ||
      (['BOOLEAN', 'BOOL'].includes(type) && typeof value === 'boolean') ||
      (type === 'ARRAY' && Array.isArray(value)) ||
      (type === 'OBJECT' && value !== null && typeof value === 'object' && !Array.isArray(value));
    if (!validType) errors.push(`${contract.code} must be of type ${contract.dataType}`);

    const schema = (contract.validationSchema ?? {}) as Record<string, unknown>;
    if (typeof value === 'number') {
      if (typeof schema.minimum === 'number' && value < schema.minimum)
        errors.push(`${contract.code} is below minimum ${schema.minimum}`);
      if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum)
        errors.push(`${contract.code} must be greater than ${schema.exclusiveMinimum}`);
      if (typeof schema.maximum === 'number' && value > schema.maximum)
        errors.push(`${contract.code} is above maximum ${schema.maximum}`);
      if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum)
        errors.push(`${contract.code} must be lower than ${schema.exclusiveMaximum}`);
    }
    if (typeof value === 'string') {
      if (typeof schema.minLength === 'number' && value.length < schema.minLength)
        errors.push(`${contract.code} is shorter than ${schema.minLength}`);
      if (typeof schema.maxLength === 'number' && value.length > schema.maxLength)
        errors.push(`${contract.code} is longer than ${schema.maxLength}`);
      if (typeof schema.pattern === 'string' && !safeRegexTest(schema.pattern, value).matched)
        errors.push(`${contract.code} does not match required pattern`);
    }
    if (Array.isArray(schema.enum) && !schema.enum.includes(value))
      errors.push(`${contract.code} is outside the allowed enum`);

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
      return body.values ?? {};
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
