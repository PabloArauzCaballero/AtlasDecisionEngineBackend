/**
 * TRIAJE de las verificaciones de identidad: qué le pasó a cada persona, y qué falta por firmar.
 *
 *   yarn triaje:identidad                 # las últimas 24 h
 *   yarn triaje:identidad --dias 7
 *   yarn triaje:identidad --caso 75a058ab-296d-48b3-adcd-949edd25e384
 *
 * ## Por qué existe
 *
 * Durante una beta la pregunta que se repite es «¿qué le pasó al caso de esta persona?», y hasta
 * ahora la única forma de contestarla era leer el registro del contenedor línea a línea. El Mongo
 * donde iban esos registros está borrado —NXDOMAIN en todo el subdominio, no una caída—, así que
 * depurar significaba preguntarle al tester qué había visto.
 *
 * No hace falta más infraestructura: cada ejecución ya deja en su fila el estado, el veredicto, el
 * motivo, el parecido, la prueba de vida, qué campos se leyeron y cuánto tardó. Esto lo junta y lo
 * pone en una tabla.
 *
 * ## La alarma del final es la parte importante
 *
 * Lo que hace válido el corpus de la beta es que **ninguna verificación se resuelva sola**. Si
 * apareciera una con veredicto propio y sin firma de una persona, esas parejas dejan de medir a
 * nadie y hay que descartarlas. Este comando las busca y las cuenta; si hay alguna, sale con
 * código 1 para que un guion pueda pararse ahí.
 *
 * No escribe nada: sólo lee.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const args = process.argv.slice(2);
const valor = (bandera: string): string | undefined => {
  const i = args.indexOf(bandera);
  return i >= 0 ? args[i + 1] : undefined;
};

const caso = valor('--caso');
const dias = Number(valor('--dias') ?? 1);
if (!Number.isFinite(dias) || dias <= 0) {
  console.error('--dias tiene que ser un número de días mayor que cero.');
  process.exit(2);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Falta DATABASE_URL.');
  process.exit(2);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const desde = new Date(Date.now() - dias * 86_400_000);

/** Recorta a un ancho fijo para que la tabla se lea en un terminal. */
const col = (valor: unknown, ancho: number): string => {
  const texto = valor === null || valor === undefined ? '—' : String(valor);
  return texto.length > ancho ? `${texto.slice(0, ancho - 1)}…` : texto.padEnd(ancho);
};

interface Resultado {
  readonly decision?: string;
  readonly reasonCodes?: string[];
  readonly faceMatch?: { similarityScore?: number | null } | null;
  readonly liveness?: { outcome?: string | null; score?: number | null } | null;
  readonly fields?: Record<string, unknown> | null;
  readonly fraud?: { veredicto?: string | null } | null;
}

async function main(): Promise<void> {
  const filas = await prisma.identityVerificationRun.findMany({
    where: caso ? { requestId: caso } : { queuedAt: { gte: desde } },
    select: {
      requestId: true,
      status: true,
      decision: true,
      humanDecision: true,
      subjectKey: true,
      reviewReason: true,
      reviewResolvedBy: true,
      similarityScore: true,
      documentType: true,
      errorCode: true,
      errorMessage: true,
      resultJson: true,
      inputSource: true,
      queuedAt: true,
      startedAt: true,
      finishedAt: true,
      attemptCount: true,
    },
    orderBy: { queuedAt: 'desc' },
  });

  console.log(
    caso ? `\nCaso ${caso}` : `\nVerificaciones de las últimas ${dias * 24} h: ${filas.length}\n`,
  );
  if (filas.length === 0) {
    console.log('Nada que triar.');
    return;
  }

  console.log(
    `${col('caso', 10)} ${col('estado', 24)} ${col('veredicto', 16)} ${col('persona', 14)} ` +
      `${col('motivo', 22)} ${col('pare.', 7)} ${col('vida', 12)} ${col('campos', 7)} ${col('ms', 7)}`,
  );
  console.log('-'.repeat(126));

  let sinFirmar = 0;
  const resueltasSolas: string[] = [];
  const porEstado = new Map<string, number>();
  const porMotivo = new Map<string, number>();

  for (const f of filas) {
    const r = (f.resultJson ?? {}) as Resultado;
    const campos = r.fields ? Object.keys(r.fields).length : 0;
    const ms =
      f.startedAt && f.finishedAt ? f.finishedAt.getTime() - f.startedAt.getTime() : undefined;

    porEstado.set(f.status, (porEstado.get(f.status) ?? 0) + 1);
    if (f.reviewReason) porMotivo.set(f.reviewReason, (porMotivo.get(f.reviewReason) ?? 0) + 1);

    const enCola = f.status === 'PENDING_REVIEW' || f.status === 'IN_REVIEW';
    if (enCola) sinFirmar += 1;

    /*
     * Una verificación de SUBIDA que ya tiene veredicto y NADIE firmó es la que invalida el
     * corpus. Se excluyen los escenarios generados: sus imágenes no son de nadie y su veredicto
     * no pretende medir a ninguna persona.
     */
    if (
      f.inputSource === 'UPLOAD' &&
      f.decision !== null &&
      f.humanDecision === null &&
      !enCola &&
      f.status !== 'FAILED'
    ) {
      resueltasSolas.push(f.requestId);
    }

    console.log(
      `${col(f.requestId.slice(0, 8), 10)} ${col(f.status, 24)} ${col(f.decision, 16)} ` +
        `${col(f.humanDecision ? `${f.humanDecision}${f.subjectKey ? ` (${f.subjectKey})` : ''}` : null, 14)} ` +
        `${col(f.reviewReason ?? f.errorCode, 22)} ` +
        `${col(f.similarityScore === null ? null : Number(f.similarityScore).toFixed(4), 7)} ` +
        `${col(r.liveness?.outcome ? `${r.liveness.outcome} ${r.liveness.score ?? ''}`.trim() : null, 12)} ` +
        `${col(campos || null, 7)} ${col(ms, 7)}`,
    );
    if (caso && f.errorMessage) console.log(`\n  error: ${f.errorMessage.slice(0, 500)}`);
  }

  console.log('\nPor estado:');
  for (const [estado, n] of [...porEstado].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${col(estado, 26)} ${n}`);
  }
  if (porMotivo.size > 0) {
    console.log('\nPor motivo de revisión:');
    for (const [motivo, n] of [...porMotivo].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${col(motivo, 26)} ${n}`);
    }
  }

  const firmadas = filas.filter((f) => f.humanDecision !== null);
  const sujetos = new Set(firmadas.map((f) => f.subjectKey).filter(Boolean));
  console.log(
    `\nFirmadas por una persona: ${firmadas.length} (${sujetos.size} sujeto(s) declarado(s))` +
      `\nEsperando firma en la cola: ${sinFirmar}`,
  );
  // 66 genuinas de 20 sujetos es el punto en el que el falso rechazo baja del 5,4 %.
  const genuinas = firmadas.filter((f) => f.humanDecision === 'VERIFIED' && f.subjectKey).length;
  console.log(`Parejas genuinas utilizables: ${genuinas} de 66 · sujetos ${sujetos.size} de 20`);

  if (resueltasSolas.length > 0) {
    console.log(
      `\n⚠ ${resueltasSolas.length} verificación(es) con veredicto y SIN firma de una persona:`,
    );
    for (const id of resueltasSolas.slice(0, 20)) console.log(`   ${id}`);
    console.log(
      '\nEso invalida esas parejas como corpus. Revisa que no se haya encendido ningún umbral\n' +
        'ni el arbitraje por IA: durante la beta la etiqueta la pone una persona, siempre.',
    );
    process.exitCode = 1;
  } else {
    console.log('\n✓ Ninguna verificación se resolvió sola.');
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
