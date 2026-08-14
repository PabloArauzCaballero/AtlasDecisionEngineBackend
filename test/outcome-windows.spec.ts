/**
 * Las ventanas de observación son el DENOMINADOR de la cobertura.
 *
 * Sin ellas existía el numerador —las observaciones cargadas— y nada contra qué dividirlo, así
 * que «este mes no falló ningún crédito» y «este mes nadie cargó los desenlaces» se leían igual.
 * Estas pruebas fijan las dos decisiones que hacen que la cola sea utilizable: sólo se programan
 * donde hay crédito, y una configuración rota no deja al sistema sin ventanas.
 */
import {
  DEFAULT_OUTCOME_WINDOWS,
  ORIGINATION_RISK_DOMAIN,
  outcomeWindowsFor,
  parseWindowDays,
  windowDueAt,
} from '../src/modules/runtime/outcome-windows';

describe('outcomeWindowsFor', () => {
  it('programa ventanas para una decisión que origina crédito', () => {
    expect(outcomeWindowsFor(ORIGINATION_RISK_DOMAIN, null)).toEqual([...DEFAULT_OUTCOME_WINDOWS]);
  });

  it('no programa nada para cobranza ni para enrutado', () => {
    // Una ventana sobre una decisión que no genera crédito quedaría vencida para siempre, y una
    // cola llena de trabajo imposible se acaba ignorando entera, con los créditos de verdad
    // dentro.
    expect(outcomeWindowsFor('COLLECTIONS', null)).toEqual([]);
    expect(outcomeWindowsFor('INTERNAL_ROUTING', '30,90')).toEqual([]);
  });
});

describe('parseWindowDays', () => {
  it('respeta la configuración, ordenada y sin repetidos', () => {
    expect(parseWindowDays('90, 30,30 , 180')).toEqual([30, 90, 180]);
  });

  it('descarta lo inutilizable y conserva lo válido', () => {
    expect(parseWindowDays('30, cero, -5, 0, 99999, 90')).toEqual([30, 90]);
  });

  it('vuelve a las de serie cuando no queda nada válido', () => {
    // Fallar al arrancar convertiría una errata de configuración en una caída del camino de
    // decisión, que es un precio desproporcionado para un dato con valor por omisión razonable.
    expect(parseWindowDays('nada, -1')).toEqual([...DEFAULT_OUTCOME_WINDOWS]);
    expect(parseWindowDays('   ')).toEqual([...DEFAULT_OUTCOME_WINDOWS]);
  });
});

describe('windowDueAt', () => {
  it('cuenta desde la decisión, no desde hoy', () => {
    const decided = new Date('2026-01-01T00:00:00.000Z');
    expect(windowDueAt(decided, 90).toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });
});
