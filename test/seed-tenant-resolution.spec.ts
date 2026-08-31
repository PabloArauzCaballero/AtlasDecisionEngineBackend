import { resolveBootstrapTenantId } from '../src/common/seeding/bootstrap-tenant';

/**
 * A qué tenant pertenece lo que siembra el módulo.
 *
 * Había tres respuestas conviviendo: `BOOTSTRAP_TENANT_ID` (sólo lo leían los clientes de
 * integración), `SEED_TENANT_ID` (los scripts de `prisma/`) y un `1n` fijo (el catálogo
 * entero, y una segunda copia en el catálogo semántico). Con `BOOTSTRAP_TENANT_ID=7`, una
 * instalación quedaba con la API key habilitada para el 7 y las variables en el 1: el único
 * llamante registrado no veía nada. Una sola función, y esta prueba que la sujeta.
 */
describe('resolveBootstrapTenantId', () => {
  it('sin declarar nada, el tenant es 1', () => {
    expect(resolveBootstrapTenantId({})).toBe(1n);
  });

  it('honra BOOTSTRAP_TENANT_ID', () => {
    expect(resolveBootstrapTenantId({ BOOTSTRAP_TENANT_ID: '7' })).toBe(7n);
  });

  it('acepta SEED_TENANT_ID como sinónimo, y BOOTSTRAP_TENANT_ID manda', () => {
    expect(resolveBootstrapTenantId({ SEED_TENANT_ID: '9' })).toBe(9n);
    expect(resolveBootstrapTenantId({ BOOTSTRAP_TENANT_ID: '7', SEED_TENANT_ID: '9' })).toBe(7n);
  });

  it('una cadena vacía es «no declarada»', () => {
    // `BOOTSTRAP_TENANT_ID: ${BOOTSTRAP_TENANT_ID:-}` en un compose produce esto.
    expect(resolveBootstrapTenantId({ BOOTSTRAP_TENANT_ID: '  ' })).toBe(1n);
  });

  it('rechaza lo que no es un entero positivo en vez de caer al 1', () => {
    // Caer al 1 en silencio es cómo el catálogo termina en un tenant que nadie pidió.
    expect(() => resolveBootstrapTenantId({ BOOTSTRAP_TENANT_ID: 'siete' })).toThrow();
    expect(() => resolveBootstrapTenantId({ BOOTSTRAP_TENANT_ID: '-3' })).toThrow();
    expect(() => resolveBootstrapTenantId({ BOOTSTRAP_TENANT_ID: '1.5' })).toThrow();
    expect(() => resolveBootstrapTenantId({ BOOTSTRAP_TENANT_ID: '0' })).toThrow(/>= 1/);
  });

  it('soporta identificadores mayores que un entero de 53 bits', () => {
    // La columna es BIGINT; pasar por `Number` los redondearía en silencio.
    expect(resolveBootstrapTenantId({ BOOTSTRAP_TENANT_ID: '9007199254740993' })).toBe(
      9007199254740993n,
    );
  });
});
