# Los dos corpus de referencia

Aquí viven, **sin editar**, los dos paquetes de conocimiento contra los que están
calibrados los dos workers que miran documentos de una persona:

| archivo                    | qué contiene                                                                                      | worker                  |
| -------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------- |
| `corpus-extractos-bo.json` | padrón ASFI, 147 glosas oficiales del BCP, fichas por emisor, capacidad de pago, fraude defensivo | `bank-statement`        |
| `corpus-identidad-bo.json` | especificación del carnet boliviano, MRZ TD1, PAD, cotejo facial y política de producción         | `identity-verification` |

## Por qué están DENTRO del repositorio

Porque son la procedencia de decisiones que el código toma sobre personas, y una
procedencia que vive en la carpeta de descargas de alguien no es una procedencia:
es un recuerdo. Con el corpus versionado aquí, cualquiera puede preguntar de
dónde sale un umbral, una categoría o un rótulo, y `scripts/corpus/generar-catalogos.ts`
puede volver a derivar los catálogos y demostrar que nadie los tocó a mano.

## Qué NO son

Ninguno de los dos es una calibración de producción, y los dos lo dicen de sí
mismos en su manifiesto:

- `corpus-extractos-bo.json` → `status: PARTIAL_PUBLIC_EVIDENCE_WITH_EXPLICIT_GAPS`,
  `contains_calibrated_credit_policy: false`, 23 huecos y 10 contradicciones
  declaradas. Sus `prohibited_claims` prohíben expresamente afirmar «ratio ASFI
  vigente certificado», «pesos de fraude calibrados» o «umbral de capacidad
  validado con mora».
- `corpus-identidad-bo.json` → `not_a_production_calibration: true`,
  `real_images_in_package: 0`, `local_records` deliberadamente vacío. Su
  `production_policy` fija `mode: SHADOW_REVIEW` con `auto_accept_enabled: false`
  y `auto_reject_fraud_enabled: false`.

Los catálogos generados a partir de ellos **conservan esa procedencia campo a
campo**: un valor sin calibrar llega al código sabiendo que no está calibrado, y
por eso el código puede negarse a usarlo como umbral de rechazo.

`null` nunca significa cero, falso ni ausencia. Significa NO VERIFICADO, y los
dos manifiestos lo declaran así.

## Cómo se usan

No se leen en tiempo de ejecución. Un script los convierte en TypeScript tipado:

```bash
yarn corpus:generar          # reescribe los catálogos derivados
yarn corpus:check            # falla si lo generado no coincide con el corpus
```

Los catálogos derivados viven en:

- `src/modules/workers/bank-statement/core/corpus/corpus-extractos.generated.ts`
- `src/modules/workers/identity-verification/core/corpus/corpus-identidad.generated.ts`

**No se editan a mano.** Llevan el SHA-256 del corpus del que salieron, y la
prueba `test/corpus-catalogos-derivados.spec.ts` comprueba que ese hash sigue
siendo el del archivo de esta carpeta: si alguien cambia el corpus y no regenera,
la suite lo dice.

## Derechos

El contenido de terceros (transcripciones de ASFI, glosario del BCP, normas,
artículos) es de sus titulares; la atribución de cada dato viaja en su campo
`sources` dentro del propio corpus. La licencia MIT del repositorio cubre el
código que los carga, no los datos.
