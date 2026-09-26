import {
  ARQUITECTURA_DEFENSIVA,
  CASOS_DE_REGRESION_EXTRACTOS,
  COBERTURA_POR_EMISOR,
  GLOSARIO_OFICIAL,
  MARCAS_DE_BILLETERA,
  PARAMETROS_DE_CAPACIDAD,
  PROCEDENCIA_CORPUS_EXTRACTOS,
  RATIOS_COMPARADOS,
  SUBSISTENCIA,
  TIPOS_DE_DOCUMENTO,
} from '../src/modules/workers/bank-statement/core/corpus/corpus-extractos.generated';
import {
  directionCoherence,
  lookupOfficialGlossary,
} from '../src/modules/workers/bank-statement/core/engine/affordability/official-glossary';
import {
  assessAffordability,
  type AffordabilityInput,
} from '../src/modules/workers/bank-statement/core/engine/affordability/affordability-engine';
import {
  AFFORDABILITY_PARAMETER_PROVENANCE,
  DEFAULT_AFFORDABILITY_POLICY,
} from '../src/modules/workers/bank-statement/core/engine/affordability/affordability-policy';
import {
  buildMonthlySeries,
  classifyMovements,
  observationWindow,
} from '../src/modules/workers/bank-statement/core/engine/affordability/monthly-series';
import { buildBalanceSeries } from '../src/modules/workers/bank-statement/core/engine/affordability/balance-series';
import { readTaxGloss } from '../src/modules/workers/bank-statement/core/engine/quality/bolivia-taxes';
import {
  detectNonBankingIssuer,
  detectWalletOperator,
} from '../src/modules/workers/bank-statement/core/institutions/non-banking-issuers';
import { assessProvenance } from '../src/modules/workers/bank-statement/core/engine/authenticity/pdf-forensics';
import { dispositionOf } from '../src/modules/workers/bank-statement/core/domain/errors';
import { wilson, zeroErrorUpperBound } from '../src/common/statistics/binomial';

/**
 * Los 21 casos de contrato del corpus de extractos, ejecutados contra el código.
 *
 * No miden el worker: fijan lo que el worker NO puede hacer. Cada uno existe
 * porque es un error que ya se cometió o que está a un refactor de distancia —
 * convertir un dato desconocido en cero, leer una glosa como si fuera la
 * columna, dejar que un metadato favorable tape un fallo de seguridad— y todos
 * comparten la misma forma: una afirmación que los datos no sostienen.
 *
 * La lista de casos se carga DEL CORPUS, así que si el corpus crece y el código
 * no, esta prueba se entera.
 */
describe('corpus de extractos · casos de regresión', () => {
  const caso = (id: string) => {
    const encontrado = CASOS_DE_REGRESION_EXTRACTOS.find((registro) => registro.id === id);
    if (!encontrado) throw new Error(`El corpus ya no trae el caso ${id}`);
    return encontrado;
  };

  it('están los 21 casos y ninguno se quedó sin ejecutar aquí', () => {
    expect(CASOS_DE_REGRESION_EXTRACTOS.length).toBe(21);
    const ejecutados = new Set(
      CASOS_DE_REGRESION_EXTRACTOS.map((registro) => registro.id).filter((id) =>
        EJECUTADOS.includes(id),
      ),
    );
    expect([...ejecutados].sort()).toEqual(
      [...CASOS_DE_REGRESION_EXTRACTOS.map((r) => r.id)].sort(),
    );
  });

  describe('OFFICIAL_LITERAL_LOOKUP · las ocho consultas al glosario oficial', () => {
    const literales = CASOS_DE_REGRESION_EXTRACTOS.filter(
      (registro) => registro.clase === 'OFFICIAL_LITERAL_LOOKUP',
    );

    it('hay ocho y todas resuelven contra el glosario del emisor', () => {
      expect(literales.length).toBe(8);
      for (const registro of literales) {
        const entrada = registro.entrada as { issuer_code: string; raw_glosa: string };
        const esperado = registro.esperado as {
          record_ids: string[];
          analytical_categories: string[];
          direction_override_allowed: boolean;
        };

        const consulta = lookupOfficialGlossary(entrada.issuer_code, entrada.raw_glosa);
        expect([...consulta.matches.map((m) => m.entry.id)].sort()).toEqual(
          [...esperado.record_ids].sort(),
        );
        expect([...consulta.categories].sort()).toEqual([...esperado.analytical_categories].sort());
        for (const match of consulta.matches) {
          expect(match.entry.permiteContradecirDireccion).toBe(esperado.direction_override_allowed);
        }
      }
    });

    it('«CERTIFI CADO» es ambigua en el glosario, y se dice en vez de elegir', () => {
      const consulta = lookupOfficialGlossary('BCR', 'CERTIFI CADO');
      expect(consulta.ambiguous).toBe(true);
      expect([...consulta.categories].sort()).toEqual(['CERTIFICATE', 'FEE']);
      // Con dos filas que declaran lados distintos, el emisor no declara ninguno.
      expect(consulta.declaredDirection).toBe(null);
    });

    it('no se inventa el glosario de un emisor que no lo publica', () => {
      expect(lookupOfficialGlossary('BNB', 'ACH REC').matches).toEqual([]);
      expect(lookupOfficialGlossary(null, 'ACH REC').matches).toEqual([]);
    });

    it('un literal de una o dos letras sólo casa exacto, nunca por prefijo', () => {
      // `I` es banca por internet en el glosario; casarlo por prefijo
      // convertiría cualquier glosa que empiece por «I » en una operación web.
      expect(lookupOfficialGlossary('BCR', 'INTERESES GANADOS DEL MES').matches).toEqual([]);
      expect(lookupOfficialGlossary('BCR', 'I').matches.length).toBeGreaterThan(0);
    });

    it('el literal más largo gana: ACH REC describe mejor que ACH', () => {
      const consulta = lookupOfficialGlossary('BCR', 'ACH REC 00112233');
      expect(consulta.matches.map((m) => m.entry.id)).toEqual(['BCR_G007']);
    });

    it('los huecos que el propio literal declara se rellenan, y nada más', () => {
      // `COBRO_SPF_AAAAMM` declara un año y un mes en su propio literal.
      const consulta = lookupOfficialGlossary('BCR', 'COBRO_SPF_202603');
      expect(consulta.categories).toEqual(['INSURANCE']);
      // `D.A. "Empresa"` declara el hueco del nombre de la empresa.
      expect(lookupOfficialGlossary('BCR', 'D.A. ELECTROPAZ').categories).toEqual(['UTILITIES']);
    });
  });

  describe('C10 · la columna contable manda sobre la dirección declarada', () => {
    it('una glosa de retención judicial que llega como ABONO no se voltea', () => {
      const consulta = lookupOfficialGlossary('BCR', 'NCRSIREJRET');
      expect(consulta.declaredDirection).toBe('DEBIT');
      // Se DECLARA la discrepancia; no se cambia el lado de la fila.
      expect(directionCoherence(consulta, 'INFLOW')).toBe('CONTRADICTS_GLOSSARY');
      expect(directionCoherence(consulta, 'OUTFLOW')).toBe('COHERENT');
    });

    it('una glosa bidireccional no se puede contradecir', () => {
      const consulta = lookupOfficialGlossary('BCR', 'ACH');
      expect(consulta.declaredDirection).toBe('BOTH');
      expect(directionCoherence(consulta, 'INFLOW')).toBe('NOT_EVALUABLE');
    });

    it('la regla de importación del corpus sigue escrita en el propio corpus', () => {
      expect(PROCEDENCIA_CORPUS_EXTRACTOS.reglasDeImportacion).toContain(
        'No forzar lado contable por glosa',
      );
    });
  });

  describe('el glosario decide sobre el INGRESO, y sólo puede quitarlo', () => {
    const movimiento = (description: string, credit: number) => ({
      date: '2026-03-10',
      description,
      debit: null,
      credit,
      balance: 1000,
    });

    it('«PAGO DE HABERES» es candidato a nómina; «PagoHAB» no lo es', () => {
      const [nomina] = classifyMovements([movimiento('PAGO DE HABERES', 5000)], {
        issuerCode: 'BCR',
      });
      expect(nomina.kind).toBe('PAYROLL');
      expect(nomina.classifiedBy).toBe('OFFICIAL_GLOSSARY');

      // `PagoHAB` es la planilla que una empresa PAGA: el corpus lo marca
      // `DO_NOT_ASSUME_INCOME` aunque su categoría se llame SALARY_PAYMENT.
      const [planilla] = classifyMovements([movimiento('PagoHAB', 5000)], { issuerCode: 'BCR' });
      expect(planilla.kind).toBe('ONE_OFF');
      expect(planilla.officialIncomeTreatment).toBe('DO_NOT_ASSUME_INCOME');
    });

    it('un desembolso de crédito entra como deuda, no como ingreso', () => {
      const [fijo] = classifyMovements([movimiento('ACTIVO FIJO', 20000)], { issuerCode: 'BCR' });
      expect(fijo.kind).toBe('CREDIT_DISBURSEMENT');
    });

    it('sin emisor conocido, el léxico de siempre sigue mandando', () => {
      const [sinEmisor] = classifyMovements([movimiento('PAGO DE HABERES', 5000)]);
      expect(sinEmisor.kind).toBe('PAYROLL');
      expect(sinEmisor.classifiedBy).toBe('LOCAL_LEXICON');
    });
  });

  describe('ROUTE_IMAGE y ROUTE_MIXED · una imagen no se rechaza, se mira', () => {
    it('un PDF sin capa de texto y sin OCR va a una persona', () => {
      expect(caso('ROUTE_IMAGE').esperado).toMatchObject({ route: 'HUMAN_REVIEW' });
      expect(dispositionOf('SCANNED_PDF_UNSUPPORTED')).toBe('REVIEW');
    });

    it('un encabezado con texto y una tabla en imagen también', () => {
      expect(caso('ROUTE_MIXED').esperado).toMatchObject({ route: 'HUMAN_REVIEW' });
      expect(dispositionOf('NO_TRANSACTIONS')).toBe('REVIEW');
    });

    it('el corpus enruta la imagen a revisión humana, no al rechazo ni al OCR fingido', () => {
      expect(ARQUITECTURA_DEFENSIVA.rutaSoloImagen).toBe('HUMAN_REVIEW_NO_OCR_CONNECTED');
      const soloImagen = TIPOS_DE_DOCUMENTO.find((t) => t.id === 'UNREADABLE_OR_IMAGE_ONLY');
      expect(soloImagen?.ruta).toBe('HUMAN_REVIEW');
    });
  });

  describe('PARTIAL_MONTHS · dos meses de tres avisan, no rechazan', () => {
    it('la exigencia de meses no está activada por defecto', () => {
      expect(caso('PARTIAL_MONTHS').esperado).toMatchObject({ hard_reject: false, warning: true });
      expect(DEFAULT_AFFORDABILITY_POLICY.enforceMinimumMonths).toBe(false);
    });

    it('y la evaluación lo dice con su motivo en vez de callarlo', () => {
      const evaluacion = assessAffordability(dosMesesCompletos());
      expect(evaluacion.eligible).toBe(false);
      expect(evaluacion.reasons.map((r) => r.code)).toContain('AFF_PERIODO_INSUFICIENTE');
      expect(evaluacion.coverage.monthsComplete).toBeLessThan(3);
    });
  });

  describe('MISSING_DEBT · lo desconocido no se convierte en cero', () => {
    it('la deuda externa no observada llega como null y la carga es un suelo', () => {
      expect(caso('MISSING_DEBT').esperado).toMatchObject({
        external_debt_service: null,
        may_assert_zero: false,
      });
      const evaluacion = assessAffordability(tresMesesConSueldo());
      expect(evaluacion.obligations.externalDebtService).toBe(null);
      expect(evaluacion.obligations.isLowerBound).toBe(true);
      expect(evaluacion.reasons.map((r) => r.code)).toContain('AFF_DEUDA_EXTERNA_NO_OBSERVADA');
    });

    it('cuando SÍ se conoce, suma y deja de ser un suelo', () => {
      const evaluacion = assessAffordability({
        ...tresMesesConSueldo(),
        externalDebtService: 900,
      });
      expect(evaluacion.obligations.externalDebtService).toBe(900);
      expect(evaluacion.obligations.isLowerBound).toBe(false);
      expect(evaluacion.obligations.monthly).toBeGreaterThanOrEqual(900);
    });
  });

  describe('ZERO_VS_UNCOVERED · un mes vacío cubierto vale cero; uno no cubierto, nada', () => {
    it('el mes sin movimientos existe en la serie y aporta ingreso cero', () => {
      expect(caso('ZERO_VS_UNCOVERED').esperado).toMatchObject({
        covered_income_minor_units: 0,
        uncovered_income_minor_units: null,
      });
      const movimientos = classifyMovements(tresMesesConFebreroVacio().transactions);
      const ventana = observationWindow(movimientos, { from: '2026-01-01', to: '2026-03-31' })!;
      const meses = buildMonthlySeries(movimientos, ventana);

      const febrero = meses.find((mes) => mes.month === '2026-02');
      expect(febrero).toBeDefined();
      expect(febrero!.hasActivity).toBe(false);
      expect(febrero!.recognizedIncome).toBe(0);

      // Un mes fuera de la ventana no existe: no es cero, es que no se observó.
      expect(meses.find((mes) => mes.month === '2025-12')).toBeUndefined();
    });
  });

  describe('MEAN_NOT_MIN · el mínimo y la media no son intercambiables', () => {
    it('reproduce el contraejemplo aritmético del corpus', () => {
      const esperado = caso('MEAN_NOT_MIN').esperado as {
        minimum_minor_units: number;
        time_weighted_mean_minor_units: number;
      };

      // 29 días a 10.000 y un día a 0, en unidades menores del corpus.
      const movimientos = classifyMovements(
        Array.from({ length: 30 }, (_, indice) => ({
          date: `2026-01-${String(indice + 1).padStart(2, '0')}`,
          description: 'MOVIMIENTO',
          debit: null,
          credit: 1,
          balance: indice === 29 ? 0 : 1_000_000,
        })),
      );
      const serie = buildBalanceSeries(movimientos, {
        from: new Date('2026-01-01T00:00:00Z'),
        to: new Date('2026-01-30T00:00:00Z'),
      });

      expect(serie.minimum).toBe(esperado.minimum_minor_units);
      expect(serie.timeWeightedMean).toBeCloseTo(esperado.time_weighted_mean_minor_units, 6);
      expect(serie.daysCovered).toBe(30);
    });

    it('una cuenta vacía todo el mes comparte mínimo y no media', () => {
      const movimientos = classifyMovements([
        { date: '2026-01-01', description: 'X', debit: null, credit: 0, balance: 0 },
        { date: '2026-01-30', description: 'X', debit: null, credit: 0, balance: 0 },
      ]);
      const serie = buildBalanceSeries(movimientos, {
        from: new Date('2026-01-01T00:00:00Z'),
        to: new Date('2026-01-30T00:00:00Z'),
      });
      expect(serie.minimum).toBe(0);
      expect(serie.timeWeightedMean).toBe(0);
    });

    it('un descubierto de varios días es UN episodio, no varios', () => {
      const movimientos = classifyMovements([
        { date: '2026-01-01', description: 'X', debit: null, credit: 0, balance: 100 },
        { date: '2026-01-05', description: 'X', debit: 200, credit: null, balance: -100 },
        { date: '2026-01-10', description: 'X', debit: null, credit: 300, balance: 200 },
      ]);
      const serie = buildBalanceSeries(movimientos, {
        from: new Date('2026-01-01T00:00:00Z'),
        to: new Date('2026-01-10T00:00:00Z'),
      });
      expect(serie.negativeDays).toBe(5);
      expect(serie.overdraftEpisodes).toBe(1);
    });
  });

  describe('plausibilidad económica · se mide, no se acusa', () => {
    it('el circuito de dinero se describe con su ratio, sin umbral', () => {
      // Entra 5.000 de alguien y salen 5.000 al mismo sitio, tres meses.
      const circular = assessAffordability({
        ...tresMesesConSueldo(),
        transactions: [
          ...tresMesesConSueldo().transactions,
          ...['2026-01', '2026-02', '2026-03'].flatMap((mes) => [
            {
              date: `${mes}-05`,
              description: 'TRANSFERENCIA DE JUAN PEREZ',
              debit: null,
              credit: 5000,
              balance: 9000,
            },
            {
              date: `${mes}-06`,
              description: 'TRANSFERENCIA DE JUAN PEREZ',
              debit: 5000,
              credit: null,
              balance: 4000,
            },
          ]),
        ],
      });
      expect(circular.signals.plausibility.bidirectionalCounterparties).toBeGreaterThan(0);
      expect(circular.signals.plausibility.pairedCounterpartyRatio).toBeGreaterThan(0);
      // Y NO produce ningún motivo: describir no es acusar.
      expect(circular.reasons.map((r) => r.code)).not.toContain('AFF_ENDEUDAMIENTO_CIRCULAR');
    });

    it('la ventana de concentración viaja declarada, no implícita', () => {
      const evaluacion = assessAffordability(tresMesesConSueldo());
      expect(evaluacion.signals.plausibility.concentrationWindowDays).toBe(7);
      expect(evaluacion.signals.plausibility.preCloseInflowRatio).toBeGreaterThanOrEqual(0);
    });

    it('sin abonos no hay ratio de salida: null, no cero', () => {
      const soloCargos = assessAffordability({
        ...tresMesesConSueldo(),
        transactions: tresMesesConSueldo().transactions.filter((t) => t.credit === null),
      });
      expect(soloCargos.signals.plausibility.outflowToInflowRatio).toBe(null);
    });

    it('los movimientos repetidos se cuentan, y no se decide por qué', () => {
      const base = tresMesesConSueldo();
      const duplicado = base.transactions[0];
      const evaluacion = assessAffordability({
        ...base,
        transactions: [...base.transactions, duplicado],
      });
      expect(evaluacion.signals.plausibility.duplicateMovements).toBe(1);
    });
  });

  describe('SECURITY_AXIS · un generador conocido no compensa un fallo de seguridad', () => {
    it('el crédito de procedencia no toca el eje de seguridad', () => {
      expect(caso('SECURITY_AXIS').esperado).toMatchObject({
        known_producer_may_cancel_security_failure: false,
      });
      const informe = assessProvenance(
        {
          producer: 'Jasper Reports',
          creator: 'Jasper Reports',
          creationDate: null,
          modificationDate: null,
          incrementalUpdates: 0,
          hasAcroForm: false,
          annotationSubtypes: [],
          hasActiveContent: true,
          embeddedFileCount: 0,
          fontsDeclared: 2,
          fontsEmbedded: 2,
          nonStandardFonts: 0,
          pdfVersion: '1.7',
        },
        1,
      );
      expect(informe.securityScore).toBe(100);
      expect(informe.suspicionScore).toBe(100);
      // El crédito existe y vive donde corresponde: en procedencia.
      expect(informe.signals.some((s) => s.code === 'GENERADOR_INSTITUCIONAL')).toBe(true);
      expect(informe.provenanceScore).toBe(0);
    });

    it('los pesos se publican como lo que son: no calibrados', () => {
      const informe = assessProvenance(
        {
          producer: null,
          creator: null,
          creationDate: null,
          modificationDate: null,
          incrementalUpdates: 0,
          hasAcroForm: false,
          annotationSubtypes: [],
          hasActiveContent: false,
          embeddedFileCount: 0,
          fontsDeclared: 0,
          fontsEmbedded: 0,
          nonStandardFonts: 0,
          pdfVersion: '1.4',
        },
        1,
      );
      expect(informe.calibration).toBe('UNCALIBRATED_WEIGHTS_DECLARED_IN_BRIEF');
    });

    it('la ausencia de firma no es un rechazo', () => {
      expect(ARQUITECTURA_DEFENSIVA.ausenciaDeFirmaNoEsRechazo).toBe(true);
    });
  });

  describe('BCP_QR · un QR verifica contra el emisor; su presencia no prueba nada', () => {
    it('la ficha del emisor no afirma firma criptográfica', () => {
      expect(caso('BCP_QR').esperado).toMatchObject({
        cryptographic_signature_required: false,
        authenticity_proved_by_presence_alone: false,
      });
      const bcp = COBERTURA_POR_EMISOR.find((emisor) => emisor.codigo === 'BCR');
      expect(bcp?.verificacion.tipo).toBe('qr');
      expect(bcp?.verificacion.firmaCriptografica).toBe(false);
    });
  });

  describe('TIGO_DISTINCTION · la marca no es el operador', () => {
    it('un estado de cuenta de Tigo Money ya no se rechaza como telefónica', () => {
      expect(caso('TIGO_DISTINCTION').esperado).toMatchObject({
        operator_code: 'MEF',
        reject_as_telecom_only: false,
      });
      const caratula = 'TIGO MONEY — ESTADO DE CUENTA DE BILLETERA MÓVIL\nE-FECTIVO ESPM S.A.';
      expect(detectNonBankingIssuer(caratula)).toBeUndefined();
      expect(detectWalletOperator(caratula)?.operator.code).toBe('MEF');
    });

    it('y la factura de la telefónica del mismo grupo se sigue rechazando', () => {
      const factura = 'TIGO — FACTURA DE SERVICIOS DE TELEFONÍA MÓVIL\nTELECEL S.A.';
      expect(detectNonBankingIssuer(factura)?.code).toBe('TIGO');
      expect(detectWalletOperator(factura)).toBeUndefined();
    });

    it('el corpus registra la marca con su operador licenciado', () => {
      const tigo = MARCAS_DE_BILLETERA.find((marca) => marca.marca === 'Tigo Money');
      expect(tigo?.operador).toBe('MEF');
      expect(tigo?.admisionComoEvidencia).toBe('POTENTIAL_NOT_AUTOMATIC');
    });
  });

  describe('HISTORICAL_RATIO · una norma histórica no activa una política vigente', () => {
    it('el 15 % histórico llega marcado como no vinculante hoy', () => {
      expect(caso('HISTORICAL_RATIO').esperado).toMatchObject({
        current_universal_bolivia_rule_verified: false,
      });
      const historico = RATIOS_COMPARADOS.find((ratio) => ratio.id === 'BO_HISTORICAL_15');
      expect(historico?.valor).toBe(0.15);
      expect(historico?.estado).toBe('HISTORICAL_ONLY');
      expect(historico?.vinculanteHoy).toBe(false);
    });

    it('y ninguno de los ocho parámetros se declara calibrado', () => {
      expect(PARAMETROS_DE_CAPACIDAD.length).toBe(8);
      for (const parametro of PARAMETROS_DE_CAPACIDAD) {
        expect(parametro.calibradoConMora).toBe(false);
        expect(parametro.sustitutoVerificado).toBe(null);
      }
    });

    it('la política del código no se ha desviado de lo que el corpus audita', () => {
      for (const procedencia of AFFORDABILITY_PARAMETER_PROVENANCE) {
        const auditado = PARAMETROS_DE_CAPACIDAD.find((p) => p.id === procedencia.auditId);
        expect(auditado).toBeDefined();
        expect(procedencia.auditedValue).toBe(auditado!.valorActual);
        expect(DEFAULT_AFFORDABILITY_POLICY[procedencia.field]).toBe(auditado!.valorActual);
      }
    });

    it('la evaluación publica que sus umbrales no están calibrados', () => {
      const evaluacion = assessAffordability(tresMesesConSueldo());
      expect(evaluacion.calibration.status).toBe('NOT_CALIBRATED_AGAINST_OBSERVED_ARREARS');
      expect(evaluacion.calibration.parametersCalibrated).toBe(0);
      expect(evaluacion.calibration.engineRole).toBe('MEASUREMENT_NOT_APPROVAL');
    });

    it('el salario mínimo verificado no es un piso de subsistencia', () => {
      expect(SUBSISTENCIA.salarioMinimo2026Bob).toBe(3300);
      expect(SUBSISTENCIA.salarioMinimoEsSubsistencia).toBe(false);
      // Y por eso el piso del motor NO se sustituye solo por el salario mínimo.
      expect(DEFAULT_AFFORDABILITY_POLICY.subsistenceFloor).toBe(2750);
    });
  });

  describe('ITF_HISTORY · un impuesto abrogado en una glosa no es fraude', () => {
    it('una fila con ITF después de la abrogación se investiga, no se rechaza', () => {
      expect(caso('ITF_HISTORY').esperado).toMatchObject({
        automatic_fraud: false,
        current_regular_tax_charge_applicable: false,
      });
      const lectura = readTaxGloss('IMPUESTO ITF');
      expect(lectura?.tax).toBe('ITF');
      expect(lectura?.automaticFraud).toBe(false);
      expect(lectura?.currentlyChargeable).toBe(false);
      expect(lectura?.status).toBe('ABROGATED');
    });

    it('el RC-IVA se reconoce sin afirmar alícuota ni base', () => {
      const lectura = readTaxGloss('RETENCION RCIVA');
      expect(lectura?.tax).toBe('RC_IVA');
      expect(lectura?.currentRate).toBe(null);
      expect(lectura?.currentlyChargeable).toBe(null);
    });

    it('el glosario oficial sigue trayendo ITF, y eso no lo hace vigente', () => {
      expect(GLOSARIO_OFICIAL.some((glosa) => glosa.categoria === 'TAX_ITF')).toBe(true);
    });
  });

  describe('CLASSIFIER_21 y FALSE_POSITIVES_299 · lo que una muestra permite afirmar', () => {
    it('17 de 21 es un intervalo, no un 81 %', () => {
      const esperado = caso('CLASSIFIER_21').esperado as {
        wilson_95: [number, number];
        population_accuracy_established: boolean;
      };
      const intervalo = wilson(17, 21, 0.95);
      expect(intervalo.lower).toBeCloseTo(esperado.wilson_95[0], 9);
      expect(intervalo.upper).toBeCloseTo(esperado.wilson_95[1], 9);
      expect(esperado.population_accuracy_established).toBe(false);
    });

    it('cero falsos positivos sobre 299 no demuestra que la tasa sea cero', () => {
      const esperado = caso('FALSE_POSITIVES_299').esperado as {
        one_sided_fpr_upper: number;
        fpr_proved_zero: boolean;
      };
      expect(zeroErrorUpperBound(299, 0.95)).toBeCloseTo(esperado.one_sided_fpr_upper, 15);
      expect(esperado.fpr_proved_zero).toBe(false);
    });
  });
});

/** Los identificadores que esta prueba ejecuta, para que ninguno se caiga. */
const EJECUTADOS: readonly string[] = [
  'GL_BCR_G007',
  'GL_BCR_G009',
  'GL_BCR_G134',
  'GL_BCR_G008',
  'GL_BCR_G059',
  'GL_BCR_G072',
  'GL_BCR_G034',
  'GL_BCR_G083',
  'ROUTE_IMAGE',
  'ROUTE_MIXED',
  'PARTIAL_MONTHS',
  'MISSING_DEBT',
  'BCP_QR',
  'TIGO_DISTINCTION',
  'HISTORICAL_RATIO',
  'ITF_HISTORY',
  'MEAN_NOT_MIN',
  'ZERO_VS_UNCOVERED',
  'SECURITY_AXIS',
  'CLASSIFIER_21',
  'FALSE_POSITIVES_299',
];

function dosMesesCompletos(): AffordabilityInput {
  return {
    transactions: [...mes('2026-02', 4000), ...mes('2026-03', 4000)],
    periodFrom: '2026-02-01',
    periodTo: '2026-03-31',
    currency: 'BOB',
    closingBalance: 4000,
  };
}

function tresMesesConSueldo(): AffordabilityInput {
  return {
    transactions: [...mes('2026-01', 5000), ...mes('2026-02', 5000), ...mes('2026-03', 5000)],
    periodFrom: '2026-01-01',
    periodTo: '2026-03-31',
    currency: 'BOB',
    closingBalance: 5000,
  };
}

/** El mismo extracto con FEBRERO en blanco: cubierto y sin un solo movimiento. */
function tresMesesConFebreroVacio(): AffordabilityInput {
  return {
    transactions: [...mes('2026-01', 5000), ...mes('2026-03', 5000)],
    periodFrom: '2026-01-01',
    periodTo: '2026-03-31',
    currency: 'BOB',
    closingBalance: 5000,
  };
}

/** Un mes con sueldo, luz y una cuota: lo mínimo para que la serie sea real. */
function mes(month: string, sueldo: number) {
  return [
    {
      date: `${month}-02`,
      description: 'PAGO DE HABERES',
      debit: null,
      credit: sueldo,
      balance: sueldo,
    },
    {
      date: `${month}-10`,
      description: 'PAGO DE SERVICIOS ELECTRICIDAD',
      debit: 300,
      credit: null,
      balance: sueldo - 300,
    },
    {
      date: `${month}-20`,
      description: 'PAGO CUOTA PRESTAMO 4412',
      debit: 700,
      credit: null,
      balance: sueldo - 1000,
    },
    {
      date: `${month}-28`,
      description: 'COMPRA SUPERMERCADO',
      debit: 500,
      credit: null,
      balance: sueldo - 1500,
    },
  ];
}
