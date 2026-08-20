import { findAccountNumbers } from '../src/modules/workers/bank-statement/core/engine/generic/metadata-extractor';
import { validateStatement } from '../src/modules/workers/bank-statement/core/engine/quality/financial-validations';
import {
  currencyFromText,
  reconcileRunningBalance,
} from '../src/modules/workers/bank-statement/core/parsers/parser-helpers';
import type {
  BankTransaction,
  ParsedStatement,
  StatementMetadata,
} from '../src/modules/workers/bank-statement/core/domain/models';

/**
 * Un documento con varias cuentas no es un extracto, son varios.
 *
 * Las dos mitades de esta prueba salieron del mismo fallo medido. Un PDF de
 * sesenta páginas con doce cuentas no disparó ninguna de las salvaguardas que
 * existen para eso —el reconocedor de cuentas exigía que el identificador
 * empezara por dígito y aquí eran `CUENTA-TEST-P01-XXXX`—, así que el motor
 * mezcló las doce en silencio y contrastó los 1.082 movimientos contra el
 * período y los saldos de la primera: 867 fechas «fuera del período», que eran
 * los meses de las otras once, y 11 saltos de saldo que resultaron ser
 * exactamente las once fronteras entre cuentas.
 *
 * De ahí las dos afirmaciones: que las cuentas se reconozcan, y que lo que se
 * comprueba por cuenta se comprueba por cuenta.
 */

function movimiento(
  fecha: string,
  importe: string,
  saldo: string,
  account?: string,
): BankTransaction {
  return {
    transactionDate: fecha,
    description: 'MOVIMIENTO',
    amount: importe,
    balance: saldo,
    extractionConfidence: '1',
    ...(account ? { account } : {}),
  } as BankTransaction;
}

function metadatos(overrides: Partial<StatementMetadata> = {}): StatementMetadata {
  return {
    institutionCode: 'GENERICO',
    institutionName: '',
    accountNumber: '',
    accountCurrency: 'BOB',
    accountHolder: '',
    periodStart: '2026-01-01',
    periodEnd: '2026-01-28',
    openingBalance: '',
    closingBalance: '',
    ...overrides,
  } as StatementMetadata;
}

function informe(transactions: readonly BankTransaction[], metadata = metadatos()) {
  return validateStatement({ metadata, transactions } as ParsedStatement);
}

const codigos = (
  transactions: readonly BankTransaction[],
  metadata?: StatementMetadata,
): string[] => informe(transactions, metadata).issues.map((issue) => issue.code);

describe('reconocer las cuentas que un documento rotula', () => {
  it('lee un identificador con letras cuando el rótulo cierra con dos puntos', () => {
    expect(findAccountNumbers('Cuenta de prueba: CUENTA-TEST-P01-XXXX | Moneda: BOB')).toEqual([
      'CUENTA-TEST-P01-XXXX',
    ]);
  });

  it('cuenta como distintas las de un documento que publica varias', () => {
    const texto = [
      'Cuenta de prueba: CUENTA-TEST-P01-XXXX',
      'Cuenta de prueba: CUENTA-TEST-P02-XXXX',
      'Cuenta de prueba: CUENTA-TEST-P01-XXXX',
    ].join('\n');
    expect(findAccountNumbers(texto)).toEqual(['CUENTA-TEST-P01-XXXX', 'CUENTA-TEST-P02-XXXX']);
  });

  it('sigue leyendo la forma numérica de siempre, con o sin dos puntos', () => {
    expect(findAccountNumbers('Nro. de Cuenta 4010203040')).toEqual(['4010203040']);
    expect(findAccountNumbers('Cuenta: CA: 201-9988776')).toEqual(['201-9988776']);
  });

  /*
   * La otra mitad del reconocedor: lo que NO es una cuenta. Sin estas dos
   * condiciones —dos puntos, y algo que identifique— cualquier extracto con una
   * comisión de mantenimiento habría pasado por documento multicuenta, y la
   * corrección habría cambiado un fallo silencioso por otro.
   */
  it('no confunde con una cuenta la glosa que menciona la palabra', () => {
    expect(
      findAccountNumbers('COMISION MANTENIMIENTO CUENTA | CONTABILIZADA | TX-411526-T'),
    ).toEqual([]);
    expect(findAccountNumbers('INTERES A FAVOR CUENTA / CAPITALIZACION')).toEqual([]);
  });

  it('no toma por cuenta un valor que no identifica ninguna', () => {
    expect(findAccountNumbers('Cuenta de ahorro: Bolivianos')).toEqual([]);
  });
});

describe('validar un documento que trae varias cuentas', () => {
  /*
   * Dos cuentas, cada una encadenando su propio saldo y cada una recorriendo sus
   * propias fechas. Es la forma del documento que descubrió el fallo, reducida a
   * lo mínimo que la reproduce.
   */
  const dosCuentas: BankTransaction[] = [
    movimiento('2026-01-05', '100.00', '1100.00', 'CUENTA-TEST-P01-XXXX'),
    movimiento('2026-02-05', '-50.00', '1050.00', 'CUENTA-TEST-P01-XXXX'),
    movimiento('2026-01-07', '200.00', '9200.00', 'CUENTA-TEST-P02-XXXX'),
    movimiento('2026-02-07', '-25.00', '9175.00', 'CUENTA-TEST-P02-XXXX'),
  ];

  it('no llama salto de saldo al cambio de cuenta', () => {
    expect(codigos(dosCuentas)).not.toContain('continuidad-de-saldo');
  });

  it('no llama desorden a que cada cuenta vuelva a empezar', () => {
    expect(codigos(dosCuentas)).not.toContain('orden-cronologico');
  });

  it('no contrasta contra el período de la carátula, que describe sólo la primera', () => {
    expect(codigos(dosCuentas)).not.toContain('fechas-en-el-periodo');
  });

  /*
   * Y no por dejar de comprobar: una comprobación que no se ejecuta no se cuenta
   * como aprobada, que es lo que impide que un documento medio verificado
   * puntúe como uno que cuadra al céntimo.
   */
  it('las comprobaciones que no aplican no se cuentan como aprobadas', () => {
    const varias = informe(dosCuentas);
    const una = informe(dosCuentas.map((item) => ({ ...item, account: undefined })));
    expect(varias.checksRun).toBeLessThan(una.checksRun);
  });

  it('un salto DENTRO de una cuenta se sigue delatando', () => {
    const roto = [...dosCuentas];
    roto[1] = movimiento('2026-02-05', '-50.00', '999.99', 'CUENTA-TEST-P01-XXXX');
    expect(codigos(roto)).toContain('continuidad-de-saldo');
  });

  /*
   * Sobre la conciliación misma y no sobre el informe, porque hay DOS sitios que
   * la llaman —el servicio, para registrar la incidencia y bajar la confianza de
   * las filas afectadas; las validaciones, para puntuarla— y la garantía tiene
   * que valer para los dos. Corregirla en uno solo dejaba el registro avisando
   * de once rupturas que ya no existían, y once movimientos correctos con la
   * confianza rebajada a 0,40.
   */
  it('la conciliación no cruza la frontera entre cuentas, la llame quien la llame', () => {
    const filas = dosCuentas.map((item) => ({ ...item }));
    expect(reconcileRunningBalance(filas)).toBe(0);
    expect(filas.map((item) => item.extractionConfidence)).toEqual(['1', '1', '1', '1']);
  });
});

describe('la divisa rotulada en la carátula', () => {
  /*
   * Del mismo documento: rotulaba «Moneda: BOB» y salía `UNKNOWN`, mientras la
   * misma carátula en dólares se leía sin problema. Faltaba el código ISO de una
   * de las dos divisas, no había una decisión detrás.
   */
  it('lee los códigos ISO de las dos divisas', () => {
    expect(currencyFromText('Moneda: BOB')).toBe('BOB');
    expect(currencyFromText('Moneda: USD')).toBe('USD');
  });

  it('sigue leyendo las formas que ya leía', () => {
    expect(currencyFromText('Cuenta en Bolivianos')).toBe('BOB');
    expect(currencyFromText('Producto M/N')).toBe('BOB');
    expect(currencyFromText('Saldo en $us')).toBe('USD');
  });

  /*
   * `M/E` nombra una categoría y no una divisa: suponer cuál es sería peor que
   * no saberlo. La corrección de arriba no lo cambia.
   */
  it('no supone la divisa de «moneda extranjera»', () => {
    expect(currencyFromText('Producto M/E')).toBe('UNKNOWN');
  });
});

describe('validar un extracto de una sola cuenta', () => {
  /*
   * El caso de siempre no cambia: sin cuenta en los movimientos sale un único
   * tramo y se comprueba todo, incluido el período de la carátula.
   */
  const unaCuenta: BankTransaction[] = [
    movimiento('2026-01-05', '100.00', '1100.00'),
    movimiento('2026-03-05', '-50.00', '1050.00'),
  ];

  it('sí contrasta las fechas contra el período declarado', () => {
    expect(codigos(unaCuenta)).toContain('fechas-en-el-periodo');
  });

  it('sí delata un saldo que no encadena', () => {
    const roto = [
      movimiento('2026-01-05', '100.00', '1100.00'),
      movimiento('2026-01-06', '10.00', '5.00'),
    ];
    expect(codigos(roto)).toContain('continuidad-de-saldo');
  });
});
