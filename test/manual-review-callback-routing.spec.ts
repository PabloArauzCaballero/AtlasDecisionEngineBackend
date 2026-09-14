import { rutaDeCallback } from '../src/modules/manual-review/manual-review.service';

/**
 * A qué endpoint de AtlasBackend vuelve cada resolución.
 *
 * Antes sólo IDENTIDAD volvía. Riesgo y crédito se resolvían aquí y allá la solicitud o el caso
 * delegado se quedaban abiertos para siempre; este mapa es lo que cierra ese callejón.
 */
describe('manual review · ruta de callback por cola', () => {
  it('identidad, riesgo y crédito vuelven a su endpoint', () => {
    expect(rutaDeCallback('IDENTIDAD')).toBe('/internal/identity/manual-review-callback');
    expect(rutaDeCallback('RIESGO_ONBOARDING')).toBe('/internal/risk/manual-review-callback');
    expect(rutaDeCallback('CREDIT_REVIEW')).toBe('/internal/credit/manual-review-callback');
  });

  it('el KYB del comercio NO vuelve por callback: AtlasBackend lo sincroniza por tirón', () => {
    expect(rutaDeCallback('MERCHANT_KYB')).toBeNull();
  });

  it('una cola desconocida o vacía no adivina destino', () => {
    expect(rutaDeCallback('OTRA')).toBeNull();
    expect(rutaDeCallback(null)).toBeNull();
    expect(rutaDeCallback(undefined)).toBeNull();
  });
});
