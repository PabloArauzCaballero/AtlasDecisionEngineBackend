import { candidateLines } from './candidate-lines';
import type { MrzDiagnostics } from './mrz-types';
import { parseMrzTd1 } from './parse-mrz-td1';

export function mrzDiagnostics(rawText: string): MrzDiagnostics {
  const lineas = candidateLines(rawText);
  if (lineas.length < 3) return { found: false };
  const leida = parseMrzTd1(rawText);
  const enmascaradas = lineas.map((linea, indice) =>
    // El número vive en el primer renglón (posiciones 5-14); con corrimiento
    // posible se cubre un carácter a cada lado. Las fechas y el nombre ya
    // viajan claros en `fields`, así que sus renglones no se tocan.
    indice === 0
      ? `${linea.slice(0, 4)}${'•'.repeat(Math.min(12, Math.max(0, linea.length - 4)))}${linea.slice(16)}`
      : linea,
  );
  return {
    found: true,
    lines: enmascaradas,
    ...(leida ? { checks: leida.checks } : {}),
  };
}
