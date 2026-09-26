import {
  intermediateAssignmentsOf,
  referencedIntermediates,
} from '../src/modules/graph/validators/graph-intermediate.validator';
import { calculatedFieldTargets } from '../src/modules/graph/validators/graph-calculated-field.validator';
import type { GraphNodeSnapshot } from '../src/modules/graph/graph.types';

/**
 * Qué variables intermedias LEE un valor, que es la mitad de una garantía del motor.
 *
 * `referencedIntermediates` es lo que responde «¿este nodo usa una variable que en este punto del
 * grafo todavía no existe?». Si se le escapa una referencia, el validador aprueba un artefacto que
 * en producción ejecuta con una entrada vacía, y eso no se ve al compilar: se ve como una decisión
 * tomada con un dato que nadie escribió.
 *
 * Las reglas que se fijan aquí son las que un cambio de recorrido rompe sin ruido: que el código se
 * corta en el primer punto (`intermediate.dti.valor` es `dti`), que se baja por arrays y objetos
 * anidados, que la clave `intermediateAssignments` se salta —ahí el código es una ESCRITURA, no una
 * lectura— y que lo que no es cadena no inventa referencias.
 */
describe('lecturas de variables intermedias', () => {
  it('reconoce la referencia y corta el código en el primer punto', () => {
    expect(referencedIntermediates('intermediate.dti')).toEqual(['dti']);
    expect(referencedIntermediates('intermediate.dti.valor')).toEqual(['dti']);
  });

  it('baja por objetos y arrays anidados, y no repite', () => {
    const leidas = referencedIntermediates({
      condicion: { izquierda: 'intermediate.ingreso', derecha: ['intermediate.deuda', 42] },
      otra: [{ profundo: { mas: 'intermediate.ingreso' } }],
    });
    expect(leidas.sort()).toEqual(['deuda', 'ingreso']);
  });

  it('lo que no es una referencia no inventa ninguna', () => {
    expect(referencedIntermediates('intermediario.dti')).toEqual([]);
    expect(referencedIntermediates({ n: 7, b: true, nulo: null })).toEqual([]);
    expect(referencedIntermediates(undefined)).toEqual([]);
  });

  /*
   * `intermediateAssignments` es donde un nodo ESCRIBE. Contarlo como lectura haría que una
   * variable pareciera necesaria antes de existir, y el validador rechazaría artefactos correctos
   * —el fallo simétrico del que esta función existe para evitar—.
   */
  it('no confunde la escritura con una lectura', () => {
    expect(referencedIntermediates({ intermediateAssignments: [{ code: 'dti' }] })).toEqual([]);
  });

  it('una asignación mal formada no revienta: se lee como que no hay ninguna', () => {
    const conArray = { config: { intermediateAssignments: [{ code: 'dti' }] } };
    expect(intermediateAssignmentsOf(conArray as unknown as GraphNodeSnapshot)).toHaveLength(1);

    for (const roto of [
      { intermediateAssignments: 'dti' },
      { intermediateAssignments: null },
      {},
    ]) {
      expect(intermediateAssignmentsOf({ config: roto } as unknown as GraphNodeSnapshot)).toEqual(
        [],
      );
    }
  });
});

/**
 * Y la otra mitad: qué variables ESCRIBE un campo calculado en este nodo.
 *
 * `calculatedFieldTargets` es la contraparte de las lecturas. Si se le escapa un destino, el
 * validador cree que una variable no la escribe nadie y rechaza un artefacto correcto; si devuelve
 * uno de más, cree que ya existe y aprueba un nodo que la lee antes de tiempo. Los dos errores son
 * silenciosos al compilar.
 *
 * La distinción que se fija aquí es la que importa: sólo los destinos `INTERMEDIATE` cuentan. Un
 * `OUTPUT` va al contrato de salida, no al ámbito de intermedias, y confundirlos haría aparecer una
 * variable que no existe para el resto del grafo.
 */
describe('escrituras de un campo calculado', () => {
  const llamada = (kind: 'INTERMEDIATE' | 'OUTPUT', code: string) =>
    ({
      callKey: `c-${code}`,
      fieldCode: 'campo',
      calculatedFieldVersionId: 'v1',
      versionNumber: 1,
      inputMapping: {},
      target: { kind, code },
      definition: { implementationKind: 'OPERATION', contract: {}, libraryPackages: [] },
    }) as never;

  it('devuelve sólo los destinos intermedios, en orden', () => {
    const node = {
      calculatedFieldCalls: [
        llamada('INTERMEDIATE', 'dti'),
        llamada('OUTPUT', 'decision'),
        llamada('INTERMEDIATE', 'capacidad'),
      ],
    };
    expect(calculatedFieldTargets(node as never)).toEqual(['dti', 'capacidad']);
  });

  it('un nodo sin llamadas no escribe nada, y no revienta', () => {
    expect(calculatedFieldTargets({} as never)).toEqual([]);
    expect(calculatedFieldTargets({ calculatedFieldCalls: [] } as never)).toEqual([]);
  });

  it('un destino de SALIDA no crea una variable intermedia', () => {
    const node = { calculatedFieldCalls: [llamada('OUTPUT', 'decision')] };
    expect(calculatedFieldTargets(node as never)).toEqual([]);
  });
});
