/**
 * EXPORTA las verificaciones que una persona ya firmó, en la carpeta que el calibrador lee.
 *
 *   yarn exportar:corpus-identidad ~/corpus-beta
 *   yarn exportar:corpus-identidad ~/corpus-beta --desde 2026-09-15
 *
 * ## Por qué existe
 *
 * La beta no se monta para recoger fotos: se monta para recoger PAREJAS ETIQUETADAS. Cada caso que
 * pasa por la cola deja tres cosas —el documento, la selfie y lo que una persona firmó sobre
 * ellos— y eso es exactamente una fila de corpus. Este comando las junta.
 *
 * El protocolo del corpus de identidad lo pide así: la verdad la «etiqueta el operador; jamás por
 * score del worker». Por eso aquí sólo entra lo que tiene `humanDecision`, y nunca el veredicto
 * del motor: calibrar contra el propio motor es medir cuánto se parece a sí mismo.
 *
 * ## Lo que NO hace
 *
 * No calibra —eso es `calibrar-identidad.mjs`—, no toca la base y no borra nada del almacén.
 * Escribe en el directorio que se le pasa y en ningún otro sitio.
 *
 * ## Privacidad
 *
 * Las carpetas se nombran por el identificador SEUDÓNIMO que puso quien revisó (`T-07`): ni
 * nombres ni números de cédula. El destino queda fuera del repositorio a propósito; ningún medio
 * real entra en Git.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { ObjectStorageService } from '../src/common/storage/object-storage.service';

const [destinoArg, ...resto] = process.argv.slice(2);
if (!destinoArg) {
  console.error(
    'Uso: yarn exportar:corpus-identidad <directorio> [--desde YYYY-MM-DD]\n' +
      'El directorio se crea si no existe, y NO debe estar dentro del repositorio.',
  );
  process.exit(2);
}
const destino = resolve(destinoArg);
const desdeArg = resto.indexOf('--desde');
const desde = desdeArg >= 0 ? new Date(`${resto[desdeArg + 1]}T00:00:00Z`) : null;

const prisma = new PrismaClient();
const storage = new ObjectStorageService(new ConfigService(process.env));

/** La etiqueta, tal como el calibrador la necesita: el documento primero, las selfies después. */
const NOMBRE_DOCUMENTO = 'carnet';

async function main(): Promise<void> {
  if (!storage.isConfigured()) {
    console.error(
      'No hay almacén configurado, así que no hay imágenes que exportar. Declara STORAGE_S3_*.',
    );
    process.exit(2);
  }

  const filas = await prisma.identityVerificationRun.findMany({
    where: {
      humanDecision: { not: null },
      documentObjectKey: { not: null },
      selfieObjectKey: { not: null },
      ...(desde ? { reviewResolvedAt: { gte: desde } } : {}),
    },
    select: {
      requestId: true,
      subjectKey: true,
      humanDecision: true,
      decision: true,
      similarityScore: true,
      reviewReason: true,
      reviewResolvedAt: true,
      documentObjectKey: true,
      selfieObjectKey: true,
      documentSha256: true,
      selfieSha256: true,
    },
    orderBy: { reviewResolvedAt: 'asc' },
  });

  if (filas.length === 0) {
    console.log('No hay ninguna verificación firmada todavía. Nada que exportar.');
    return;
  }

  let sinSujeto = 0;
  const manifiesto: Record<string, unknown>[] = [];
  const porSujeto = new Map<string, number>();

  for (const fila of filas) {
    /*
     * Un caso sin sujeto declarado NO se agrupa con nadie, y eso se cuenta y se dice. Meterlo en
     * una carpeta propia lo convertiría, frente a los demás casos de esa misma persona, en parejas
     * IMPOSTORAS que no lo son: la tasa de falsa aceptación saldría inventada y parecería medida.
     */
    if (!fila.subjectKey) {
      sinSujeto += 1;
      continue;
    }

    const carpeta = join(destino, fila.subjectKey);
    await mkdir(carpeta, { recursive: true });
    const n = (porSujeto.get(fila.subjectKey) ?? 0) + 1;
    porSujeto.set(fila.subjectKey, n);

    const documento = await storage.get(fila.documentObjectKey!);
    const selfie = await storage.get(fila.selfieObjectKey!);
    if (!documento || !selfie) {
      console.warn(`  ! ${fila.requestId}: el almacén ya no tiene sus imágenes. Se salta.`);
      continue;
    }

    // El documento va el PRIMERO en cada carpeta y con nombre reconocible: el calibrador
    // distingue documento de selfie por el nombre del archivo, no por el orden de lectura.
    await writeFile(join(carpeta, `${NOMBRE_DOCUMENTO}-${n}.jpg`), documento.content);
    await writeFile(join(carpeta, `selfie-${n}.png`), selfie.content);

    manifiesto.push({
      requestId: fila.requestId,
      subjectKey: fila.subjectKey,
      // La etiqueta y el veredicto del motor, SEPARADOS. Es lo que permite medir al motor contra
      // la persona en vez de contra sí mismo.
      humanDecision: fila.humanDecision,
      workerDecision: fila.decision,
      similarityScore: fila.similarityScore === null ? null : Number(fila.similarityScore),
      reviewReason: fila.reviewReason,
      resolvedAt: fila.reviewResolvedAt?.toISOString() ?? null,
      documentSha256: fila.documentSha256,
      selfieSha256: fila.selfieSha256,
    });
  }

  await writeFile(
    join(destino, 'manifiesto.json'),
    `${JSON.stringify(
      {
        generado: new Date().toISOString(),
        sujetos: porSujeto.size,
        parejas: manifiesto.length,
        sin_sujeto_declarado: sinSujeto,
        nota:
          'Las parejas genuinas son documento↔selfie dentro de un sujeto; las impostoras, entre ' +
          'sujetos distintos. Un caso sin sujeto declarado NO se exporta: agruparlo mal inventa ' +
          'parejas impostoras que no lo son.',
        casos: manifiesto,
      },
      null,
      2,
    )}\n`,
  );

  const genuinas = manifiesto.filter((c) => c.humanDecision === 'VERIFIED').length;
  console.log(`\nExportado a ${destino}`);
  console.log(`  sujetos                : ${porSujeto.size}`);
  console.log(`  parejas etiquetadas    : ${manifiesto.length}  (${genuinas} confirmadas)`);
  console.log(`  sin sujeto declarado   : ${sinSujeto}${sinSujeto > 0 ? '  <- no exportadas' : ''}`);
  console.log(
    `\nPara calibrar:  yarn build && node scripts/calibrar-identidad.mjs --documento-selfie ${destino}`,
  );
  // 66 genuinas de veinte sujetos distintos es el punto en el que el falso rechazo baja del 5,4 %.
  if (genuinas < 66) {
    console.log(
      `\nTodavía no alcanza para calibrar: hacen falta 66 parejas genuinas de 20 sujetos ` +
        `distintos, y hay ${genuinas} de ${porSujeto.size}.`,
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
