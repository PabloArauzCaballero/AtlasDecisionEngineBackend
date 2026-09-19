import { describe, expect, it } from '@jest/globals';
import { MAX_STATEMENT_LENGTH, redactSqlLiterals } from '../src/common/observability/sql-redaction';

describe('redacción de literales en el SQL publicado', () => {
  it('quita el valor de un literal y conserva la forma de la consulta', () => {
    // El riesgo de ESTE motor es la consola SQL interna: `$queryRawUnsafe` ejecuta el texto que
    // escribe un operador, y ese texto es el atributo del span.
    const real =
      "SELECT * FROM identity_evidence WHERE document_number = '2a91be569bcce951fe067c143e6bde38' AND tipo = '1'";
    const redactado = redactSqlLiterals(real);
    expect(redactado).not.toContain('2a91be569bcce951fe067c143e6bde38');
    expect(redactado).toContain('identity_evidence');
    expect(redactado).toContain("document_number = '?'");
  });

  it('no toca los parámetros ligados, que ya son seguros', () => {
    const sql = 'INSERT INTO "audit"."logs" ("a","b") VALUES ($1,$2) RETURNING "_id"';
    expect(redactSqlLiterals(sql)).toBe(sql);
  });

  it('un literal con apóstrofo escapado se redacta ENTERO, no a medias', () => {
    const redactado = redactSqlLiterals("SELECT * FROM t WHERE nombre = 'O''Brien' AND x = 1");
    expect(redactado).not.toContain('Brien');
    expect(redactado).toBe("SELECT * FROM t WHERE nombre = '?' AND x = 1");
  });

  it('redacta varios literales en la misma sentencia', () => {
    const redactado = redactSqlLiterals("SELECT 1 WHERE a='ana@ejemplo.com' OR b='7712345'");
    expect(redactado).toBe("SELECT 1 WHERE a='?' OR b='?'");
  });

  it('conserva los literales NUMÉRICOS: son límites e identificadores internos, no personas', () => {
    expect(redactSqlLiterals('SELECT * FROM t WHERE _tenant_id = 3 LIMIT 50 OFFSET 0')).toBe(
      'SELECT * FROM t WHERE _tenant_id = 3 LIMIT 50 OFFSET 0',
    );
  });

  it('vacía los bloques con delimitador en dólar, que pueden llevar un cuerpo entero', () => {
    const redactado = redactSqlLiterals('SELECT $tag$ {"documento":"7712345"} $tag$');
    expect(redactado).not.toContain('7712345');
  });

  it('colapsa el espacio en blanco: la sangría de Sequelize sólo estorba en un atributo', () => {
    expect(redactSqlLiterals('SELECT\n  a,\n  b\nFROM   t')).toBe('SELECT a, b FROM t');
  });

  it('recorta una sentencia enorme y lo dice', () => {
    const larga = `SELECT ${'"columna_muy_larga", '.repeat(200)} FROM t`;
    const redactado = redactSqlLiterals(larga);
    expect(redactado.length).toBe(MAX_STATEMENT_LENGTH);
    expect(redactado.endsWith('…[recortado]')).toBe(true);
  });

  it('una sentencia vacía no rompe nada', () => {
    expect(redactSqlLiterals('')).toBe('');
  });
});
