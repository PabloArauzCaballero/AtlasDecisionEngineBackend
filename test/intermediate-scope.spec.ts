import { IntermediateScope } from '../src/modules/graph/intermediate-scope';
import type { IntermediateVariableSnapshot } from '../src/modules/graph/graph.types';

/**
 * Ciclo de vida de una variable intermedia (§2). Lo que se prueba aquí es que el
 * ámbito falle CERRADO: escritura no autorizada, lectura no autorizada, reescritura
 * indebida y tipo incompatible tienen que abortar la ejecución, no degradarse.
 */
function definition(
  overrides: Partial<IntermediateVariableSnapshot> = {},
): IntermediateVariableSnapshot {
  return {
    code: 'dti',
    name: 'Relación deuda/ingreso',
    description: 'Deuda mensual sobre ingreso mensual',
    dataType: 'DECIMAL',
    producerNodeKey: 'CALC_DTI',
    consumerNodeKeys: [],
    nullable: false,
    updatePolicy: 'SINGLE_WRITE',
    sensitivityClass: 'INTERNAL',
    tracePolicy: 'FULL',
    ...overrides,
  };
}

describe('IntermediateScope', () => {
  it('arranca NOT_AVAILABLE y no aparece en la vista legible', () => {
    const scope = new IntermediateScope([definition()]);
    expect(scope.readableView('CUALQUIERA')).toEqual({});
    expect(scope.snapshot()[0].state).toBe('NOT_AVAILABLE');
  });

  it('queda disponible desde el arranque si tiene valor inicial', () => {
    const scope = new IntermediateScope([definition({ initialValue: 0 })]);
    expect(scope.readableView('N1').dti).toBe(0);
    expect(scope.snapshot()[0].state).toBe('CONSUMED');
  });

  it('pasa a COMPUTED tras la escritura del productor', () => {
    const scope = new IntermediateScope([definition()]);
    scope.write('dti', 'CALC_DTI', 0.35);
    expect(scope.snapshot()[0].state).toBe('COMPUTED');
    expect(scope.readableView('N2').dti).toBe(0.35);
  });

  it('rechaza que un nodo distinto del productor escriba', () => {
    const scope = new IntermediateScope([definition()]);
    expect(() => scope.write('dti', 'OTRO_NODO', 0.1)).toThrow(
      /INTERMEDIATE_WRITE_UNAUTHORIZED|Solo/,
    );
  });

  it('rechaza escribir una intermedia no declarada', () => {
    const scope = new IntermediateScope([definition()]);
    expect(() => scope.write('inexistente', 'CALC_DTI', 1)).toThrow(/no está declarada/);
  });

  it('impide una segunda escritura cuando la política es SINGLE_WRITE', () => {
    const scope = new IntermediateScope([definition()]);
    scope.write('dti', 'CALC_DTI', 0.35);
    expect(() => scope.write('dti', 'CALC_DTI', 0.4)).toThrow(/escritura única/);
  });

  it('permite reescribir con OVERWRITE y registra el valor anterior', () => {
    const scope = new IntermediateScope([definition({ updatePolicy: 'OVERWRITE' })]);
    scope.write('dti', 'CALC_DTI', 0.3);
    scope.write('dti', 'CALC_DTI', 0.5);
    const [entry] = scope.snapshot();
    expect(entry.state).toBe('UPDATED');
    expect(entry.value).toBe(0.5);
    expect(entry.previousValue).toBe(0.3);
  });

  it('suma con ACCUMULATE en vez de reemplazar', () => {
    const scope = new IntermediateScope([
      definition({ code: 'puntos', dataType: 'INTEGER', updatePolicy: 'ACCUMULATE' }),
    ]);
    scope.write('puntos', 'CALC_DTI', 10);
    scope.write('puntos', 'CALC_DTI', 5);
    expect(scope.snapshot()[0].value).toBe(15);
  });

  it('valida el valor contra el tipo y las restricciones declaradas', () => {
    const scope = new IntermediateScope([definition({ constraints: { max: 1 } })]);
    expect(() => scope.write('dti', 'CALC_DTI', 2)).toThrow(/is above maximum/);
    expect(() => scope.write('dti', 'CALC_DTI', 'texto')).toThrow(/must be of type/);
  });

  it('rechaza null cuando la variable no es nullable', () => {
    const scope = new IntermediateScope([definition()]);
    expect(() => scope.write('dti', 'CALC_DTI', null)).toThrow(/no admite valores nulos/);
  });

  it('oculta la variable a los nodos no autorizados', () => {
    const scope = new IntermediateScope([definition({ consumerNodeKeys: ['DECIDE'] })]);
    scope.write('dti', 'CALC_DTI', 0.35);
    expect(scope.readableView('DECIDE').dti).toBe(0.35);
    expect(scope.readableView('AJENO')).toEqual({});
  });

  it('registra como consumidor solo al nodo que realmente lee el valor', () => {
    const scope = new IntermediateScope([definition()]);
    scope.write('dti', 'CALC_DTI', 0.35);
    // Construir la vista no basta: hasta que no se accede al getter no hay consumo.
    const view = scope.readableView('MIRON');
    expect(scope.snapshot()[0].consumedByNodeKeys).toEqual([]);
    void view.dti;
    expect(scope.snapshot()[0].consumedByNodeKeys).toEqual(['MIRON']);
  });

  it('enmascara y redacta según la política de traza', () => {
    const masked = new IntermediateScope([
      definition({ code: 'doc', dataType: 'STRING', tracePolicy: 'MASKED' }),
    ]);
    masked.write('doc', 'CALC_DTI', '1234567');
    expect(masked.snapshot()[0].value).toBe('*****67');

    const redacted = new IntermediateScope([definition({ tracePolicy: 'REDACTED' })]);
    redacted.write('dti', 'CALC_DTI', 0.35);
    expect(redacted.snapshot()[0].value).toBeNull();
    expect(redacted.snapshot()[0].state).toBe('REDACTED');
  });

  it('fecha la creación en el paso que le dio valor por primera vez (§3.1)', () => {
    const scope = new IntermediateScope([definition({ updatePolicy: 'OVERWRITE' })]);
    scope.enterStep(0);
    scope.enterStep(1);
    scope.enterStep(2);
    scope.write('dti', 'CALC_DTI', 0.3);
    scope.enterStep(5);
    scope.write('dti', 'CALC_DTI', 0.5);
    // La reescritura del paso 5 actualiza el valor pero NO mueve el momento de creación:
    // el paso 2 es donde el valor apareció y es lo que reconstruye el razonamiento.
    const [entry] = scope.snapshot();
    expect(entry.createdAtStepIndex).toBe(2);
    expect(entry.state).toBe('UPDATED');
  });

  it('no fecha la creación de una intermedia que nació con valor inicial', () => {
    const scope = new IntermediateScope([definition({ initialValue: 0 })]);
    scope.enterStep(0);
    // Existía antes de ejecutarse ningún nodo, así que no hay paso que la creara. Es
    // distinto de "creada en el paso 0" y por eso no se colapsan en el mismo valor.
    expect(scope.snapshot()[0].createdAtStepIndex).toBeUndefined();
  });

  it('deja sin fechar a la intermedia que ningún nodo llegó a escribir', () => {
    const scope = new IntermediateScope([definition()]);
    scope.enterStep(3);
    expect(scope.snapshot()[0].createdAtStepIndex).toBeUndefined();
  });

  it('cada ejecución parte de un ámbito nuevo: nada sobrevive entre instancias', () => {
    const first = new IntermediateScope([definition()]);
    first.write('dti', 'CALC_DTI', 0.35);
    const second = new IntermediateScope([definition()]);
    expect(second.peek('dti')).toEqual({ available: false, value: undefined });
  });
});
