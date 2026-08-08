import {
  areEquivalent,
  describeTarget,
  fingerprintOf,
  inferProvider,
  parseConnectionTarget,
} from '../src/common/persistence/connections/connection-fingerprint';
import { DataSourceConfigurationError } from '../src/common/persistence/errors/persistence-errors';

/**
 * La huella decide si dos rutas comparten pool y se imprime en logs, métricas y en la
 * sonda pública de fuentes de datos. Estas pruebas fijan las dos propiedades de las que
 * depende todo lo demás: que distinga lo que debe distinguir y que no filtre el secreto.
 */
describe('connection fingerprint', () => {
  const base = 'postgresql://atlas_writer:s3cr3t@db.internal:5433/atlas?schema=public';

  it('never carries the password, in any form', () => {
    const target = parseConnectionTarget(base, 'postgresql', 'DATABASE_URL');
    const fingerprint = fingerprintOf(target);

    expect(fingerprint).not.toContain('s3cr3t');
    expect(JSON.stringify(target)).not.toContain('s3cr3t');
    expect(describeTarget(target)).not.toContain('s3cr3t');
    // La descripción legible tampoco lleva el usuario: se usa en logs de arranque.
    expect(describeTarget(target)).not.toContain('atlas_writer');
  });

  it('treats the same target with the same role as one connection', () => {
    const left = parseConnectionTarget(base, 'postgresql', 'a');
    const right = parseConnectionTarget(
      'postgresql://atlas_writer:otra-password@db.internal:5433/atlas?schema=public',
      'postgresql',
      'b',
    );

    // La contraseña no participa: rotarla no debe abrir un segundo pool idéntico.
    expect(areEquivalent(left, right)).toBe(true);
  });

  it('keeps different database roles apart', () => {
    const writer = parseConnectionTarget(base, 'postgresql', 'a');
    const reader = parseConnectionTarget(
      'postgresql://atlas_reader:s3cr3t@db.internal:5433/atlas?schema=public',
      'postgresql',
      'b',
    );

    // Escenario B: mismo servidor, credenciales distintas. Colapsarlas anularía la
    // separación de privilegios, que es justo lo que la separación de rutas persigue.
    expect(areEquivalent(writer, reader)).toBe(false);
  });

  it.each([
    ['host', 'postgresql://atlas_writer:s3cr3t@replica.internal:5433/atlas?schema=public'],
    ['port', 'postgresql://atlas_writer:s3cr3t@db.internal:6432/atlas?schema=public'],
    ['database', 'postgresql://atlas_writer:s3cr3t@db.internal:5433/otra?schema=public'],
    ['schema', 'postgresql://atlas_writer:s3cr3t@db.internal:5433/atlas?schema=audit'],
    [
      'tls',
      'postgresql://atlas_writer:s3cr3t@db.internal:5433/atlas?schema=public&sslmode=require',
    ],
  ])('keeps connections apart when the %s differs', (_label, url) => {
    const left = parseConnectionTarget(base, 'postgresql', 'a');
    const right = parseConnectionTarget(url, 'postgresql', 'b');

    expect(areEquivalent(left, right)).toBe(false);
  });

  it('applies the engine default port when the URL omits it', () => {
    const target = parseConnectionTarget(
      'postgresql://atlas:x@db.internal/atlas',
      'postgresql',
      'a',
    );

    expect(target.port).toBe(5432);
    expect(target.schema).toBe('public');
  });

  it.each([
    ['localhost', 'local'],
    ['postgres', 'docker'],
    ['ep-cool-name-123.eu-central-1.aws.neon.tech', 'neon'],
    ['db.abcdefgh.supabase.co', 'supabase'],
    ['atlas.cabcdefgh.eu-west-1.rds.amazonaws.com', 'aws-rds'],
    ['gigantic.postgres.database.azure.com', 'azure-database'],
  ])('infers the provider of %s as %s', (host, provider) => {
    expect(inferProvider(host)).toBe(provider);
  });

  it('names the offending variable without printing its value', () => {
    expect(() => parseConnectionTarget('not a url', 'postgresql', 'DATABASE_READ_URL')).toThrow(
      DataSourceConfigurationError,
    );
    try {
      parseConnectionTarget('postgresql://user:hunter2@/db', 'postgresql', 'DATABASE_READ_URL');
      fail('expected the missing host to be rejected');
    } catch (error) {
      expect((error as Error).message).toContain('DATABASE_READ_URL');
      expect((error as Error).message).not.toContain('hunter2');
    }
  });
});
