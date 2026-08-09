import { describeMockupDecision, resolveMockupPolicy } from '../src/modules/seeding/mockup-policy';

/**
 * La frontera entre el catálogo BASE —sin el que una instalación no opera, y que por eso
 * corre en todos los ambientes— y los datos de DEMOSTRACIÓN —artefactos de ejemplo con
 * despliegues ACTIVOS, incluido uno en PROD—.
 *
 * Es la única regla del módulo de siembra que decidía por duplicado: el Job leía
 * `SEED_INCLUDE_MOCKUP` y el arranque miraba `NODE_ENV`, así que la misma base podía
 * recibir cosas distintas según quién sembrara. Aquí se fija una sola vez.
 */
describe('resolveMockupPolicy', () => {
  it('sin declarar nada, siembra el demo sólo en desarrollo', () => {
    expect(resolveMockupPolicy({ NODE_ENV: 'development' }).includeMockup).toBe(true);
    expect(resolveMockupPolicy({ NODE_ENV: 'production' }).includeMockup).toBe(false);
    expect(resolveMockupPolicy({ NODE_ENV: 'test' }).includeMockup).toBe(false);
  });

  it('sin NODE_ENV asume desarrollo, igual que el resto del proyecto', () => {
    expect(resolveMockupPolicy({}).includeMockup).toBe(true);
  });

  it('la variable explícita manda sobre NODE_ENV, en los dos sentidos', () => {
    // El caso que importa: la imagen fija NODE_ENV=production incluso en un portátil, así
    // que sin esta precedencia el contenedor de siembra jamás sembraría el demo en
    // desarrollo y la base quedaría con catálogos y ningún artefacto ejecutable.
    expect(
      resolveMockupPolicy({ NODE_ENV: 'production', SEED_INCLUDE_MOCKUP: 'true' }).includeMockup,
    ).toBe(true);
    // Y el inverso es la guarda de producción: `docker-compose.prod.yml` la fija en `false`.
    expect(
      resolveMockupPolicy({ NODE_ENV: 'development', SEED_INCLUDE_MOCKUP: 'false' }).includeMockup,
    ).toBe(false);
  });

  it('acepta las grafías habituales de un booleano de entorno', () => {
    for (const raw of ['true', 'TRUE', ' True ', '1', 'yes']) {
      expect(resolveMockupPolicy({ SEED_INCLUDE_MOCKUP: raw }).includeMockup).toBe(true);
    }
    for (const raw of ['false', 'FALSE', ' False ', '0', 'no']) {
      expect(resolveMockupPolicy({ SEED_INCLUDE_MOCKUP: raw }).includeMockup).toBe(false);
    }
  });

  it('un valor irreconocible falla en vez de degradarse a `false`', () => {
    // Degradarlo en silencio deja una base sin ningún artefacto ejecutable y un motor que
    // responde «no active deployment» sin explicar por qué. Es más barato romper aquí.
    expect(() => resolveMockupPolicy({ SEED_INCLUDE_MOCKUP: 'sí' })).toThrow(/SEED_INCLUDE_MOCKUP/);
    expect(() => resolveMockupPolicy({ SEED_INCLUDE_MOCKUP: 'verdadero' })).toThrow();
  });

  it('una cadena vacía es «no declarada», no un valor inválido', () => {
    // `SEED_INCLUDE_MOCKUP: ${SEED_INCLUDE_MOCKUP:-}` en un compose produce exactamente esto.
    expect(resolveMockupPolicy({ NODE_ENV: 'production', SEED_INCLUDE_MOCKUP: '' })).toEqual({
      includeMockup: false,
      reason: 'NODE_ENV=production',
    });
  });

  it('la bitácora dice qué se sembró y por qué', () => {
    expect(describeMockupDecision(resolveMockupPolicy({ NODE_ENV: 'development' }))).toContain(
      'DEMOSTRACIÓN',
    );
    expect(describeMockupDecision(resolveMockupPolicy({ NODE_ENV: 'production' }))).toContain(
      'NODE_ENV=production',
    );
  });
});
