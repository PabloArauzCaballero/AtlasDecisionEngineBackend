import { createHash, timingSafeEqual } from 'node:crypto';
import {
  extractMetricsToken,
  isAuthorizedMetricsRequest,
} from '../src/common/observability/metrics-token';

/**
 * El endpoint `/metrics` acepta el secreto por dos portadores: la cabecera original
 * `X-Metrics-Token` y `Authorization: Bearer`. El segundo se añadió porque Prometheus no
 * admite cabeceras arbitrarias en un `scrape_config` — con solo el primero, la métrica quedaba
 * publicada, protegida e inalcanzable para el único consumidor previsto.
 *
 * Lo que estas pruebas protegen es que la ampliación no relajó nada: mismo secreto, misma
 * comparación, y ninguna vía nueva por la que colar una credencial vacía o parcial.
 */
describe('autorización del endpoint de métricas', () => {
  const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
  const equals = (a: string, b: string): boolean => {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  };

  const authorize = (
    headers: Parameters<typeof extractMetricsToken>[0],
    expected: string,
  ): boolean => isAuthorizedMetricsRequest(extractMetricsToken(headers), expected, equals, digest);

  describe('extracción del portador', () => {
    it('acepta la cabecera original X-Metrics-Token', () => {
      expect(extractMetricsToken({ 'x-metrics-token': 'secreto' })).toBe('secreto');
    });

    it('acepta Authorization: Bearer, que es lo que Prometheus sabe enviar', () => {
      expect(extractMetricsToken({ authorization: 'Bearer secreto' })).toBe('secreto');
    });

    it('trata el esquema sin distinguir mayúsculas, como exige la RFC 7235', () => {
      expect(extractMetricsToken({ authorization: 'bearer secreto' })).toBe('secreto');
      expect(extractMetricsToken({ authorization: 'BEARER secreto' })).toBe('secreto');
    });

    it('ignora esquemas que no son Bearer', () => {
      expect(extractMetricsToken({ authorization: 'Basic dXNlcjpwYXNz' })).toBeUndefined();
    });

    it('da precedencia a X-Metrics-Token cuando llegan los dos', () => {
      expect(
        extractMetricsToken({ 'x-metrics-token': 'directo', authorization: 'Bearer otro' }),
      ).toBe('directo');
    });

    it('rechaza una cabecera repetida: dos valores no son una credencial', () => {
      expect(extractMetricsToken({ 'x-metrics-token': ['uno', 'dos'] })).toBeUndefined();
      expect(extractMetricsToken({ authorization: ['Bearer uno', 'Bearer dos'] })).toBeUndefined();
    });

    it('no devuelve una credencial vacía', () => {
      expect(extractMetricsToken({})).toBeUndefined();
      expect(extractMetricsToken({ authorization: 'Bearer' })).toBeUndefined();
      expect(extractMetricsToken({ authorization: 'Bearer ' })).toBeUndefined();
      expect(extractMetricsToken({ 'x-metrics-token': '' })).toBeUndefined();
    });

    it('conserva el valor tal cual, sin recortarlo', () => {
      // Normalizar haría que dos secretos distintos pudieran considerarse el mismo.
      expect(extractMetricsToken({ authorization: 'Bearer  con-espacio' })).toBe(' con-espacio');
    });
  });

  describe('decisión de autorización', () => {
    const expected = 'token-de-metricas-con-entropia-suficiente';

    it('admite el secreto correcto por cualquiera de los dos portadores', () => {
      expect(authorize({ 'x-metrics-token': expected }, expected)).toBe(true);
      expect(authorize({ authorization: `Bearer ${expected}` }, expected)).toBe(true);
    });

    it('rechaza un secreto incorrecto', () => {
      expect(authorize({ 'x-metrics-token': 'equivocado' }, expected)).toBe(false);
      expect(authorize({ authorization: 'Bearer equivocado' }, expected)).toBe(false);
    });

    it('rechaza cuando no se presenta ninguna credencial', () => {
      expect(authorize({}, expected)).toBe(false);
    });

    it('rechaza un prefijo del secreto correcto', () => {
      // La comparación es sobre los digest, así que la longitud del secreto no se filtra por
      // el tiempo de respuesta ni un prefijo se acepta por coincidir parcialmente.
      expect(authorize({ 'x-metrics-token': expected.slice(0, -1) }, expected)).toBe(false);
    });

    it('deja el endpoint abierto si no hay secreto configurado', () => {
      // Comportamiento previo, conservado a propósito: el esquema de entorno ya impide llegar
      // a este estado en producción (METRICS_TOKEN es obligatorio con METRICS_ENABLED).
      expect(authorize({}, '')).toBe(true);
    });

    it('no permite que una credencial vacía valga como el secreto configurado', () => {
      expect(authorize({ authorization: 'Bearer ' }, expected)).toBe(false);
    });
  });
});
