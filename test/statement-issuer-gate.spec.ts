import type { ExtractedPdf } from '../src/modules/workers/bank-statement/core/domain/models';
import { DocumentClassifier } from '../src/modules/workers/bank-statement/core/engine/document-classifier';
import { InstitutionDetector } from '../src/modules/workers/bank-statement/core/engine/institution-detector';
import { assessIssuer } from '../src/modules/workers/bank-statement/core/engine/issuer-gate';
import { BOLIVIA_INSTITUTIONS } from '../src/modules/workers/bank-statement/core/institutions/bolivia-institutions';
import {
  ASFI_SEED_REGISTRY,
  fixedRegistry,
  resolvedRegistry,
} from '../src/modules/workers/bank-statement/core/institutions/institution-registry';

/**
 * La compuerta que pregunta QUIÉN emitió el documento.
 *
 * Se prueba aparte del clasificador porque las dos responden preguntas
 * distintas y el agujero estaba justo entre ellas: un documento puede ser un
 * estado de cuenta perfecto —y sumar 1.00 en el clasificador— sin ser el
 * estado de cuenta de un banco.
 */

function pdfDe(lineas: readonly string[]): ExtractedPdf {
  return {
    text: lineas.join('\n'),
    lines: lineas.map((text, index) => ({ text, page: 1, y: 800 - index * 12 })),
    pageCount: 1,
  } as unknown as ExtractedPdf;
}

const detector = new InstitutionDetector();

describe('padrón de entidades de ASFI', () => {
  it('trae la nómina completa con siglas únicas', () => {
    const codes = BOLIVIA_INSTITUTIONS.map((institution) => institution.code);
    expect(new Set(codes).size).toBe(codes.length);
    // Los 11 bancos múltiples, los 2 PYME y las 2 del Estado de la nómina al
    // 30-abr-2026. Si ASFI publica una entidad nueva, esta cuenta es lo primero
    // que hay que mover, y verlo roja es preferible a que un extracto legítimo
    // empiece a rechazarse sin que nadie relacione las dos cosas.
    const porTipo = (kind: string) =>
      BOLIVIA_INSTITUTIONS.filter((institution) => institution.kind === kind).length;
    expect(porTipo('MULTIPLE_BANK')).toBe(12); // 11 vigentes + Fassil, revocado
    expect(porTipo('PYME_BANK')).toBe(2);
    expect(porTipo('HOUSING_ENTITY')).toBe(3);
    expect(porTipo('COOPERATIVE')).toBe(41);
    expect(porTipo('DEVELOPMENT_IFD')).toBe(8);
  });

  it('ninguna entidad se queda sin marcadores', () => {
    for (const institution of BOLIVIA_INSTITUTIONS) {
      expect(institution.markers.length).toBeGreaterThan(0);
    }
  });

  it('una entidad sin licencia declara por qué', () => {
    for (const institution of BOLIVIA_INSTITUTIONS) {
      if (institution.licenseStatus === 'LICENSED') continue;
      expect(institution.note).toBeTruthy();
    }
  });
});

describe('atribución de la entidad emisora', () => {
  it('reconoce a una cooperativa del padrón que antes caía en «desconocida»', () => {
    const deteccion = detector.detect(
      pdfDe([
        'COOPERATIVA DE AHORRO Y CREDITO ABIERTA "SAN MARTIN DE PORRES" R.L.',
        'Supervisada por ASFI',
        'EXTRACTO DE CUENTA',
      ]),
    );
    expect(deteccion.detected).toBe(true);
    expect(deteccion.code).toBe('CSM');
  });

  /*
   * El falso positivo del grupo financiero, que es el que motivó las
   * exclusiones: la póliza de la aseguradora hermana lleva la marca del banco en
   * la carátula y se atribuía a él, de modo que una póliza entraba en el motor
   * como si fuera un extracto bancario.
   */
  it('no atribuye al banco la póliza de su aseguradora hermana', () => {
    const deteccion = detector.detect(
      pdfDe(['BISA SEGUROS Y REASEGUROS S.A.', 'POLIZA DE SEGURO N° 4417']),
    );
    expect(deteccion.detected).toBe(false);
    expect(deteccion.nonBankingIssuer?.kind).toBe('INSURANCE');
  });

  it('no confunde al BCP del Perú con el Banco de Crédito de Bolivia', () => {
    const deteccion = detector.detect(
      pdfDe(['Banco de Crédito del Perú', 'Estado de Cuenta', 'viabcp.com']),
    );
    expect(deteccion.detected).toBe(false);
    expect(deteccion.nonBankingIssuer?.code).toBe('BCP_PE');
  });

  it('la cooperativa de servicios no se cuela como cooperativa financiera', () => {
    const deteccion = detector.detect(
      pdfDe(['COOPERATIVA RURAL DE ELECTRIFICACION R.L.', 'ESTADO DE CUENTA']),
    );
    expect(deteccion.detected).toBe(false);
    expect(deteccion.nonBankingIssuer?.kind).toBe('UTILITY');
  });
});

describe('compuerta de emisor', () => {
  const gate = (lineas: readonly string[]) => assessIssuer(detector.detect(pdfDe(lineas)));

  it('acepta a una entidad con licencia vigente', () => {
    const resultado = gate(['BANCO NACIONAL DE BOLIVIA S.A.', 'EXTRACTO DE CUENTA']);
    expect(resultado.verdict).toBe('LICENSED');
    expect(resultado.disposition).toBe('ACCEPT');
  });

  /*
   * La entidad intervenida va a una persona y NO al rechazo. El documento es
   * auténtico y su historial es cierto; lo que hace falta es que alguien sepa
   * que la entidad ya no opera antes de decidir sobre él.
   */
  it('manda a revisión el extracto de una entidad intervenida', () => {
    const resultado = gate(['BANCO FASSIL S.A.', 'EXTRACTO DE CUENTA', 'Supervisado por ASFI']);
    expect(resultado.verdict).toBe('UNLICENSED');
    expect(resultado.disposition).toBe('REVIEW');
  });

  it('rechaza en el momento al emisor que no es financiero', () => {
    const resultado = gate(['ENTEL S.A.', 'ESTADO DE CUENTA', 'CUENTA: 70011223']);
    expect(resultado.verdict).toBe('NON_BANKING');
    expect(resultado.disposition).toBe('REJECT');
  });

  /*
   * Las dos mitades de lo no atribuido, que es donde estaba la confusión: con
   * alguna señal financiera queda algo que una persona puede resolver; sin
   * ninguna, no.
   */
  it('deriva a revisión lo no atribuido que aún se ve financiero', () => {
    const resultado = gate([
      'ENTIDAD FINANCIERA COMUNAL LTDA.',
      'Supervisada por ASFI',
      'EXTRACTO DE CUENTA',
    ]);
    expect(resultado.verdict).toBe('UNATTRIBUTED');
    expect(resultado.disposition).toBe('REVIEW');
  });

  it('rechaza lo no atribuido que no tiene ninguna señal financiera', () => {
    const resultado = gate(['ESTADO DE CUENTA', 'Periodo marzo 2026']);
    expect(resultado.verdict).toBe('UNATTRIBUTED');
    expect(resultado.disposition).toBe('REJECT');
  });

  /*
   * El modo de medición conserva el veredicto real y sólo relaja el desenlace:
   * es lo que permite responder «¿cuántos documentos rechazaríamos?» sin haber
   * rechazado ninguno todavía.
   */
  it('en modo de medición deja pasar sin perder el veredicto', () => {
    const deteccion = detector.detect(pdfDe(['ENTEL S.A.', 'ESTADO DE CUENTA']));
    const resultado = assessIssuer(deteccion, { requireLicensedIssuer: false });
    expect(resultado.verdict).toBe('NON_BANKING');
    expect(resultado.disposition).toBe('ACCEPT');
    expect(resultado.reasons).toContain('compuerta-en-medicion');
  });
});

/**
 * El agujero, medido sobre el clasificador aislado.
 *
 * El extremo a extremo —que el motor rechace de verdad ese documento— vive en
 * `bank-statement-fixtures.spec.ts` y NO aquí, por una restricción del entorno
 * de pruebas y no por gusto: `pdfjs-dist` se carga como ESM desde código
 * compilado a CommonJS, y su instancia queda ligada a la máquina virtual de la
 * suite que la cargó primero. Dos suites leyendo PDF reales en la misma corrida
 * hacen fallar a la segunda con `PDF_EXTRACTION_FAILED`, que además señala al
 * documento y no al entorno. Una sola suite lee PDF; las demás miden sobre
 * texto ya extraído.
 */
describe('el agujero que la compuerta cierra', () => {
  it('el clasificador, solo, acepta el estado de cuenta de una telefónica', () => {
    const clasificacion = new DocumentClassifier().classify(
      pdfDe([
        'ENTEL S.A.',
        'ESTADO DE CUENTA',
        'CUENTA: 70011223',
        'PERIODO: 01/03/2026 AL 31/03/2026',
        'SALDO ANTERIOR: 120,00',
        'FECHA DESCRIPCION DEBITO CREDITO SALDO',
        '05/03/2026 CONSUMO PLAN POSPAGO 150,00 270,00',
        '20/03/2026 PAGO RECIBIDO 120,00 150,00',
      ]),
    );
    // Suma el máximo y ninguna de sus señales es falsa: de verdad es el estado
    // de una cuenta. Lo único que lo delata es QUIÉN lo emite.
    expect(clasificacion.isFinancialStatement).toBe(true);
    expect(clasificacion.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

/**
 * El padrón degradado no puede firmar una licencia vigente.
 *
 * Hallazgo `fail-open-state-drift` de la revisión de seguridad del 20-ago-2026.
 * `resolvedRegistry` cae a la semilla compilada cuando la carga falla —bien
 * pensado: un fallo de base no puede convertir todos los extractos del país en
 * documentos de entidad desconocida—, pero lo hacía en SILENCIO. La semilla dice
 * `LICENSED` de entidades cuya licencia pudo revocarse después, porque una
 * revocación de ASFI se administra en la base y no se despliega. Resultado: un
 * documento que debía ir a revisión salía ACEPTADO, y justo cuando la capa de
 * datos estaba caída.
 */
describe('Padrón degradado', () => {
  it('marca la semilla de respaldo como NO vigente y el padrón cargado como vigente', () => {
    const cargado = resolvedRegistry(() => BOLIVIA_INSTITUTIONS.slice(0, 2));
    const caido = resolvedRegistry(() => undefined);
    const vacio = resolvedRegistry(() => []);

    expect(cargado.isAuthoritative()).toBe(true);
    expect(caido.isAuthoritative()).toBe(false);
    // Un padrón vacío nunca es una afirmación sobre el sistema financiero
    // boliviano: siempre es un fallo de carga.
    expect(vacio.isAuthoritative()).toBe(false);
    // Y en los tres casos sigue habiendo entidades con las que trabajar.
    expect(caido.list().length).toBeGreaterThan(0);
  });

  it('la semilla elegida a propósito SÍ es vigente: no está degradada, sólo no tiene otra fuente', () => {
    expect(ASFI_SEED_REGISTRY.isAuthoritative()).toBe(true);
    expect(fixedRegistry(BOLIVIA_INSTITUTIONS).isAuthoritative()).toBe(true);
  });

  it('con el padrón degradado, una entidad con licencia va a REVISIÓN y no a aceptación', () => {
    const vigente = assessIssuer(deteccionLicenciada(true));
    const degradado = assessIssuer(deteccionLicenciada(false));

    expect(vigente.disposition).toBe('ACCEPT');
    expect(degradado.disposition).toBe('REVIEW');
    // El motivo distingue este caso de una licencia realmente revocada, que es
    // lo que necesita quien atiende la cola.
    expect(degradado.reasons).toContain('padron-no-vigente');
    expect(degradado.verdict).toBe('LICENSED');
  });
});

function deteccionLicenciada(registryAuthoritative: boolean) {
  return {
    code: 'BNB',
    name: 'Banco Nacional de Bolivia',
    detected: true as const,
    confidence: 0.9,
    signals: ['marcadores-de-entidad:2'],
    licenseStatus: 'LICENSED' as const,
    retailDeposits: true,
    registryAuthoritative,
  };
}
