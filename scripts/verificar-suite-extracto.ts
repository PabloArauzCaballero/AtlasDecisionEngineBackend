/**
 * COMPRUEBA, sin Motor ni red, que la suite bloqueante de `EXTRACTO_CAPACIDAD_PAGO` pasa contra el
 * worker de extractos REAL.
 *
 *   yarn ts-node -P tsconfig.json -T scripts/verificar-suite-extracto.ts
 *
 * ## Para qué existe
 *
 * `scripts/extracto-capacidad-pago.mjs` crea una suite bloqueante con PDF de verdad, y una suite
 * bloqueante en rojo no se puede editar ni borrar por la API: la versión queda sin poder pasar a
 * revisión y hay que clonarla. Esto corre los MISMOS casos que el guion enviaría, con la misma clase
 * que usa el Motor para ejecutar una corrida de pruebas (`TestCaseExecutorService`), el invocador de
 * workers real y el motor de extractos real leyendo cada documento, y dice si pasan ANTES de crear
 * nada en ningún Motor.
 *
 * ## Por qué no es una prueba de Jest
 *
 * Porque leería PDF con `pdfjs-dist`, que se carga con un `import()` dinámico que en Jest sólo
 * funciona para UNA suite por proceso (la segunda falla con «Test environment has been torn down»
 * o `PDF_EXTRACTION_FAILED`), y `yarn test` corre todas en el mismo proceso: `bank-statement-
 * fixtures.spec.ts` ya es esa suite. Fuera de Jest —aquí, en Node de verdad— no hay ese límite.
 * La otra mitad, el algoritmo con el servicio doblado y los cuerpos que envía el guion, sí está en
 * Jest: `test/extracto-capacidad-pago.spec.ts`.
 *
 * ## Lo que comprueba y lo que no
 *
 * Corre la suite dos veces: con la configuración por defecto del worker (`.env.example`) y con la
 * exigencia de tres meses naturales completos ENCENDIDA, que es la variante más estricta. Sale con
 * código 1 si algún caso falla, si la cobertura de nodos baja del 80 % que exige el gate de revisión
 * o si el grafo no pasa la validación.
 *
 * NO es el Motor de ningún ambiente: el padrón de entidades es la nómina compilada de ASFI y la
 * configuración es la de `.env.example`. Un Motor con otra configuración (vigencia apagada, padrón
 * sin cargar, worker deshabilitado) puede comportarse distinto; eso sólo lo dice el guion contra él.
 */
import { ConfigService } from '@nestjs/config';
import { TestCaseRunStatus } from '@prisma/client';
import type { NestedTreeExecutionService } from '../src/modules/nested-trees/nested-tree-execution.service';
import { TestCaseExecutorService } from '../src/modules/testing/test-case-executor.service';
import { ASFI_SEED_REGISTRY } from '../src/modules/workers/bank-statement/core/institutions/institution-registry';
import type { InstitutionCatalogService } from '../src/modules/workers/bank-statement/institutions/institution-catalog.service';
import { WorkerServiceInvokerService } from '../src/modules/workers/worker-service-invoker.service';
import {
  cargarCuerpos,
  compilarLoQueEnviaElGuion,
  definicion,
  motor,
  resolvedor,
} from '../test/extracto-capacidad-pago.fixture';

/** Umbral de cobertura de NODOS que exige `TestExecutionService.verifyBlockingTests`. */
const COBERTURA_MINIMA = 80;

function invocador(sobrescribe: Record<string, unknown>): WorkerServiceInvokerService {
  const valores: Record<string, unknown> = {
    BANK_STATEMENT_WORKER_ENABLED: true,
    BANK_STATEMENT_RECENCY_ENFORCE: true,
    BANK_STATEMENT_ENFORCE_MINIMUM_MONTHS: false,
    BANK_STATEMENT_REQUIRE_LICENSED_ISSUER: true,
    BANK_STATEMENT_AUTHENTICITY_ENFORCE: true,
    ...sobrescribe,
  };
  return new WorkerServiceInvokerService(
    // Un doble y no `new ConfigService(valores)`: éste da prioridad a `process.env`, y un `.env`
    // local trae las banderas como texto (`'false'` es verdadero), lo que cambiaría el resultado.
    { get: (clave: string) => valores[clave] } as unknown as ConfigService,
    {} as never,
    {} as never,
    {
      ensureLoaded: () => Promise.resolve(),
      registryFor: () => ASFI_SEED_REGISTRY,
    } as unknown as InstitutionCatalogService,
    {} as never,
  );
}

async function correr(nombre: string, sobrescribe: Record<string, unknown>): Promise<boolean> {
  const { compilado, informe } = compilarLoQueEnviaElGuion();
  if (!informe.valid) {
    console.error(`El grafo no pasa la validación: ${JSON.stringify(informe.errors)}`);
    return false;
  }
  const casos = cargarCuerpos().casosDeLaSuite(definicion, { hoy: new Date() });
  const ejecutor = new TestCaseExecutorService(
    motor,
    resolvedor,
    { bind: () => undefined } as unknown as NestedTreeExecutionService,
    invocador(sobrescribe),
  );

  console.log(`\n== ${nombre}`);
  let verde = true;
  const visitados = new Set<string>();
  for (const [indice, caso] of casos.entries()) {
    const evaluado = await ejecutor.execute({
      tenantId: 1n,
      artifactCode: definicion.artifact.artifactCode,
      runId: 1n,
      payload: compilado,
      testCase: {
        id: BigInt(indice + 1),
        caseCode: caso.caseCode,
        inputJson: caso.input,
        expectedResultJson: caso.expectedResult,
      },
    });
    evaluado.visitedNodeKeys.forEach((nodo) => visitados.add(nodo));
    const paso = evaluado.resultStatus === TestCaseRunStatus.PASS;
    verde &&= paso;
    console.log(
      `  ${paso ? 'PASS' : 'FAIL'}  ${caso.caseCode.padEnd(44)} ${evaluado.terminalNodeKey ?? '(sin desenlace)'}`,
    );
    if (!paso) {
      for (const asercion of evaluado.assertions.filter((item) => !item.passed)) {
        console.log(
          `        ${asercion.path}: esperado ${JSON.stringify(asercion.expected)}, real ${JSON.stringify(asercion.actual)}`,
        );
      }
      if (evaluado.error) console.log(`        error: ${JSON.stringify(evaluado.error)}`);
    }
  }
  const total = Object.keys(compilado.nodes).length;
  const cobertura = (visitados.size / total) * 100;
  console.log(`  Cobertura de nodos: ${visitados.size}/${total} (${cobertura.toFixed(1)} %)`);
  if (cobertura < COBERTURA_MINIMA) {
    console.log(`  ✗ por debajo del ${COBERTURA_MINIMA} % que exige el gate de revisión`);
    verde = false;
  }
  return verde;
}

async function main(): Promise<void> {
  const porDefecto = await correr('Configuración por defecto del worker (.env.example)', {});
  const estricta = await correr('Con BANK_STATEMENT_ENFORCE_MINIMUM_MONTHS=true', {
    BANK_STATEMENT_ENFORCE_MINIMUM_MONTHS: true,
  });
  console.log(
    `\n${porDefecto && estricta ? 'La suite pasa en las dos configuraciones.' : 'La suite NO pasa: no la crees en un Motor hasta arreglarlo.'}`,
  );
  process.exitCode = porDefecto && estricta ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
