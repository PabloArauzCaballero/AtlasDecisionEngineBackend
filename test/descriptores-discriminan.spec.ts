import { COMPILED_SIGNAL_DESCRIPTORS } from '../src/modules/workers/bank-statement/core/institutions/signal-descriptors';
import { assessSimilarity } from '../src/modules/workers/bank-statement/core/engine/similarity/similarity-scorer';
import type { DocumentFingerprint } from '../src/modules/workers/bank-statement/core/engine/similarity/similarity-scorer';

/**
 * Que un descriptor sirva para DISTINGUIR una entidad, no sólo para describirla.
 *
 * ## Lo que se midió, y por qué hacía falta una prueba
 *
 * Los siete descriptores eran deducciones de los analizadores, sin un PDF real
 * detrás. Medidos el 2026-09-01 contra diez extractos auténticos, fallaban de
 * dos formas opuestas y ninguna se ve leyéndolos:
 *
 * - **muertas**: patrones que no coinciden ni con su propio banco. Hunden el
 *   porcentaje de todo extracto legítimo de esa entidad.
 * - **genéricas**: patrones que coinciden MÁS en documentos ajenos que en los
 *   propios. `\bASFI\b` es el caso puro: la supervisión es obligatoria, así que
 *   la lleva impresa todo extracto boliviano y no separa a nadie.
 *
 * El efecto conjunto era que el parecido no separaba: los propios iban de 41 % a
 * 100 % y los ajenos llegaban a 63 %, es decir que se solapaban. Retiradas las
 * dieciocho señales que fallaban, los siete propios dan 100 % y ningún ajeno
 * pasa de 54 %.
 *
 * ## Por qué esta prueba no usa PDF reales
 *
 * Porque no los hay en el repositorio, ni debe haberlos: son extractos de una
 * persona. Lo que sí se puede fijar aquí es la PROPIEDAD que la medición
 * descubrió —que ninguna señal sea genérica, y que los descriptores que comparten
 * generador se separen— usando huellas sintéticas. Es la mitad comprobable sin
 * datos personales, y es la mitad que se rompe al añadir un descriptor nuevo sin
 * medirlo.
 */

function huella(overrides: Partial<DocumentFingerprint> = {}): DocumentFingerprint {
  return {
    cover: '',
    fullText: '',
    columnHeaders: [],
    provenance: { producer: null, creator: null },
    ...overrides,
  };
}

describe('descriptores de señales · discriminan entre entidades', () => {
  const codigos = [...COMPILED_SIGNAL_DESCRIPTORS.keys()];

  it('todos están medidos contra documentos reales, no deducidos', () => {
    for (const [code, d] of COMPILED_SIGNAL_DESCRIPTORS) {
      expect(`${code}:${d.provenance}`).toBe(`${code}:MEASURED`);
      // `sampleSize` es el denominador del porcentaje: sin él, «coincide al 90 %»
      // no se puede interpretar.
      expect(d.sampleSize).toBeGreaterThan(0);
    }
  });

  /*
   * La supervisión de ASFI es OBLIGATORIA para toda entidad boliviana, así que
   * está impresa en todos los extractos del país. Como señal de identidad vale
   * cero, y medida coincidía en tres ajenos por cada uno propio.
   */
  it('ninguna señal se apoya en la mención genérica a ASFI', () => {
    const generico = /ASFI|supervisada\\s+por/i;
    for (const [code, d] of COMPILED_SIGNAL_DESCRIPTORS) {
      for (const s of d.signals) {
        expect(`${code}.${s.id}: ${String(s.pattern)}`).not.toMatch(generico);
      }
    }
  });

  /*
   * El caso que obligó a atar el patrón a la VERSIÓN del generador: el Ganadero
   * y el Unión encargan sus extractos al mismo Microsoft Reporting Services, y
   * lo único que los separa es 10.0 frente a 12.0. Un patrón por familia haría
   * que cada uno corroborara los documentos del otro.
   */
  it('el Ganadero y el Unión no se confunden pese a compartir generador', () => {
    const ganadero = huella({
      provenance: {
        producer: 'Microsoft Reporting Services PDF Rendering Extension 10.0.0.0',
        creator: 'Microsoft Reporting Services 10.0.0.0',
      },
    });
    const union = huella({
      provenance: {
        producer: 'Microsoft Reporting Services PDF Rendering Extension 12.0.0.0',
        creator: 'Microsoft Reporting Services 12.0.0.0',
      },
    });
    const señal = (code: string, fp: DocumentFingerprint): boolean =>
      assessSimilarity(fp, COMPILED_SIGNAL_DESCRIPTORS.get(code)).signals.some(
        (s) => s.scope === 'PRODUCER' && s.matched,
      );

    expect(señal('BGA', ganadero)).toBe(true);
    expect(señal('BGA', union)).toBe(false);
    expect(señal('BUN', union)).toBe(true);
    expect(señal('BUN', ganadero)).toBe(false);
  });

  /*
   * Un documento vacío no puede parecerse a nadie. Suena obvio y es la comprobación
   * que caza una señal escrita con un patrón que casa con la cadena vacía.
   */
  it('un documento sin nada no se parece a ninguna entidad', () => {
    for (const code of codigos) {
      const evaluacion = assessSimilarity(huella(), COMPILED_SIGNAL_DESCRIPTORS.get(code));
      expect(`${code}:${evaluacion.score}`).toBe(`${code}:0`);
    }
  });

  /*
   * Ninguna señal puede valer cero: una con peso 0 no mueve el porcentaje y
   * sólo confunde a quien lee el informe de coincidencias.
   */
  it('toda señal pesa algo y declara su ámbito', () => {
    for (const [code, d] of COMPILED_SIGNAL_DESCRIPTORS) {
      expect(d.signals.length).toBeGreaterThan(0);
      for (const s of d.signals) {
        expect(`${code}.${s.id}`).toBeTruthy();
        expect(s.weight).toBeGreaterThan(0);
        expect(['COVER', 'DOCUMENT', 'COLUMNS', 'PRODUCER']).toContain(s.scope);
      }
    }
  });

  /*
   * El generador es la señal que más cuesta falsificar —hay que producir el
   * archivo con esa herramienta—, así que toda entidad cuyo PDF lo declare tiene
   * que llevarla. El Banco Económico es la excepción medida: su `/Info` viene
   * vacío, y no se le inventa una señal que nunca coincidiría.
   */
  it('todas llevan señal de generador salvo la que no lo declara', () => {
    const conGenerador = codigos.filter((code) =>
      COMPILED_SIGNAL_DESCRIPTORS.get(code)?.signals.some((s) => s.scope === 'PRODUCER'),
    );
    expect(conGenerador.sort()).toEqual(['BCR', 'BGA', 'BME', 'BNB', 'BSO', 'BUN']);
  });
});
