import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain-exception';
import { HashService } from '../../common/crypto/hash.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ResolvedDeployment } from '../deployments/deployment-resolver.service';
import type { EngineExecutionResult } from '../graph/graph.types';
import { DecisionGuardService, type GuardVerdict } from '../risk-governance/decision-guard.service';
import {
  EnablingBasisPolicyError,
  parseUndeclaredBasisMode,
  resolveEnablingBasisPolicy,
  type EnablingBasisPolicy,
} from '../risk-governance/enabling-basis';
import type { RoleViolation } from '../risk-governance/semantic-outputs';
import type { SubjectPolicyOutcome } from './subject-policy';

/**
 * Cuanto pide esta solicitud, para proyectar la exposicion.
 *
 * Se busca entre unos pocos nombres corrientes y se devuelve 0 si no aparece ninguno. Un 0 hace
 * que el limite se compruebe contra la exposicion ACTUAL, que sigue siendo una comprobacion util:
 * el que ya esta por encima del techo no recibe mas. Inventar un importe seria peor.
 */
const AMOUNT_FIELDS = ['requested_amount', 'requestedAmount', 'monto_solicitado', 'loan_amount'];

export function requestedAmountOf(variables: Record<string, unknown>): number {
  for (const field of AMOUNT_FIELDS) {
    const value = variables[field];
    const numeric = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
}

/**
 * Las condiciones que no dependen del solicitante ni del grafo: apetito de cartera, base
 * habilitante vigente y rango de las salidas económicas.
 */
@Injectable()
export class DecisionSafeguardsService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly hashes: HashService,
    private readonly guard: DecisionGuardService,
  ) {}

  /** Apetito de cartera y base habilitante, ANTES de resolver variables y de ejecutar. */
  async checkBeforeDecision(input: {
    tenantId: bigint;
    deployment: ResolvedDeployment;
    subject: SubjectPolicyOutcome;
    variables: Record<string, unknown>;
    now: Date;
  }): Promise<GuardVerdict> {
    const { tenantId, deployment, subject, variables, now } = input;
    return this.guard.checkBeforeDecision({
      tenantId,
      subjectId: await this.subjectIdOf(tenantId, subject.subjectReference),
      subjectReferencePresent: Boolean(subject.subjectReference),
      requestedAmount: requestedAmountOf(variables),
      basisPolicy: this.basisPolicyFor(deployment),
      now,
    });
  }

  /**
   * El rango de las salidas economicas se comprueba DESPUES de ejecutar y no al compilar: el valor
   * lo produce un script en tiempo de ejecucion, y al compilar solo existe la promesa.
   */
  reviewOutputs(
    tenantId: bigint,
    deployment: ResolvedDeployment,
    result: EngineExecutionResult,
  ): Promise<RoleViolation[]> {
    return this.guard.reviewOutputs(
      tenantId,
      deployment.artifactVersionId,
      result.output as Record<string, unknown> | undefined,
      { limit: result.limit },
    );
  }

  /**
   * La politica de base habilitante de este despliegue.
   *
   * Una politica declarada que no se puede interpretar falla CERRADO y de forma determinista: es
   * un defecto de la version, no una razon para decidir sin control.
   */
  private basisPolicyFor(deployment: ResolvedDeployment): EnablingBasisPolicy {
    try {
      return resolveEnablingBasisPolicy({
        declared: deployment.enablingBasisPolicy,
        legalBasis: deployment.legalBasis,
        riskDomain: deployment.riskDomain,
        isProductionEnvironment: deployment.isProductionEnvironment,
        undeclaredMode: parseUndeclaredBasisMode(
          this.config.get<string>('ENABLING_BASIS_UNDECLARED_ORIGINATION'),
        ),
      });
    } catch (error) {
      if (error instanceof EnablingBasisPolicyError) {
        throw new DomainException(
          'ENABLING_BASIS_POLICY_INVALID',
          error.message,
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  /**
   * El sujeto ya resuelto, si esta decision lleva solicitante y ya se le decidio antes.
   *
   * Devuelve `null` la primera vez que se ve a alguien, y eso es correcto: sin historial no hay
   * exposicion acumulada que comprobar ni permisos que hayan podido vencer.
   */
  private async subjectIdOf(tenantId: bigint, subjectReference?: string): Promise<bigint | null> {
    if (!subjectReference) return null;
    const subject = await this.prisma.decisionSubject.findFirst({
      where: { tenantId, subjectReferenceHash: this.hashes.hmac(subjectReference) },
      select: { id: true },
    });
    return subject?.id ?? null;
  }
}
