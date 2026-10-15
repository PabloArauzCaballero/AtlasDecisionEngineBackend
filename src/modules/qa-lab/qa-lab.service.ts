/**
 * QA Lab: generación y ejecución masiva reproducible (§10).
 *
 * Todo lo que hace falta para volver a ejecutar exactamente la misma corrida —semilla,
 * configuración, versión del generador, versión de las herramientas y una copia
 * congelada del contrato— se persiste con la corrida. Sin esa foto, un contraejemplo
 * archivado deja de reproducirse en cuanto alguien edita el contrato.
 *
 * Este servicio coordina el caso de uso; planificar, ejecutar, archivar y consultar corridas
 * viven en sus propios colaboradores.
 */
import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { GenerateQaRunDto, GenerateSampleCasesDto } from './qa-lab.dto';
import { describeOutcomes } from './outcome-coverage';
import { QaCaseObserverService } from './qa-case-observer.service';
import { QaCompiledArtifactService } from './qa-compiled-artifact.service';
import { inputContractOf } from './qa-contract';
import { QaFakersService } from './qa-fakers.service';
import { checkProperties } from './qa-properties';
import { presentRun } from './qa-run-presenter';
import { QaRunExecutorService } from './qa-run-executor.service';
import { QaRunHistoryService } from './qa-run-history.service';
import { QaRunPlannerService } from './qa-run-planner.service';
import { parseReplayKind } from './qa-run-summary';
import { buildSampleBatch, seedSequence, withFakers, type SampleBatch } from './sample-inputs';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Techo del listado de desenlaces: el enumerador de caminos ya no devuelve más. */
const MAX_OUTCOMES_LISTED = 200;

/**
 * Cuántas veces se repite un caso al reproducir un fallo de determinismo. Un resultado que
 * cambia entre ejecuciones puede no cambiar en la primera repetición; tres dan una
 * oportunidad razonable sin castigar al motor.
 */
const REPLAY_DETERMINISM_RUNS = 3;

@Injectable()
export class QaLabService {
  // Uno por servicio, no por petición: el contador separa dos pulsaciones caídas en el
  // mismo milisegundo, y reiniciarlo en cada llamada lo dejaría siempre en 1.
  private readonly nextSampleSeed = seedSequence('qa-lab-sample');

  constructor(
    private readonly prisma: PrismaService,
    private readonly compiledArtifacts: QaCompiledArtifactService,
    private readonly planner: QaRunPlannerService,
    private readonly history: QaRunHistoryService,
    private readonly executor: QaRunExecutorService,
    private readonly observer: QaCaseObserverService,
    @Optional() private readonly fakers?: QaFakersService,
  ) {}

  async run(
    tenantId: bigint,
    versionId: bigint,
    dto: GenerateQaRunDto,
    principal: AuthenticatedPrincipal,
  ) {
    // `environmentCode` ya no elige nada (ver `QA_LAB_ENVIRONMENT`), pero un cliente antiguo
    // que pida PROD sigue recibiendo el rechazo explícito en vez de un «sí» engañoso.
    if (dto.environmentCode?.toUpperCase() === 'PROD') {
      // Aislamiento DEV/PROD (§10.4, §13): una corrida generativa mete miles de
      // ejecuciones sintéticas; contra producción contaminaría métricas y datos reales.
      throw new DomainException(
        'QA_RUN_PROD_FORBIDDEN',
        'El QA Lab no puede ejecutarse contra PROD',
        HttpStatus.FORBIDDEN,
      );
    }

    const compiled = await this.compiledArtifacts.load(tenantId, versionId);
    const plan = await this.planner.plan(compiled, dto, versionId, principal.requestId);
    const run = await this.history.open(tenantId, versionId, compiled, plan, dto, principal);

    /*
     * La ejecución NO se espera: la respuesta sale ya, con la corrida en RUNNING, y quien
     * la lanzó consulta `getRun` hasta verla cerrada.
     *
     * Es la única forma de que `timeoutMs` signifique algo. Un interceptor global corta
     * TODA petición a los `REQUEST_TIMEOUT_MS` del despliegue (15 s de serie), así que
     * ejecutar el lote dentro de la petición hacía que doscientos casos murieran siempre
     * con `REQUEST_TIMEOUT` —y encima dejaban la fila en RUNNING y las ejecuciones
     * corriendo, porque cortar la respuesta no cancela el trabajo—. El formulario ofrecía
     * hasta 600 000 ms de una espera que nunca podía pasar de 15 000.
     */
    void this.executor.execute(tenantId, compiled, plan.batch, dto, run.id, plan.seed, principal);

    return presentRun(run, []);
  }

  /**
   * Valores de prueba de una versión, SIN ejecutarlos ni archivar corrida.
   *
   * Es el mismo lote que usa el simulador, pero con el contrato tomado de la versión
   * compilada en vez del despliegue: un caso de suite se guarda contra la versión que la
   * suite prueba, y generarlo contra otra dejaría casos que fallan por contrato el día que
   * alguien los ejecute.
   */
  async sampleInputs(
    tenantId: bigint,
    versionId: bigint,
    dto: GenerateSampleCasesDto,
  ): Promise<SampleBatch & { versionId: string }> {
    const compiled = await this.compiledArtifacts.load(tenantId, versionId);
    const inputs = inputContractOf(compiled);
    if (!inputs.length) {
      throw new DomainException(
        'ARTIFACT_HAS_NO_INPUTS',
        'La versión no declara variables de entrada, así que no hay valores que generar',
        HttpStatus.CONFLICT,
      );
    }
    return {
      // Igual que el simulador: con `kind: 'OUTCOMES'` el lote se construye recorriendo
      // el grafo, así que la versión compilada viaja entera y no sólo su contrato.
      ...(await withFakers(
        buildSampleBatch(inputs, dto, this.nextSampleSeed, compiled),
        inputs,
        this.fakers,
        compiled,
      )),
      versionId: versionId.toString(),
    };
  }

  /**
   * Desenlaces que el grafo de la versión alcanza de verdad, para poder repartir pesos
   * sobre ellos sin adivinar cómo se llaman.
   *
   * El portal los necesita para ofrecer el reparto: sin esta lista, escribir
   * `outcomeWeights` sería teclear claves a ciegas y descubrir el error al lanzar.
   */
  async listOutcomes(tenantId: bigint, versionId: bigint) {
    const compiled = await this.compiledArtifacts.load(tenantId, versionId);
    const items = describeOutcomes(compiled).slice(0, MAX_OUTCOMES_LISTED);
    return { versionId: versionId.toString(), items };
  }

  /** Vuelve a ejecutar un contraejemplo archivado contra la versión que lo produjo. */
  async replay(tenantId: bigint, counterexampleId: bigint) {
    const counterexample = await this.prisma.qaCounterexample.findFirst({
      where: { id: counterexampleId, tenantId },
      include: { qaRun: true },
    });
    if (!counterexample) {
      throw new DomainException(
        'QA_COUNTEREXAMPLE_NOT_FOUND',
        'Contraejemplo no encontrado',
        HttpStatus.NOT_FOUND,
      );
    }
    const compiled = await this.compiledArtifacts.load(
      tenantId,
      counterexample.qaRun.artifactVersionId,
    );
    const input = counterexample.shrunkInputJson as Record<string, unknown>;
    // Con la CLASE y la PROPIEDAD originales. Antes se reejecutaba siempre como VÁLIDO y sin
    // repetir: un «inválido aceptado» o un fallo de determinismo no podían reproducirse
    // nunca, y la pantalla anunciaba «la versión actual corrige este caso» sin haberlo
    // comprobado.
    const kind = parseReplayKind(counterexample.replayPath);
    const determinism = counterexample.property === 'DETERMINISM';
    const observation = await this.observer.observe(tenantId, compiled, input);
    const repeats = determinism
      ? await this.observer.repeatedSignatures(tenantId, compiled, input, REPLAY_DETERMINISM_RUNS)
      : [];
    const changed = repeats.find((signature) => signature !== observation.signature);
    const violations = checkProperties(
      { compiled, kind, input },
      observation,
      determinism ? (changed ?? observation.signature) : undefined,
    ).filter((entry) => entry.failureCode === counterexample.failureCode);
    return {
      id: counterexample.id.toString(),
      reproduced: violations.length > 0,
      kind,
      property: counterexample.property,
      executions: 1 + repeats.length,
      input,
      observation,
      violations,
    };
  }
}
