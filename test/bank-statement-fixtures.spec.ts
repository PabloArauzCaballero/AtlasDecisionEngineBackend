/**
 * Los escenarios de prueba tienen que producir lo que prometen.
 *
 * Un fixture que dice «termina con advertencias» y en realidad termina limpio
 * no es un fixture: es una etiqueta. La interfaz lo va a describir al usuario
 * antes de ejecutarlo, así que la descripción es parte del contrato y se
 * comprueba contra el motor de verdad, no contra un doble.
 *
 * Esta prueba es además la **equivalencia funcional** que exige el encargo: el
 * motor absorbido se ejercita entero —lector de PDF, clasificador, detector de
 * institución, inferencia de tabla, validaciones financieras— dentro de este
 * repositorio y con su compilación a CommonJS.
 */
import {
  BANK_STATEMENT_FIXTURES,
  findBankStatementFixture,
} from '../src/modules/workers/bank-statement/fixtures/bank-statement-fixtures';
import {
  buildSyntheticPdf,
  lineY,
} from '../src/modules/workers/bank-statement/fixtures/synthetic-pdf';
import { StatementProcessingError } from '../src/modules/workers/bank-statement/core/domain/errors';
import {
  createStatementEngine,
  type StatementEngine,
} from '../src/modules/workers/bank-statement/core/statement-engine';

// Leer un PDF de verdad cuesta segundos, no milisegundos.
jest.setTimeout(120_000);

describe('escenarios de prueba del worker de extractos', () => {
  let engine: StatementEngine;

  beforeAll(() => {
    engine = createStatementEngine({
      limits: {
        maxFileSizeBytes: 10 * 1_048_576,
        maxPageCount: 60,
        processingTimeoutMs: 30_000,
      },
    });
  });

  it('genera PDF reales, con su firma', () => {
    for (const fixture of BANK_STATEMENT_FIXTURES) {
      const bytes = fixture.build();
      expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(bytes.byteLength).toBeGreaterThan(200);
    }
  });

  it('son deterministas, que es lo que permite probar la idempotencia', () => {
    // La idempotencia del worker se apoya en el SHA-256 del archivo. Si el
    // mismo escenario produjera bytes distintos en dos ejecuciones, la
    // deduplicación no se podría demostrar ni usar.
    for (const fixture of BANK_STATEMENT_FIXTURES) {
      expect(fixture.build().equals(fixture.build())).toBe(true);
    }
  });

  it('«valid-basic» detecta la institución y lee sus movimientos', async () => {
    const fixture = findBankStatementFixture('valid-basic');
    const result = await engine.normalize(fixture!.build(), { fileName: fixture!.fileName });

    expect(result.institution.detected).toBe(true);
    expect(result.institution.id).toBe('BGA');
    expect(result.transactions).toHaveLength(2);
    expect(result.balances.opening).toBe(10_000);
    expect(result.balances.closing).toBe(11_250);

    const [debit, credit] = result.transactions;
    expect(debit?.movementType).toBe('DEBIT');
    expect(debit?.transactionDate).toBe('2026-03-02');
    // El paréntesis de la glosa es el caso que rompería un PDF mal escapado.
    expect(debit?.description).toContain('(CUOTA 3)');
    expect(credit?.movementType).toBe('CREDIT');
    expect(credit?.amount).toBe(1_500);
  });

  it('publica los totales SUMADOS aunque el documento no imprima ninguno', async () => {
    /*
     * El defecto que esta prueba fija: `totals.debit`/`totals.credit` son los totales
     * que IMPRIME el banco, y las estrategias especializadas —las de los siete formatos
     * bolivianos— no los publican, así que llegaban `null` y quien los leía se quedaba
     * sin el dato. El algoritmo `EXTRACTO_CAPACIDAD_PAGO` los leía para derivar el
     * ingreso: con `null` caía a su valor por defecto y rechazaba por «cobertura
     * insuficiente» extractos de los que había leído cada movimiento. Los sumados no
     * dependen de lo que el banco decidiera imprimir.
     */
    const fixture = findBankStatementFixture('valid-basic');
    const result = await engine.normalize(fixture!.build(), { fileName: fixture!.fileName });

    expect(result.totals.debit).toBeNull();
    expect(result.totals.credit).toBeNull();
    expect(result.totals.debitExtracted).toBe(250);
    expect(result.totals.creditExtracted).toBe(1_500);

    // Y cuadran con los movimientos publicados, que es lo que los hace verificables.
    const sum = (field: 'debit' | 'credit'): number =>
      result.transactions.reduce((total, item) => total + (item[field] ?? 0), 0);
    expect(result.totals.debitExtracted).toBeCloseTo(sum('debit'), 2);
    expect(result.totals.creditExtracted).toBeCloseTo(sum('credit'), 2);
  });

  it('nunca publica el número de cuenta completo', async () => {
    const fixture = findBankStatementFixture('valid-basic');
    const result = await engine.normalize(fixture!.build(), { fileName: fixture!.fileName });

    // La garantía de privacidad del motor original tiene que sobrevivir a la
    // absorción: si se perdiera, el resultado que este repositorio guarda en la
    // base de datos llevaría el número real.
    expect(result.account.accountNumberMasked).not.toContain('1234567890');
    expect(result.account.accountNumberMasked).toMatch(/\*+7890$/);
    expect(JSON.stringify(result)).not.toContain('1234567890');
  });

  it('«valid-complete» lee los seis movimientos y cuadra los saldos', async () => {
    const fixture = findBankStatementFixture('valid-complete');
    const result = await engine.normalize(fixture!.build(), { fileName: fixture!.fileName });

    expect(result.transactions).toHaveLength(6);
    expect(result.balances.opening).toBe(25_000);
    expect(result.balances.closing).toBe(31_278.25);
    expect(result.quality.checksPassed).toBeGreaterThan(0);
  });

  it('«boundary-case» termina con advertencias, no limpio', async () => {
    const fixture = findBankStatementFixture('boundary-case');
    const result = await engine.normalize(fixture!.build(), { fileName: fixture!.fileName });

    // Es la razón de ser del estado SUCCEEDED_WITH_WARNINGS: hay resultado
    // utilizable, y a la vez algo que un humano debería mirar.
    expect(result.quality.warnings.length).toBeGreaterThan(0);
    expect(result.transactions.length).toBeGreaterThan(0);
  });

  it('«invalid-example» se rechaza como error de negocio', async () => {
    const fixture = findBankStatementFixture('invalid-example');

    // Importa que sea `StatementProcessingError` y no un fallo cualquiera: es
    // lo que el worker usa para decidir que NO hay que reintentar. Si esto se
    // rompiera, un documento que no es un extracto consumiría los tres intentos.
    await expect(
      engine.normalize(fixture!.build(), { fileName: fixture!.fileName }),
    ).rejects.toBeInstanceOf(StatementProcessingError);
  });

  /*
   * La compuerta de EMISOR, de punta a punta. Vive en esta suite y no en
   * `statement-issuer-gate.spec.ts` porque `pdfjs-dist` sólo puede cargarse en
   * una máquina virtual de Jest por corrida: dos suites leyendo PDF reales hacen
   * fallar a la segunda con `PDF_EXTRACTION_FAILED`, un error que señala al
   * documento y no al entorno. Allí se mide todo lo demás sobre texto ya
   * extraído, incluida la mitad que da sentido a esto: que el clasificador, por
   * sí solo, acepta este mismo documento.
   */
  it('«foreign-issuer» se rechaza por su emisor, no por su forma', async () => {
    const fixture = findBankStatementFixture('foreign-issuer');

    await expect(
      engine.normalize(fixture!.build(), { fileName: fixture!.fileName }),
    ).rejects.toMatchObject({ code: 'NON_BANKING_ISSUER' });
  });

  it('ese rechazo es un error de negocio, así que no consume reintentos', async () => {
    const fixture = findBankStatementFixture('foreign-issuer');
    await expect(
      engine.normalize(fixture!.build(), { fileName: fixture!.fileName }),
    ).rejects.toBeInstanceOf(StatementProcessingError);
  });

  it('escapa los caracteres que romperían el PDF', async () => {
    // `(`, `)` y `\` tienen significado dentro de una cadena literal de PDF.
    // Sin escaparlos el archivo queda corrupto y el lector falla, así que esto
    // vigila el generador, no el motor.
    const bytes = buildSyntheticPdf([
      { text: 'GLOSA (CON PARENTESIS) Y \\ BARRA', x: 20, y: lineY(0) },
    ]);
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(bytes.toString('latin1')).toContain('\\(CON PARENTESIS\\)');
  });

  it('declara escenarios con códigos únicos', () => {
    const codes = BANK_STATEMENT_FIXTURES.map((fixture) => fixture.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual(
      expect.arrayContaining(['valid-basic', 'valid-complete', 'boundary-case', 'invalid-example']),
    );
  });
});
