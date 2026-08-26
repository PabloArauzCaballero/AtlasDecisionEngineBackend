/**
 * La capacidad de pago, medida sin PDF de por medio.
 *
 * Vive aparte de `bank-statement-fixtures.spec.ts` —donde se comprueba de punta
 * a punta— porque `pdfjs-dist` sólo se puede cargar en una máquina virtual de
 * Jest por corrida, y porque estas reglas se prueban mejor con los movimientos
 * puestos a mano: cada caso aísla UNA decisión del algoritmo, y construir un PDF
 * para cada una escondería la regla detrás de la maquetación.
 *
 * Lo que se fija aquí son los invariantes que hacen que la cifra signifique algo.
 * Un cambio que los rompa no es una recalibración: es otro algoritmo.
 */
import {
  assessAffordability,
  type AffordabilityInput,
} from '../src/modules/workers/bank-statement/core/engine/affordability/affordability-engine';
import type { AffordabilityTransaction } from '../src/modules/workers/bank-statement/core/engine/affordability/monthly-series';

const MESES = ['01', '02', '03'] as const;

function movimiento(
  date: string,
  description: string,
  amount: number,
  direction: 'in' | 'out',
): AffordabilityTransaction {
  return {
    date,
    description,
    debit: direction === 'out' ? amount : null,
    credit: direction === 'in' ? amount : null,
    balance: null,
  };
}

/** Tres meses de una vida financiera corriente, con lo mínimo que los define. */
function tresMeses(
  extra: (mes: string, indice: number) => AffordabilityTransaction[] = () => [],
): AffordabilityInput {
  const transactions = MESES.flatMap((mes, indice) => [
    movimiento(`2026-${mes}-28`, 'ABONO DE HABERES PLANILLA MENSUAL', 8000, 'in'),
    movimiento(`2026-${mes}-03`, 'PAGO CUOTA PRESTAMO PERSONAL 4412', 900, 'out'),
    movimiento(`2026-${mes}-05`, 'PAGO SERVICIO ELECTRICO CRE', 300, 'out'),
    movimiento(`2026-${mes}-08`, 'COMPRA SUPERMERCADO HIPERMAXI', 700, 'out'),
    movimiento(`2026-${mes}-18`, 'CONSUMO RESTAURANTE', 250, 'out'),
    ...extra(mes, indice),
  ]);
  return {
    transactions,
    periodFrom: '2026-01-01',
    periodTo: '2026-03-31',
    currency: 'BOB',
    closingBalance: null,
  };
}

describe('capacidad de pago derivada del extracto', () => {
  it('exige TRES meses completos y no evalúa con menos', () => {
    const unMes = assessAffordability({
      transactions: [
        movimiento('2026-03-28', 'ABONO DE HABERES PLANILLA MENSUAL', 8000, 'in'),
        movimiento('2026-03-03', 'PAGO CUOTA PRESTAMO PERSONAL', 900, 'out'),
        movimiento('2026-03-08', 'COMPRA SUPERMERCADO', 700, 'out'),
      ],
      periodFrom: '2026-03-01',
      periodTo: '2026-03-31',
      currency: 'BOB',
      closingBalance: null,
    });

    expect(unMes.eligible).toBe(false);
    expect(unMes.coverage.monthsComplete).toBe(1);
    expect(unMes.coverage.minimumMonthsRequired).toBe(3);
    expect(unMes.reasons.map((reason) => reason.code)).toContain('AFF_PERIODO_INSUFICIENTE');
    // Y no publica una capacidad de cero, que se leería como «no puede pagar
    // nada» cuando lo cierto es «no se pudo medir».
    expect(unMes.capacity.maxAffordableInstallment).toBe(0);
    expect(unMes.score).toBe(0);
  });

  it('el mínimo de tres meses NO se puede bajar por configuración', () => {
    const evaluacion = assessAffordability(
      {
        transactions: [
          movimiento('2026-03-28', 'ABONO DE HABERES PLANILLA MENSUAL', 8000, 'in'),
          movimiento('2026-03-08', 'COMPRA SUPERMERCADO', 700, 'out'),
        ],
        periodFrom: '2026-03-01',
        periodTo: '2026-03-31',
        currency: 'BOB',
        closingBalance: null,
      },
      { minimumMonths: 1 },
    );

    expect(evaluacion.coverage.minimumMonthsRequired).toBe(3);
    expect(evaluacion.eligible).toBe(false);
  });

  it('reconoce el sueldo como ingreso MENSUAL, no como la suma del periodo', () => {
    const evaluacion = assessAffordability(tresMeses());

    expect(evaluacion.eligible).toBe(true);
    expect(evaluacion.income.monthlyRecognized).toBe(8000);
    expect(evaluacion.months).toHaveLength(3);
  });

  it('descarta el traspaso entre cuentas propias, el reverso y el desembolso de crédito', () => {
    const evaluacion = assessAffordability(
      tresMeses((mes) => [
        movimiento(`2026-${mes}-10`, 'TRASPASO ENTRE CUENTAS PROPIAS', 5000, 'in'),
        movimiento(`2026-${mes}-11`, 'DEVOLUCION DE COMPRA ANULADA', 400, 'in'),
        movimiento(`2026-${mes}-12`, 'DESEMBOLSO PRESTAMO PERSONAL', 3000, 'in'),
      ]),
    );

    // Entraron 16.400 al mes y el ingreso reconocido sigue siendo el sueldo.
    expect(evaluacion.income.monthlyRecognized).toBe(8000);
    expect(evaluacion.income.excluded.INTERNAL_TRANSFER).toBe(15_000);
    expect(evaluacion.income.excluded.REVERSAL).toBe(1_200);
    expect(evaluacion.income.excluded.CREDIT_DISBURSEMENT).toBe(9_000);
  });

  it('rescata por CADENCIA el ingreso cuya glosa no lo identifica', () => {
    /*
     * El caso del trabajador por cuenta propia, que es a quien peor trata un
     * modelo de nómina: cobra por transferencia entre particulares y su glosa no
     * dice nada. Tres apariciones en tres meses con importe parecido bastan.
     */
    const evaluacion = assessAffordability({
      transactions: MESES.flatMap((mes) => [
        movimiento(`2026-${mes}-15`, 'ABONO POR PLANILLA DE OBRA CIVIL', 5200, 'in'),
        movimiento(`2026-${mes}-05`, 'PAGO SERVICIO ELECTRICO CRE', 300, 'out'),
        movimiento(`2026-${mes}-08`, 'COMPRA SUPERMERCADO HIPERMAXI', 700, 'out'),
      ]),
      periodFrom: '2026-01-01',
      periodTo: '2026-03-31',
      currency: 'BOB',
      closingBalance: null,
    });

    expect(evaluacion.eligible).toBe(true);
    expect(evaluacion.income.monthlyRecognized).toBeGreaterThan(5_000);
  });

  it('separa la cuota del préstamo del gasto del supermercado', () => {
    const evaluacion = assessAffordability(tresMeses());

    // La cuota y nada más: el seguro no está en este escenario y el
    // supermercado es gasto comprometido pero NO deuda con un tercero.
    expect(evaluacion.obligations.monthly).toBe(900);
    expect(evaluacion.expenses.committedMonthly).toBeGreaterThanOrEqual(1_900);
    expect(evaluacion.expenses.discretionaryMonthly).toBe(250);
  });

  it('aplica el piso de subsistencia cuando el extracto enseña menos gasto del que cuesta vivir', () => {
    /*
     * El error clásico de «ingreso menos gasto observado»: quien paga casi todo
     * en efectivo enseña un extracto austerísimo y sale con un disponible que no
     * existe. El piso ancla la resta en lo que cuesta vivir aunque el documento
     * no lo enseñe.
     */
    const evaluacion = assessAffordability({
      transactions: MESES.flatMap((mes) => [
        movimiento(`2026-${mes}-28`, 'ABONO DE HABERES PLANILLA MENSUAL', 8000, 'in'),
        movimiento(`2026-${mes}-05`, 'PAGO SERVICIO ELECTRICO CRE', 120, 'out'),
        movimiento(`2026-${mes}-06`, 'CONSUMO RESTAURANTE', 60, 'out'),
        movimiento(`2026-${mes}-07`, 'COMPRA TIENDA', 40, 'out'),
      ]),
      periodFrom: '2026-01-01',
      periodTo: '2026-03-31',
      currency: 'BOB',
      closingBalance: null,
    });

    expect(evaluacion.expenses.subsistenceFloorApplied).toBe(true);
    expect(evaluacion.expenses.effectiveMonthly).toBeGreaterThan(
      evaluacion.expenses.committedMonthly,
    );
    // Y el disponible NO es 8.000 - 120.
    expect(evaluacion.capacity.disposableIncome).toBeLessThan(6_000);
  });

  it('la cuota máxima nunca supera ninguno de los tres topes', () => {
    const evaluacion = assessAffordability(tresMeses());
    const { income, obligations, capacity } = evaluacion;

    expect(capacity.maxAffordableInstallment).toBeLessThanOrEqual(income.monthlyRecognized * 0.15);
    expect(capacity.maxAffordableInstallment).toBeLessThanOrEqual(
      capacity.stressedDisposableIncome * 0.5 + 0.01,
    );
    expect(obligations.monthly + capacity.maxAffordableInstallment).toBeLessThanOrEqual(
      income.monthlyRecognized * 0.35 + 0.01,
    );
    expect(['DISPONIBLE', 'PTI', 'DSTI']).toContain(capacity.bindingConstraint);
  });

  it('un mes extraordinario NO decide el ingreso', () => {
    /*
     * El aguinaldo. Con la media, un mes de 24.000 sobre dos de 8.000 daría un
     * ingreso de 13.333 y el motor concluiría que la persona gana eso todos los
     * meses. La mediana lo ignora, y como se toma la MENOR entre mediana y media
     * recortada, el resultado se queda en el sueldo real.
     */
    const evaluacion = assessAffordability({
      transactions: [
        movimiento('2026-01-28', 'ABONO DE HABERES PLANILLA MENSUAL', 8000, 'in'),
        movimiento('2026-02-28', 'ABONO DE HABERES PLANILLA MENSUAL', 8000, 'in'),
        movimiento('2026-03-28', 'ABONO DE HABERES PLANILLA MENSUAL', 24000, 'in'),
        ...MESES.map((mes) => movimiento(`2026-${mes}-08`, 'COMPRA SUPERMERCADO', 700, 'out')),
      ],
      periodFrom: '2026-01-01',
      periodTo: '2026-03-31',
      currency: 'BOB',
      closingBalance: null,
    });

    expect(evaluacion.income.monthlyRecognized).toBe(8_000);
    expect(evaluacion.income.median).toBe(8_000);
  });

  it('castiga el ingreso volátil y el que viene cayendo', () => {
    const cayendo = assessAffordability({
      transactions: [
        movimiento('2026-01-28', 'ABONO DE HABERES PLANILLA MENSUAL', 12000, 'in'),
        movimiento('2026-02-28', 'ABONO DE HABERES PLANILLA MENSUAL', 9000, 'in'),
        movimiento('2026-03-28', 'ABONO DE HABERES PLANILLA MENSUAL', 6000, 'in'),
        ...MESES.map((mes) => movimiento(`2026-${mes}-08`, 'COMPRA SUPERMERCADO', 700, 'out')),
      ],
      periodFrom: '2026-01-01',
      periodTo: '2026-03-31',
      currency: 'BOB',
      closingBalance: null,
    });

    expect(cayendo.income.trend).toBeLessThan(0);
    expect(cayendo.income.stressed).toBeLessThan(cayendo.income.monthlyRecognized);
    expect(cayendo.reasons.map((reason) => reason.code)).toContain('AFF_INGRESO_DECRECIENTE');
  });

  it('cuenta los rechazos por fondos y baja el puntaje', () => {
    const limpio = assessAffordability(tresMeses());
    const conRechazos = assessAffordability(
      tresMeses((mes) => [
        movimiento(
          `2026-${mes}-06`,
          'COMISION POR CHEQUE DEVUELTO FONDOS INSUFICIENTES',
          35,
          'out',
        ),
      ]),
    );

    expect(conRechazos.signals.nsfEvents).toBe(3);
    expect(conRechazos.signals.nsfMonths).toBe(3);
    expect(conRechazos.score).toBeLessThan(limpio.score);
    expect(conRechazos.reasons.map((reason) => reason.code)).toContain('AFF_RECHAZOS_POR_FONDOS');
  });

  it('marca el endeudamiento circular: se pagan cuotas y entran desembolsos', () => {
    const evaluacion = assessAffordability(
      tresMeses((mes) => [
        movimiento(`2026-${mes}-16`, 'DESEMBOLSO PRESTAMO PERSONAL', 4000, 'in'),
      ]),
    );

    expect(evaluacion.signals.creditDisbursementsReceived).toBe(12_000);
    expect(evaluacion.reasons.map((reason) => reason.code)).toContain('AFF_ENDEUDAMIENTO_CIRCULAR');
  });

  it('marca el gasto de alto riesgo sin confundirlo con consumo', () => {
    const evaluacion = assessAffordability(
      tresMeses((mes) => [movimiento(`2026-${mes}-20`, 'PAGO CASINO ONLINE BETANO', 800, 'out')]),
    );

    expect(evaluacion.signals.highRiskMonths).toBe(3);
    expect(evaluacion.signals.highRiskSpend).toBe(2_400);
    expect(evaluacion.reasons.map((reason) => reason.code)).toContain('AFF_GASTO_DE_ALTO_RIESGO');
  });

  it('la banda nunca es buena sin cuota que quepa', () => {
    /*
     * Un expediente con ingreso perfectamente estable, sin deudas y sin margen
     * —porque el gasto esencial se lleva el sueldo entero— podría salir con buen
     * puntaje por estabilidad y carga. La banda tiene que ser coherente con la
     * única cifra que después se usa para prestar.
     */
    const evaluacion = assessAffordability({
      transactions: MESES.flatMap((mes) => [
        movimiento(`2026-${mes}-28`, 'ABONO DE HABERES PLANILLA MENSUAL', 3000, 'in'),
        movimiento(`2026-${mes}-05`, 'PAGO ALQUILER', 1800, 'out'),
        movimiento(`2026-${mes}-08`, 'COMPRA SUPERMERCADO HIPERMAXI', 1400, 'out'),
      ]),
      periodFrom: '2026-01-01',
      periodTo: '2026-03-31',
      currency: 'BOB',
      closingBalance: null,
    });

    expect(evaluacion.capacity.maxAffordableInstallment).toBe(0);
    expect(evaluacion.band).toBe('INSUFICIENTE');
    expect(evaluacion.reasons.map((reason) => reason.code)).toContain('AFF_SIN_MARGEN');
  });

  it('un mes de los bordes no entra en la estadística', () => {
    /*
     * Un extracto del 12 de enero al 31 de marzo toca tres meses y sólo cubre
     * dos enteros. Contar el de enero bajaría a la vez la mediana del ingreso y
     * la del gasto, y describiría un mes que la persona no vivió.
     */
    const evaluacion = assessAffordability({
      transactions: MESES.flatMap((mes) => [
        movimiento(`2026-${mes}-28`, 'ABONO DE HABERES PLANILLA MENSUAL', 8000, 'in'),
        movimiento(`2026-${mes}-15`, 'COMPRA SUPERMERCADO HIPERMAXI', 700, 'out'),
      ]),
      periodFrom: '2026-01-12',
      periodTo: '2026-03-31',
      currency: 'BOB',
      closingBalance: null,
    });

    expect(evaluacion.coverage.monthsObserved).toBe(3);
    expect(evaluacion.coverage.monthsComplete).toBe(2);
    expect(evaluacion.eligible).toBe(false);
  });

  it('publica su versión de modelo: una cifra sin versión no se puede auditar', () => {
    expect(assessAffordability(tresMeses()).modelVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
