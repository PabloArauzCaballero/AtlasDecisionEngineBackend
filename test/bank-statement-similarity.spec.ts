/**
 * El parecido con el patrón de la entidad: la medida, y lo que se puede hacer
 * con ella.
 *
 * Las dos mitades se prueban por separado a propósito. La primera —el
 * descriptor— es un validador de datos que vienen de fuera, y lo que hay que
 * demostrar es que RECHAZA lo que no debería entrar. La segunda —el comparador—
 * es aritmética sobre texto, y lo que hay que demostrar es que el porcentaje
 * significa lo que dice y que el rescate no se puede autoconceder.
 */
import {
  parseSignalDescriptor,
  InvalidSignalDescriptorError,
} from '../src/modules/workers/bank-statement/core/engine/similarity/institution-signals';
import {
  assessSimilarity,
  DEFAULT_SIMILARITY_THRESHOLDS,
  similarityLabel,
  type DocumentFingerprint,
} from '../src/modules/workers/bank-statement/core/engine/similarity/similarity-scorer';
import { COMPILED_SIGNAL_DESCRIPTORS } from '../src/modules/workers/bank-statement/core/institutions/signal-descriptors';

function descriptor(overrides: Record<string, unknown> = {}) {
  return parseSignalDescriptor({
    version: 1,
    institutionCode: 'BNB',
    provenance: 'DECLARED',
    sampleSize: 0,
    signals: [
      { id: 'razon-social', scope: 'COVER', pattern: 'BANCO NACIONAL DE BOLIVIA', weight: 10 },
      { id: 'encabezado', scope: 'COLUMNS', pattern: 'Descripci[oó]n', weight: 30 },
      { id: 'generador', scope: 'PRODUCER', pattern: 'iText', weight: 60 },
    ],
    ...overrides,
  });
}

function documento(overrides: Partial<DocumentFingerprint> = {}): DocumentFingerprint {
  return {
    cover: 'BANCO NACIONAL DE BOLIVIA S.A.\nESTADO DE CUENTA',
    fullText: 'BANCO NACIONAL DE BOLIVIA S.A. ... movimientos ...',
    columnHeaders: ['Fecha', 'Descripción', 'Monto'],
    provenance: { producer: 'iText 7.2.5', creator: null },
    ...overrides,
  };
}

describe('descriptor de señales esperadas', () => {
  it('compila un descriptor bien formado', () => {
    const parsed = descriptor();
    expect(parsed.institutionCode).toBe('BNB');
    expect(parsed.signals).toHaveLength(3);
  });

  /*
   * La comprobación que impide la puerta trasera. `MEASURED` es lo único que
   * autoriza a rescatar un documento, así que poder escribirlo a mano sin muestra
   * convertiría «lo declaro medido» en un permiso que nadie concedió.
   */
  it('rechaza un descriptor que se declara MEASURED sin muestra', () => {
    expect(() => descriptor({ provenance: 'MEASURED', sampleSize: 0 })).toThrow(
      InvalidSignalDescriptorError,
    );
    expect(() => descriptor({ provenance: 'MEASURED', sampleSize: 5 })).not.toThrow();
  });

  it('rechaza patrones con retroceso catastrófico antes de guardarlos', () => {
    // Se ejecutarán contra el texto de un PDF, que es entrada externa de longitud
    // arbitraria: uno así bloquearía el hilo del worker.
    expect(() =>
      descriptor({
        signals: [{ id: 'malo', scope: 'COVER', pattern: '(a+)+$', weight: 10 }],
      }),
    ).toThrow(InvalidSignalDescriptorError);
  });

  it('rechaza pesos fuera de escala, ámbitos inventados y señales repetidas', () => {
    expect(() =>
      descriptor({ signals: [{ id: 'x', scope: 'COVER', pattern: 'A', weight: 0 }] }),
    ).toThrow(InvalidSignalDescriptorError);
    expect(() =>
      descriptor({ signals: [{ id: 'x', scope: 'PIE_DE_PAGINA', pattern: 'A', weight: 10 }] }),
    ).toThrow(InvalidSignalDescriptorError);
    expect(() =>
      descriptor({
        signals: [
          { id: 'x', scope: 'COVER', pattern: 'A', weight: 10 },
          { id: 'x', scope: 'DOCUMENT', pattern: 'B', weight: 10 },
        ],
      }),
    ).toThrow(InvalidSignalDescriptorError);
  });

  /*
   * Los siete descriptores compilados se validan al cargar el módulo, así que si
   * uno estuviera mal escrito este import ya habría reventado.
   *
   * Esta prueba fijaba además que TODOS fueran `DECLARED`, para que nadie los
   * pasara a `MEASURED` sin haber medido nada y encendiera el rescate en
   * silencio. Los siete se midieron el 2026-09-01 contra diez extractos reales,
   * así que la afirmación cambia pero el guardián se queda: lo que ahora se
   * exige es que «medido» venga con su DENOMINADOR. Un descriptor que se declara
   * medido sobre cero documentos es exactamente el caso que preocupaba.
   */
  it('un descriptor que se dice medido trae la muestra que lo sostiene', () => {
    expect(COMPILED_SIGNAL_DESCRIPTORS.size).toBeGreaterThanOrEqual(7);
    for (const [code, compilado] of COMPILED_SIGNAL_DESCRIPTORS) {
      expect(compilado.institutionCode).toBe(code);
      expect(compilado.signals.length).toBeGreaterThan(0);
      if (compilado.provenance === 'MEASURED') {
        expect(`${code}.sampleSize`).toBe(`${code}.sampleSize`);
        expect(compilado.sampleSize).toBeGreaterThan(0);
        // La nota es lo que permite auditar la medición meses después.
        expect(compilado.note ?? '').not.toBe('');
      } else {
        expect(compilado.sampleSize).toBe(0);
      }
    }
  });

  /*
   * El guardián que de verdad protege el rescate, y que es independiente de cómo
   * se rotule el descriptor: corroborar exige una muestra de tres. Con los dos
   * documentos por entidad que hay hoy, ninguno corrobora todavía — y eso es lo
   * correcto: con uno o dos no se sabe qué parte de lo observado es la plantilla
   * del banco y qué parte es ese cliente.
   */
  it('ningún descriptor corrobora con menos de tres documentos medidos', () => {
    for (const [code, compilado] of COMPILED_SIGNAL_DESCRIPTORS) {
      if (compilado.sampleSize >= DEFAULT_SIMILARITY_THRESHOLDS.minimumSampleSize) continue;
      const evaluacion = assessSimilarity(documento(), {
        ...compilado,
        signals: [{ id: 'todo', scope: 'DOCUMENT', pattern: /.*/u, weight: 10 }],
      });
      expect(`${code}:${String(evaluacion.corroborates)}`).toBe(`${code}:false`);
    }
  });
});

describe('medida de parecido', () => {
  it('da 100 % cuando todas las señales coinciden', () => {
    const resultado = assessSimilarity(documento(), descriptor());
    expect(resultado.score).toBe(100);
    expect(resultado.verdict).toBe('MATCH');
  });

  /*
   * El peso es lo que separa esta medida de un recuento. Un documento con la
   * carátula copiada y nada más coincide en UNA de tres señales, pero esa señal
   * es la más barata de falsificar: tiene que puntuar bajo, no un tercio.
   */
  it('pondera: copiar la carátula no acerca al parecido de un extracto real', () => {
    const copiado = documento({
      columnHeaders: [],
      provenance: { producer: 'Microsoft Word', creator: null },
    });
    const resultado = assessSimilarity(copiado, descriptor());
    expect(resultado.score).toBe(10);
    expect(resultado.verdict).toBe('MISMATCH');
  });

  it('busca cada señal donde corresponde y no en todo el texto', () => {
    // La razón social está en el texto completo pero NO en la carátula: la señal
    // es de ámbito COVER y no debe darse por encontrada.
    const sinCaratula = documento({ cover: 'ESTADO DE CUENTA' });
    const resultado = assessSimilarity(sinCaratula, descriptor());
    expect(resultado.signals.find((s) => s.id === 'razon-social')?.matched).toBe(false);
    expect(resultado.score).toBe(90);
  });

  it('una señal obligatoria ausente pone el parecido en cero', () => {
    const exigente = descriptor({
      signals: [
        { id: 'razon-social', scope: 'COVER', pattern: 'BANCO NACIONAL', weight: 10 },
        { id: 'aviso', scope: 'DOCUMENT', pattern: 'NUNCA APARECE', weight: 5, required: true },
      ],
    });
    const resultado = assessSimilarity(documento(), exigente);
    expect(resultado.score).toBe(0);
    expect(resultado.missingRequired).toEqual(['aviso']);
  });

  it('sin descriptor no hay medida, y eso no es un cero', () => {
    const resultado = assessSimilarity(documento(), undefined);
    expect(resultado.verdict).toBe('NO_DESCRIPTOR');
    expect(resultado.corroborates).toBe(false);
    expect(similarityLabel(resultado)).toContain('sin descriptor');
  });

  /*
   * Las tres condiciones del rescate, probadas de una en una. Es la regla con más
   * consecuencia del módulo —deja pasar documentos que otra compuerta paró— y la
   * única forma de que no se relaje por descuido es fijar cada condición.
   */
  describe('cuándo el parecido puede sostener un documento dudoso', () => {
    it('no corrobora un descriptor declarado, por alto que sea el parecido', () => {
      const resultado = assessSimilarity(documento(), descriptor());
      expect(resultado.score).toBe(100);
      expect(resultado.corroborates).toBe(false);
    });

    it('no corrobora un descriptor medido sobre muestra insuficiente', () => {
      const resultado = assessSimilarity(
        documento(),
        descriptor({ provenance: 'MEASURED', sampleSize: 2 }),
      );
      expect(resultado.corroborates).toBe(false);
    });

    it('no corrobora un parecido que no llega al umbral', () => {
      const flojo = documento({
        columnHeaders: [],
        provenance: { producer: 'Quartz PDFContext', creator: null },
      });
      const resultado = assessSimilarity(
        flojo,
        descriptor({ provenance: 'MEASURED', sampleSize: 50 }),
      );
      expect(resultado.verdict).not.toBe('MATCH');
      expect(resultado.corroborates).toBe(false);
    });

    it('corrobora sólo con patrón medido, muestra suficiente y parecido alto', () => {
      const resultado = assessSimilarity(
        documento(),
        descriptor({
          provenance: 'MEASURED',
          sampleSize: DEFAULT_SIMILARITY_THRESHOLDS.minimumSampleSize,
        }),
      );
      expect(resultado.corroborates).toBe(true);
      expect(similarityLabel(resultado)).toContain('medido sobre 3');
    });
  });
});
