/**
 * Siembra el demo de llamada a servicio de worker Y TOMA UNA DECISIÓN con él, usando un
 * extracto bancario en PDF como entrada.
 *
 * Es el único seeder que no se limita a escribir filas: levanta el contexto real de la
 * aplicación y ejecuta la decisión por el mismo camino que una petición HTTP —resolución
 * de variables, motor, nodo `WORKER` llamando de verdad al servicio de extractos,
 * persistencia de la ejecución y auditoría—. Sembrar el artefacto y no ejecutarlo dejaría
 * sin demostrar justamente lo que se quiere enseñar: que la respuesta del worker llega al
 * motor como variables sobre las que el algoritmo razona.
 *
 * Uso:
 *   npx ts-node --transpile-only prisma/dev-seeds/seed-statement-worker-decision.ts [--pdf <ruta>] [--cuota <monto>] [--reseed]
 *
 * Sin `--pdf` usa el extracto de QA Bank que genera `qa-bank-statement.fixture.ts`: 42
 * movimientos, Bs 25.665,64 en abonos y Bs 4.639,33 en cargos sobre un saldo inicial de
 * Bs 8.425,70. Con `--pdf <ruta>` lee el archivo que se le indique.
 * Requiere `BANK_STATEMENT_WORKER_ENABLED=true`: es la misma bandera con la que el catálogo
 * publica la capacidad, y un nodo no puede usar un servicio que el despliegue declara apagado.
 */
import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../src/common/security/security.types';
import { RuntimeService } from '../../src/modules/runtime/runtime.service';
import { buildQaBankStatementPdf, QA_BANK_STATEMENT_FILE_NAME } from './qa-bank-statement.fixture';
import {
  STATEMENT_WORKER_DEMO_CODE,
  STATEMENT_WORKER_DEMO_VARIABLES as V,
} from '../../src/modules/seeding/data/statement-worker-demo.graph';
import { seedStatementWorkerDemoArtifact } from '../../src/modules/seeding/data/statement-worker-demo.seed';
import { resolveBootstrapTenantId } from '../../src/modules/seeding/data/helpers';

// Misma resolución que la siembra (`BOOTSTRAP_TENANT_ID`, con `SEED_TENANT_ID` de sinónimo):
// este script ejecuta el demo que sembró aquélla, así que ha de mirar el mismo tenant.
const TENANT = resolveBootstrapTenantId();

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const pdf = readPdf(options.pdfPath);

  if ((process.env.BANK_STATEMENT_WORKER_ENABLED ?? 'false') !== 'true') {
    throw new Error(
      'BANK_STATEMENT_WORKER_ENABLED debe valer true: el nodo llama al servicio de extractos, ' +
        'y el motor rechaza usar una capacidad que el despliegue declara apagada.',
    );
  }

  // Sin logger: la salida útil de este script es la decisión, no el arranque de Nest.
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const prisma = app.get(PrismaService);
    const seeded = await seedStatementWorkerDemoArtifact(prisma, { force: options.reseed });
    console.log(
      `= Artefacto ${STATEMENT_WORKER_DEMO_CODE} listo (versión ${seeded?.versionId ?? '?'}).`,
    );
    console.log(`= Documento: ${pdf.origen}.`);

    const runtime = app.get(RuntimeService);
    const requestId = `seed-extracto-${Date.now()}`;
    const { body } = await runtime.execute(
      TENANT,
      STATEMENT_WORKER_DEMO_CODE,
      {
        requestId,
        idempotencyKey: requestId,
        environmentCode: 'DEV',
        variables: {
          [V.documento]: pdf.base64,
          [V.nombreArchivo]: pdf.fileName,
          [V.cuota]: options.cuota,
        },
      },
      principal(requestId),
    );

    await report(prisma, body, options.cuota);
  } finally {
    await app.close();
  }
}

/**
 * Imprime lo que demuestra el demo: la llamada al servicio y la decisión que salió de ella.
 *
 * La traza se lee de la BASE, no del objeto en memoria, y a propósito: lo que importa
 * demostrar es que la llamada al worker quedó registrada como evidencia de la decisión,
 * no que el motor la tuvo un instante en una variable.
 */
async function report(
  prisma: PrismaService,
  body: Record<string, unknown>,
  cuota: number,
): Promise<void> {
  const executionId = String(body.executionId ?? '');
  const steps = executionId
    ? await prisma.decisionExecutionStep.findMany({
        where: { executionId: BigInt(executionId) },
        orderBy: { stepOrder: 'asc' },
        select: { stepOrder: true, branchTaken: true, evaluationResultJson: true, node: true },
      })
    : [];

  const call = steps.find((step) => step.node.nodeType === 'WORKER');
  console.log('\n--- Llamada al servicio (traza persistida) ------------------------');
  console.log(
    JSON.stringify(
      (call?.evaluationResultJson as { worker?: unknown })?.worker ?? {
        aviso: 'la ejecución no llegó al nodo de servicio',
      },
      null,
      2,
    ),
  );

  console.log('\n--- Decisión ------------------------------------------------------');
  console.log(`  Cuota solicitada   ${cuota}`);
  console.log(`  Estado             ${String(body.status)}`);
  console.log(`  Resultado          ${String(body.outcome)}`);
  console.log(`  Salida             ${JSON.stringify(body.output)}`);
  console.log(
    `  Nodos recorridos   ${steps.map((step) => step.node.nodeKey).join(' → ') || '(ninguno)'}`,
  );
  console.log(`  Ejecución          ${executionId}\n`);
}

function parseArguments(argv: string[]): { pdfPath?: string; cuota: number; reseed: boolean } {
  let pdfPath: string | undefined;
  let reseed = false;
  // Cubre el 90 % de los abonos mensuales del extracto de prueba: con él la decisión sale
  // aprobada, y subirlo por encima de un tercio de los abonos la lleva a las otras ramas.
  let cuota = 3_500;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--pdf' && argv[index + 1]) pdfPath = resolve(argv[index + 1]);
    if (argv[index] === '--cuota' && argv[index + 1]) cuota = Number(argv[index + 1]);
    if (argv[index] === '--reseed') reseed = true;
  }
  if (!Number.isFinite(cuota) || cuota <= 0) {
    throw new Error('--cuota debe ser un número mayor que cero.');
  }
  return { pdfPath, cuota, reseed };
}

/**
 * El documento de entrada: el archivo indicado, o el extracto de QA Bank generado.
 *
 * El fixture se genera en vez de versionar un binario porque un PDF en el repositorio es un
 * blob que nadie puede revisar en un diff, y porque así la huella del documento es la misma
 * en cada ejecución —que es lo que permite comprobar la deduplicación y la idempotencia.
 */
function readPdf(path?: string): { base64: string; fileName: string; origen: string } {
  if (!path) {
    return {
      base64: buildQaBankStatementPdf().toString('base64'),
      fileName: QA_BANK_STATEMENT_FILE_NAME,
      origen: 'extracto de QA Bank generado (42 movimientos)',
    };
  }
  try {
    return {
      base64: readFileSync(path).toString('base64'),
      fileName: basename(path),
      origen: path,
    };
  } catch {
    throw new Error(`No se pudo leer el extracto en ${path}.`);
  }
}

function principal(requestId: string): AuthenticatedPrincipal {
  return {
    id: 'system:seed-statement-worker-decision',
    tenantId: TENANT,
    roles: ['DECISION_CONSUMER'],
    audience: 'runtime',
    requestId,
    authMethod: 'jwt',
  };
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
