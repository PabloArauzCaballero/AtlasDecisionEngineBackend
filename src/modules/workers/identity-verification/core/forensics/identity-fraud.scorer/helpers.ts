import { UmbralesDeFraude, VeredictoDeFraude } from './types';

export function decidir(
  riesgo: number,
  umbrales: UmbralesDeFraude,
  tope: VeredictoDeFraude,
): VeredictoDeFraude {
  if (riesgo >= umbrales.riesgoDeSospecha) {
    return tope === 'REVIEW' ? 'REVIEW' : 'FRAUD_SUSPECTED';
  }
  if (riesgo >= umbrales.riesgoDeRevision) return 'REVIEW';
  return 'CLEAR';
}

/**
 * `1 − Π(1 − rᵢ)`, con cada `rᵢ` recortado a `[0, 0.95]`.
 *
 * El recorte superior importa: sin él una sola señal en 1 haría el producto cero
 * y el riesgo 1 exacto, y ninguna de estas heurísticas merece la palabra
 * «certeza». Con 0,95 siempre queda margen para que una segunda señal mueva el
 * número, que es lo que permite distinguir un caso de dos.
 */
export function componer(riesgos: readonly number[]): number {
  if (riesgos.length === 0) return 0;
  const restante = riesgos.reduce(
    (producto, riesgo) => producto * (1 - Math.max(0, Math.min(0.95, riesgo))),
    1,
  );
  return 1 - restante;
}

/** Una proporción a un riesgo con techo, sin que pueda pasarse de su tope. */
export function escalar(proporcion: number, techo: number): number {
  return Math.max(0, Math.min(techo, proporcion * techo));
}
