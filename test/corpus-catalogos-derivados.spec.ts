import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GLOSARIO_OFICIAL,
  HASH_DEL_CORPUS_EXTRACTOS,
  PROCEDENCIA_DEL_GLOSARIO,
  COBERTURA_POR_EMISOR,
} from '../src/modules/workers/bank-statement/core/corpus/corpus-extractos.generated';
import { HASH_DEL_CORPUS_IDENTIDAD } from '../src/modules/workers/identity-verification/core/corpus/corpus-identidad.generated';
import { BOLIVIA_INSTITUTIONS } from '../src/modules/workers/bank-statement/core/institutions/bolivia-institutions';

/**
 * Que lo GENERADO siga siendo lo que el corpus dice.
 *
 * Un catálogo derivado tiene un modo de fallo silencioso y muy fácil: alguien
 * actualiza `corpus/` y no regenera, o edita el archivo generado a mano para
 * arreglar algo rápido. En los dos casos el código sigue compilando, las pruebas
 * siguen en verde y la procedencia —que es la razón de ser de todo esto— deja de
 * ser cierta sin que nadie se entere.
 *
 * El hash lo impide: viaja dentro de lo generado y aquí se compara con el del
 * archivo de verdad.
 */
describe('catálogos derivados del corpus', () => {
  const raiz = join(__dirname, '..');
  const hashDe = (nombre: string): string =>
    createHash('sha256')
      .update(readFileSync(join(raiz, 'corpus', nombre)))
      .digest('hex');

  it('el catálogo de extractos salió del corpus que está en el repositorio', () => {
    expect(HASH_DEL_CORPUS_EXTRACTOS).toBe(hashDe('corpus-extractos-bo.json'));
  });

  it('el catálogo de identidad, igual', () => {
    expect(HASH_DEL_CORPUS_IDENTIDAD).toBe(hashDe('corpus-identidad-bo.json'));
  });

  it('el glosario oficial trae las 147 filas del emisor, sin perder ninguna', () => {
    expect(GLOSARIO_OFICIAL.length).toBe(PROCEDENCIA_DEL_GLOSARIO.filas);
    expect(GLOSARIO_OFICIAL.length).toBe(147);
    // 146 literales distintos en 147 filas: `CERTIFI CADO` aparece dos veces.
    expect(new Set(GLOSARIO_OFICIAL.map((glosa) => glosa.literal)).size).toBe(
      PROCEDENCIA_DEL_GLOSARIO.literalesUnicos,
    );
    // Y todas son del único emisor con glosario publicado.
    expect(new Set(GLOSARIO_OFICIAL.map((glosa) => glosa.emisor))).toEqual(new Set(['BCR']));
  });

  it('las 67 fichas de cobertura casan con el padrón vigente del motor', () => {
    expect(COBERTURA_POR_EMISOR.length).toBe(67);
    const vigentes = new Set(
      BOLIVIA_INSTITUTIONS.filter((institucion) => institucion.licenseStatus === 'LICENSED').map(
        (institucion) => institucion.code,
      ),
    );
    for (const ficha of COBERTURA_POR_EMISOR) {
      expect(vigentes.has(ficha.codigo)).toBe(true);
    }
    expect(vigentes.size).toBe(COBERTURA_POR_EMISOR.length);
  });

  it('ninguna ficha declara una plantilla verificada que no existe', () => {
    // El corpus entrega cero plantillas de PDF verificadas. Publicar lo
    // contrario haría creer que hay cobertura de formatos que no hay.
    for (const ficha of COBERTURA_POR_EMISOR) {
      expect(ficha.plantillaVerificada).toBe(false);
    }
    expect(COBERTURA_POR_EMISOR.filter((ficha) => ficha.tieneGlosarioOficial).length).toBe(1);
  });
});
