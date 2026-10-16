import { IdentityDocumentType } from '../../domain/identity-enums';
import { casarGrafias, plegarParaCotejo } from '../../catalog/approximate-match';
import { CONTRAINDICADORES, PESO_TOTAL, SENALES, TextoYForma } from './signals';

export interface EvidenciaDeIdentidad {
  /** Cuánta evidencia hay de que sea un documento de identidad, en `[0, 1]`. */
  readonly confidence: number;
  /** Qué señales casaron, para que la traza explique el número. */
  readonly signals: readonly string[];
  /**
   * Qué OTRO documento se reconoció, si se reconoció alguno.
   *
   * Cuando viene relleno, la confianza es 0 y no hay nada que discutir: no es
   * que falte evidencia de cédula, es que hay evidencia de otra cosa.
   */
  readonly contraindicator: string | null;
}

/** Mayúsculas y sin tildes: las señales se escriben una sola vez, sin variantes. */
export function plegarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toUpperCase();
}

/**
 * La evidencia de que la imagen contenga un documento de identidad.
 *
 * No decide nada: sólo mide. Quién decide es `identity-triage.ts`, con los
 * umbrales del despliegue, para que recalibrar no obligue a tocar las señales.
 */
export function medirEvidenciaDeIdentidad(entrada: TextoYForma): EvidenciaDeIdentidad {
  const plegado = plegarTexto(entrada.texto);
  const evidencia: TextoYForma = {
    ...entrada,
    texto: plegado,
    cotejo: plegarParaCotejo(plegado),
  };

  const contra = CONTRAINDICADORES.find(({ patron }) => patron.test(evidencia.texto));
  if (contra !== undefined) {
    return { confidence: 0, signals: [], contraindicator: contra.tipo };
  }

  const casadas = SENALES.filter(
    (senal) =>
      senal.casa(evidencia) || casarGrafias(evidencia.cotejo ?? '', senal.grafias ?? []) !== null,
  );
  const suma = casadas.reduce((total, senal) => total + senal.peso, 0);
  return {
    confidence: Number((suma / PESO_TOTAL).toFixed(3)),
    signals: casadas.map((senal) => senal.id),
    contraindicator: null,
  };
}

/**
 * Los tipos que este despliegue acepta, leídos de una lista separada por comas.
 *
 * Existe porque «documento de identidad» y «carnet» no son lo mismo, y quien
 * monta un flujo móvil de alta de clientes suele querer EXACTAMENTE el carnet:
 * un pasaporte válido sigue siendo un documento válido, pero no es el que ese
 * flujo pidió, y aceptarlo obliga a un analizador y a una política de caducidad
 * distintas. Lo que no puede pasar es que la restricción viva escrita a fuego en
 * el pipeline, porque entonces habilitar el pasaporte es un despliegue de código.
 */
export function parsearTiposAceptados(crudo: string | undefined): readonly IdentityDocumentType[] {
  const conocidos = new Set<string>(Object.values(IdentityDocumentType));
  const pedidos = (crudo ?? '')
    .split(',')
    .map((tipo) => tipo.trim().toUpperCase())
    .filter((tipo) => tipo.length > 0 && tipo !== IdentityDocumentType.UNKNOWN)
    .filter((tipo) => conocidos.has(tipo)) as IdentityDocumentType[];

  // Sin lista utilizable se cae al carnet boliviano, que es el documento para el
  // que este worker tiene analizador verificado. Abrir la puerta a todos por un
  // valor mal escrito sería justo lo contrario de lo que la variable existe para
  // controlar.
  return pedidos.length > 0 ? [...new Set(pedidos)] : [IdentityDocumentType.BOLIVIA_CI];
}
