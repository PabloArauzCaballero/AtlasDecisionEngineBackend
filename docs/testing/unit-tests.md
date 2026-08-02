# Pruebas unitarias

```bash
yarn test:unit    # excluye *.integration.spec.ts — sin base de datos
```

## Qué cubren

El núcleo determinista, que es donde un error se convierte en una decisión de crédito
incorrecta:

| Componente | Cobertura alcanzada |
| --- | --- |
| `expression-evaluator.ts` | 100 % sentencias y ramas |
| `money.ts` | 100 % |
| `execution-engine.service.ts` | 99 % sentencias, 90 % ramas |
| Validadores de grafo (estructura, expresiones, determinismo) | 97–99 % sentencias |
| `governance.service.ts` | 100 % sentencias, ~85 % ramas |
| `variable-resolution.service.ts` | 99 % sentencias |

## Convenciones

- Un fichero por unidad, `test/<tema>.spec.ts`.
- El nombre de la prueba describe **la invariante**, no el método: «rechaza que un nodo distinto del productor escriba», no «write() lanza».
- Los comentarios explican **por qué** la invariante importa, no qué hace el código.
- Sin mocks del sujeto bajo prueba. Un mock de lo que se está probando prueba el mock.

## Pruebas de propiedades

Con `fast-check`, donde el espacio de entradas es grande y los ejemplos elegidos a mano no
convencen:

```ts
it('un valor válido siempre satisface las restricciones declaradas', () => {
  fc.assert(fc.property(/* rangos generados */, (min, max, seed) => {
    const value = generateValidValue(definition, new SeededRandom(seed));
    return isValid(definition, value);
  }), { numRuns: 200 });
});
```

Invariantes cubiertas así: una intermedia nunca aparece en la salida pública; toda salida
obligatoria se produce; la misma entrada da siempre el mismo resultado; sesgar la distribución
del QA Lab no relaja el contrato.

## Cuidado con `ConfigService` en pruebas

Cualquier suite que arranca `AppModule` ejecuta `ConfigModule.forRoot()`, que carga `.env` en
`process.env` **para el resto del proceso de Jest**. Una suite posterior que construya
`new ConfigService({...})` hereda esos valores.

Consecuencia real: una suite que se declaraba «sin dependencias externas» abría un socket a
Redis. Fije explícitamente lo que no quiera heredar; la configuración interna gana sobre
`process.env`.

## Faker y fast-check

Son dependencias **de desarrollo**. Alimentan las pruebas del repositorio, nunca el generador
en línea: el algoritmo de Faker puede cambiar entre versiones menores y rompería la
reproducibilidad de una corrida archivada.
