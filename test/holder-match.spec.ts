import { assessHolder } from '../src/modules/workers/bank-statement/core/engine/holder/holder-match';

/**
 * La regla «nombre y apellido del cliente en algún titular», con carátulas como las imprimen los bancos
 * bolivianos (Pablo, 2026-10-16).
 */
const juan = {
  fullName: 'Juan Carlos Pérez Gómez',
  givenNames: 'Juan Carlos',
  surnames: 'Pérez Gómez',
};

describe('assessHolder · el titular del extracto es el cliente', () => {
  it.each([
    ['apellidos primero, en mayúsculas y sin tildes', 'PEREZ GOMEZ JUAN CARLOS'],
    ['sólo un nombre y un apellido', 'JUAN PEREZ'],
    ['con tildes y minúsculas', 'Juan Pérez Gómez'],
    ['nombre de pila en inicial', 'J. PEREZ GOMEZ'],
    ['segundo nombre y segundo apellido', 'CARLOS GOMEZ'],
    ['con partículas', 'PEREZ DE LA GOMEZ JUAN'],
    ['un error de lectura en un apellido largo', 'JUAN GOMES PEREZ'],
    ['cotitular (Y)', 'MARIA LOPEZ ROJAS Y JUAN CARLOS PEREZ GOMEZ'],
    ['cotitulares con barra', 'MARIA LOPEZ / PEREZ GOMEZ JUAN'],
    ['tratamiento delante', 'SR. JUAN CARLOS PEREZ GOMEZ'],
  ])('coincide: %s', (_caso, leido) => {
    expect(assessHolder(leido, juan).verdict).toBe('MATCH');
  });

  it.each([
    ['otra persona', 'MARIA LOPEZ ROJAS'],
    ['mismo apellido, otro nombre (un familiar)', 'ROBERTO PEREZ GOMEZ'],
    ['mismo nombre, otro apellido', 'JUAN CARLOS MAMANI QUISPE'],
  ])('no coincide: %s', (_caso, leido) => {
    expect(assessHolder(leido, juan).verdict).toBe('MISMATCH');
  });

  it.each([
    ['sin titular en la carátula', ''],
    ['un rótulo del banco leído como titular', 'BANCO UNION S.A.'],
    ['un dato de la cuenta', 'CAJA DE AHORRO BOLIVIANOS'],
    ['una sola palabra', 'PEREZ'],
    ['apellidos sólo en iniciales: no se puede afirmar que sea otra persona', 'JUAN P. G.'],
  ])('ilegible, a una persona: %s', (_caso, leido) => {
    expect(assessHolder(leido, juan).verdict).toBe('UNREADABLE');
  });

  it('sin titular exigido, sólo informa lo leído', () => {
    const r = assessHolder('PEREZ GOMEZ JUAN CARLOS', null);
    expect(r.verdict).toBe('NOT_REQUIRED');
    expect(r.holdersRead).toEqual(['PEREZ GOMEZ JUAN CARLOS']);
  });

  it('con el nombre sin separar, bastan dos palabras', () => {
    expect(assessHolder('PEREZ GOMEZ JUAN CARLOS', { fullName: 'Juan Pérez' }).verdict).toBe(
      'MATCH',
    );
    expect(assessHolder('PEREZ ROJAS MARIA', { fullName: 'Juan Pérez' }).verdict).toBe('MISMATCH');
  });

  it('separa los cotitulares en lo leído', () => {
    expect(assessHolder('MARIA LOPEZ Y JUAN PEREZ', juan).holdersRead).toEqual([
      'MARIA LOPEZ',
      'JUAN PEREZ',
    ]);
  });
});
