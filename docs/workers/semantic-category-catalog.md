# Catálogo de categorías del worker semántico

El worker de análisis semántico no interpreta: **mide parecido contra un catálogo cerrado**.
Todo lo que ese catálogo no nombra sale `UNKNOWN` o cae en el cajón, así que su cobertura es,
literalmente, el techo de lo que el motor puede clasificar.

Esta página explica de qué está hecho, qué regla decide si un rubro merece una hoja propia y
qué hay que volver a medir después de tocarlo.

## De un vistazo

| Magnitud | Valor |
| --- | --- |
| Categorías sembradas | 164 |
| Ramas (agrupan, no clasifican) | 16 |
| Hojas (el conjunto sobre el que se decide) | 148 |
| Glosas de ejemplo | 2.256 |
| Contraejemplos | 397 |
| Sondas totales en `DEEP` | ~2.820 |

Reparto de hojas por familia:

| Familia | Hojas | Familia | Hojas |
| --- | --- | --- | --- |
| `INGRESOS` | 35 | `GASTOS.OCIO` | 7 |
| `GASTOS` (directas) | 15 | `GASTOS.SALUD` | 7 |
| `GASTOS.EMPRESARIALES` | 15 | `GASTOS.TRANSPORTE` | 7 |
| `GASTOS.FINANCIEROS` | 12 | `GASTOS.AGRO` | 6 |
| `GASTOS.COMPRAS` | 11 | `GASTOS.PERSONAL` | 6 |
| `GASTOS.VIVIENDA` | 10 | `GASTOS.ALIMENTACION` | 4 |
| `GASTOS.CONSTRUCCION` | 4 | `GASTOS.LABORALES` | 4 |
| `GASTOS.COMEX` | 3 | `GASTOS.MINERIA` | 2 |

## Cinco archivos, una responsabilidad cada uno

El árbol se ensambla en
[`expense-category-tree.data.ts`](../../src/modules/seeding/data/expense-category-tree.data.ts),
que además es el único sitio donde se comprueba que el resultado se sostiene.

| Archivo | Qué aporta |
| --- | --- |
| `expense-category-tree.data.ts` | El árbol curado del gasto e ingreso de una **persona**, y el ensamblado de todo lo demás |
| `statement-vocabulary.data.ts` | Lo que mueve un extracto de **empresa**: adquirencia, nómina pagada, inventario, custodia |
| `household-categories.data.ts` | Rubros del **hogar y la persona** que ninguna hoja nombraba: anticrético, taller, óptica, funeraria, membresías |
| `business-categories.data.ts` | La **operación de un negocio**: local, publicidad, aduana, aportes laborales, obra, campo, minería |
| `financial-categories.data.ts` | Lo **financiero que no es una cuota** —ITF, garantías, leasing, embargo— y el ingreso que espeja cada hecho |

Y tres diccionarios de vocabulario, que **no crean categorías**: sólo añaden glosas a las que ya
existen.

| Diccionario | Qué describe |
| --- | --- |
| `bank-dialect.data.ts` | Cómo **rotula cada banco**: `DEBITO TRANSFERENCIA ACH`, `TRASPASO CA/CC CON QR (MOVIL)` |
| `bolivian-merchants.data.ts` | **A quién se pagó**: `HIPERMAXI`, `FARMACORP`, `YPFB`, y la forma «cabecera + nombre» |
| `glosa-vocabulary.data.ts` | La **anchura** dentro de cada rubro: las otras veinte maneras de escribir lo mismo |

## La regla que decide si un rubro merece hoja propia

> **Se separa cuando la GLOSA se separa, no cuando el concepto se separa.**

Añadir una hoja y añadir un ejemplo no son la misma jugada:

- **Un ejemplo nunca quita.** Acerca la hoja a una forma que antes no reconocía y no acerca a
  ninguna otra.
- **Una hoja puede quitar.** Si el banco escribe las dos cosas igual, las dos hojas casan igual
  de bien, el reparto de confianza las deja a las dos por debajo de su umbral y un movimiento
  perfectamente identificable sale SIN DETERMINAR.

Está medido en este mismo árbol: `PAGO SERVICIOS CONTABLES` en Servicios profesionales sacaba
0,9167 contra esa hoja y 0,9140 contra Servicios básicos —tres milésimas— y el movimiento se
perdía. Por eso el catálogo **no** tiene hoja de «comida rápida» (el banco la imprime igual que
un restaurante), ni de «electrodomésticos» (vive en Compras hogar con su mismo vocabulario), ni
de «capacitación» (Educación ya la recoge). Sí tiene hoja de «anticrético», porque ninguna otra
línea del extracto dice esa palabra.

Por la misma razón, tres rubros que estaban **mezclados** en una hoja que hablaba de otra cosa se
movieron a hojas propias, y la hoja de origen los recibió como contraejemplo:

| Se movió | De | A |
| --- | --- | --- |
| Taller, aceite, lavado | `GASTOS.TRANSPORTE.COMBUSTIBLE` | `GASTOS.TRANSPORTE.TALLER` |
| SOAT e inspección técnica | `GASTOS.TRANSPORTE.COMBUSTIBLE` | `…SEGURO` y `…TRAMITES` |
| Prima de salud | `GASTOS.SALUD.ATENCION` | `GASTOS.SALUD.SEGURO` |
| Alquiler del local | `GASTOS.EMPRESARIALES.EQUIPO` | `GASTOS.EMPRESARIALES.LOCAL` |

## Lo que el ensamblado se niega a dejar pasar

Al construir `expenseCategoryTree` se rompe el arranque —no se avisa, se rompe— ante:

- **Un código declarado dos veces.** La siembra es idempotente por `(tenant, code)`, así que la
  segunda entrada pisaría a la primera en silencio y el catálogo perdería una categoría entera.
- **Un diccionario que menciona una categoría inexistente.** Los ejemplos no llegarían a ninguna
  hoja y la categoría clasificaría peor sin que nadie supiera por qué.
- **Un ciclo o un padre ausente**, al ordenar por profundidad para sembrar.

Además, los ejemplos se **deduplican** al unir los diccionarios: en `DEEP` cada ejemplo es una
sonda que se embebe y se compara, y una copia cuesta lo mismo que el original sin aportar nada.

[`test/semantic-category-tree.spec.ts`](../../test/semantic-category-tree.spec.ts) sostiene el
resto de las invariantes: que ninguna glosa se reparta entre dos hojas, que toda hoja traiga
ejemplos y contraejemplos, que ninguna rama pueda ganar, que cada hoja se recupere a sí misma
por léxico y que el catálogo entero quepa en la caché de sondas.

## Coste: qué crece y qué no

| Coste | Cómo escala | Estado |
| --- | --- | --- |
| Arranque (siembra) | Una escritura por categoría, **por niveles y de veinte en veinte** | Un puñado de idas y vueltas, no 164 |
| Vector por categoría | Uno por `(categoría, versión)`, calculado una vez y **persistido** | ~164 embeddings tras un cambio de catálogo |
| Recuperación por glosa | Producto escalar sobre el catálogo completo, en proceso | Despreciable con centenares de hojas |
| Clasificación `DEEP` | Sondas de las 8 candidatas, con **caché LRU** | 4.000 sondas ≈ 12 MB, cubre el catálogo entero |

El recuperador híbrido calcula la similitud en el proceso, sobre vectores persistidos, y eso es
correcto mientras el catálogo se cuente por **centenares**. Con muchos miles de categorías la
decisión correcta sería la contraria —`pgvector` y búsqueda en la base—, y por eso la cobertura
crece sobre todo en glosas y no en hojas.

## Después de tocar el catálogo hay que recalibrar

Los umbrales del adaptador de transformers son valores de **coseno medidos sobre este árbol
concreto**, no constantes del dominio. Al añadir hojas se mueve la frontera entre acertar y
abstenerse, y el efecto tiene una dirección conocida: con más hojas **todas** casan un poco
mejor con cualquier glosa, el ganador se despega menos del pelotón y las hojas de umbral alto
—tributos, financieros— dejan de alcanzarlo.

```bash
node scripts/semantic-calibration.mjs
```

Necesita el motor levantado y el servidor de embeddings sirviendo el modelo. Con el resultado se
ajustan `SEMANTIC_TRANSFORMER_SIMILARITY_FLOOR` y `SEMANTIC_TRANSFORMER_TEMPERATURE`, que están
documentados con su medición en `.env`.

!!! warning "Medición pendiente"
    La última calibración publicada es la del árbol de 48 hojas. El catálogo actual tiene 148 y
    **todavía no se ha vuelto a medir**: el suelo de similitud y la temperatura vigentes son los
    de aquel árbol. Sembrar un catálogo más rico con umbrales calibrados para el anterior puede
    empeorar la precisión aunque el catálogo sea mejor.
