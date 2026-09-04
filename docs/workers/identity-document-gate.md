# La puerta de documentos de identidad y el arbitraje

El worker de identidad tenía **una sola salida** para toda imagen que su clasificador no
supiera nombrar: `IDENTITY_DOCUMENT_UNSUPPORTED`, «ese tipo de documento no está
soportado». Con esa forma, la cédula fotografiada de noche y la foto de un recibo recibían
la misma respuesta y el mismo desenlace: ejecución fallida.

A quien tenía una cédula perfectamente válida se le decía que su cédula no era una cédula.
A quien subió un recibo no se le decía nunca qué había subido. Y en la columna de estado,
«esto no es un documento» —que es el motor **acertando**— se leía igual que «el proveedor
biométrico se cayó», de modo que la tasa de fallos del worker subía cada vez que alguien
se equivocaba de foto.

Este documento describe la separación que corrige eso.

## La regla

```text
Imagen cargada
      ↓
¿Se puede leer algo? (suelo de resolución medido)   no → rechazo, sin gastar OCR
      ↓ sí
¿Hay EVIDENCIA de que sea un documento de identidad?
      ↓
  claramente sí   → ¿es un tipo admitido?
                       sí → PROCESAR (lectura, biometría, decisión)
                       no → DOCUMENT_REJECTED · UNSUPPORTED_DOCUMENT_TYPE
  duda razonable  → PENDING_REVIEW  (arbitraje, con categoría)
  claramente no   → DOCUMENT_REJECTED · NOT_AN_IDENTITY_DOCUMENT (fuera de la cola)
```

> **El arbitraje se reserva para casos verdaderamente ambiguos, no para imágenes que
> obviamente no son un documento.** Poner delante de una persona la foto de un paisaje le
> cuesta el mismo minuto que un caso real y no desbloquea a nadie: el trabajo que lo
> arregla sólo puede hacerlo quien subió la foto.

## Las dos confianzas, que no son la misma pregunta

| Campo                        | Qué mide                                              | Qué decide                        |
| ---------------------------- | ----------------------------------------------------- | --------------------------------- |
| `document_type_confidence`   | Si la imagen **es** un documento de identidad         | Procesar · arbitrar · rechazar    |
| `classification.confidence`  | **Cuál** de los documentos conocidos es               | Qué analizador lee los campos     |

Colapsarlas hacía que «es claramente una cédula, no sé de qué país» —que es un caso para
mirar en segundos— y «esto es una factura» —que es un rechazo— se leyeran igual.

La primera la calcula `core/engine/identity-evidence.ts`, sumando señales con el peso que
cada una **demuestra**:

| Señal                   | Peso | Por qué ese peso                                                        |
| ----------------------- | ---- | ----------------------------------------------------------------------- |
| `identity-title`        | 0,30 | El documento dice lo que es. Es la señal más directa que existe.         |
| `machine-readable-zone` | 0,30 | Formato normalizado por OACI: no aparece por accidente en otro papel.    |
| `issuing-authority`     | 0,20 | SEGIP, «Estado Plurinacional». Sólo un Estado imprime esto en una tarjeta. |
| `personal-fields`       | 0,20 | Dos o más rótulos personales juntos. Un recibo trae uno, no cuatro.      |
| `document-number`       | 0,10 | Un número suelto lo lleva cualquier comprobante.                         |
| `id1-aspect-ratio`      | 0,10 | Media Bolivia fotografía cosas rectangulares. Sólo desempata.            |

### Los contraindicadores CIERRAN el caso

No restan: ponen la evidencia en cero. Son marcas que sólo existen en otro documento —el
código de control de una factura, el «saldo anterior» de un extracto— y encontrarlas no es
evidencia en contra, es la respuesta. Sin esto, una factura boliviana —que imprime nombre,
fecha y número del cliente— acumulaba señales legítimas hasta colarse en la franja de duda
y ocupar el tiempo de una persona.

## La fotografía real, y por qué el texto exacto no sirve

Todo lo de arriba se calibró contra los ejemplares sintéticos de `fixtures/identity-card.ts`,
que están **dibujados** con los rótulos del catálogo en una tipografía limpia. Contra ellos la
puerta acertaba siempre. La primera medición sobre una cédula boliviana auténtica del DS 4924
fotografiada con un móvil dice otra cosa: los rótulos de la tarjeta van impresos en gris, a
cuerpo muy pequeño y sobre un guilloché tricolor, y el reconocedor los devuelve mutilados.

| Impreso                 | Leído (medido)          |
| ----------------------- | ----------------------- |
| CÉDULA DE IDENTIDAD     | `CEI 1 DE` … `IDENTIDAD`|
| IDENTIFICACIÓN PERSONAL | `ITIFICACIÓN PERSONA)`  |
| FECHA DE NACIMIENTO     | `PFrCHA DE MACIMIENTO`  |
| FECHA DE EMISIÓN        | `FECHA DI EMIBION`      |
| FECHA DE EXPIRACIÓN     | `rca DE FAPIRACIÓN`     |
| DOMICILIO               | `DOMICILI`              |

Ninguna de esas lecturas casaba con su expresión regular. La consecuencia no era una nota más
baja: la cédula se **rechazaba entera** con «la imagen no corresponde a ningún documento de
identidad soportado», y encima la búsqueda de orientación —que usaba el clasificador como
criterio de éxito— tampoco encontraba el giro de una tarjeta fotografiada en vertical, porque
las cuatro orientaciones contestaban lo mismo.

### El catálogo versionado, con su porcentaje de evidencia

`core/catalog/bolivia-ci.catalog.ts` describe **cada generación de la tarjeta** —la del
DS 4924 y la anterior— como una lista de elementos a comprobar, cada uno con su cara, su peso
y las grafías que la tarjeta imprime. `core/catalog/bolivia-ci.recognizer.ts` mide una lectura
contra las dos plantillas y devuelve la **cobertura**: qué proporción del peso del catálogo
apareció. Es el mismo reparto que el worker de extractos usa con las entidades financieras.

Esa cobertura es una sola medida y la usan tres sitios, deliberadamente:

- el **clasificador** la usa para nombrar el documento (y la publica como su `confidence`);
- la **búsqueda de orientación** la usa como puntaje para comparar los cuatro giros;
- el **análisis de fraude** la usa para juzgar si la plantilla está completa.

Con dos implementaciones, el mismo documento sería una cédula para la puerta y una plantilla
incompleta para el análisis, en la misma ejecución.

El cotejo es tolerante (`core/catalog/approximate-match.ts`): distancia de edición contra la
subcadena más parecida, con **una edición por cada cinco caracteres** y sólo para rótulos de
**ocho caracteres o más**. El mínimo de ocho no es estético: con cinco, `SECCIÓN` casaba dentro
de «DIRECCIÓN DEPARTAMENTAL» a distancia 1 y una licencia de conducir puntuaba más que la
cédula real.

### Cobertura no basta para nombrar el documento

Todas las tarjetas oficiales bolivianas se parecen —encabezado del Estado, nombres, apellidos,
dos fechas— y medido, una licencia de conducir alcanza 0,558 de cobertura. Por eso el
clasificador exige además **un anclaje que sólo lleve una cédula**: el rótulo del documento, la
MRZ TD1, SERIE, SECCIÓN, el NPIOC o el grupo sanguíneo. Y pregunta antes por el pasaporte y por
la licencia, que se declaran a sí mismos.

### Dos resoluciones de lectura

`IDENTITY_OCR_MAX_LONG_EDGE` (600) está calibrado para **rechazar barato**: sobre ruido de
12 MP, Tesseract cuesta 513 ms a ese tamaño y 5569 ms a 1200. Pero a 600 px se pierde el dígito
de control del número en la MRZ —la `7` se lee como `T`— y con él el número de cédula y la
fecha de nacimiento enteros. Así que hay un segundo tope, `IDENTITY_OCR_FINE_LONG_EDGE` (1200),
que **sólo se paga cuando el catálogo ya reconoció algo**. Medido sobre la cédula real:

| Lado del OCR | Cobertura | Qué aparece                                      |
| ------------ | --------- | ------------------------------------------------ |
| 600          | 0,216     | ni el rótulo ni ninguna fecha                    |
| 900          | 0,463     | las tres fechas y sus rótulos                    |
| 1200         | 0,515     | «IDENTIDAD» y el control del número en la MRZ    |
| 1600         | 0,664     | «IDENTIFICACIÓN PERSONAL», «DOMICILIO»           |

En las tres orientaciones equivocadas la cobertura es **cero exacto** a las cuatro
resoluciones, que es lo que permite elegir el giro comparando en vez de por umbral.

Medido de punta a punta con esas dos fotos: la cédula tumbada se resuelve en 3,6 s con
evidencia 0,917, tipo `BOLIVIA_CI` y todos los campos; la misma derecha, en 2,0 s; el ruido de
12 MP se sigue rechazando en 2,4 s y una selfie subida como documento en 0,9 s.

Las lecturas degradadas —con datos sintéticos, nunca los de una cédula real— están fijadas en
`test/identity-degraded-ocr.spec.ts`.

## Los umbrales, configurables

| Variable                              | Por defecto | Qué gobierna                                |
| ------------------------------------- | ----------- | ------------------------------------------- |
| `IDENTITY_DOCUMENT_ACCEPT_CONFIDENCE` | `0.55`      | Desde aquí se procesa sin preguntar.        |
| `IDENTITY_DOCUMENT_REVIEW_CONFIDENCE` | `0.25`      | Desde aquí hay duda; por debajo, no la hay. |
| `IDENTITY_ACCEPTED_DOCUMENT_TYPES`    | `BOLIVIA_CI`| Qué tipos admite este despliegue.           |
| `IDENTITY_ARBITRATION_MODE`           | `HUMAN`     | Quién resuelve la franja de duda.           |
| `IDENTITY_OCR_MAX_LONG_EDGE`          | `600`       | Lado largo de la primera lectura, la barata.|
| `IDENTITY_OCR_FINE_LONG_EDGE`         | `1200`      | Lado largo de la relectura, cuando hay documento. |

`normalizeIdentityThresholds` ordena el par: un `review` por encima del `accept` dejaría la
franja de duda **vacía** y todo documento dudoso se rechazaría en silencio, que es justo el
fallo que la puerta existe para impedir.

**Sólo el carnet por defecto.** Un pasaporte legítimo se rechaza —con su propio motivo,
`UNSUPPORTED_DOCUMENT_TYPE`, y no con «no es un documento»— hasta que alguien lo habilite.
Son dos instrucciones distintas para quien está delante del móvil, y darle la equivocada le
hace repetir la misma foto.

## El arbitraje es un PUERTO, no una llamada a la bandeja

`IdentityArbitrationPort` (`core/ports/identity.ports.ts`) tiene dos implementaciones y la
elige el entorno:

- **`HumanIdentityArbitrationAdapter`** — deja el caso en la cola y responde `DEFERRED`. No
  finge un veredicto: una persona no contesta dentro de la petición HTTP que le pregunta.
- **`AiIdentityArbitrationAdapter`** — declarado y todavía sin modelo detrás. **Falla hacia
  la cola humana, nunca hacia la aceptación**, y lo dice en su `health()` para que un
  despliegue mal configurado se vea en el estado del worker y no como una cola que crece
  sin que nadie sepa por qué.

El seam existe desde hoy a propósito: si el puerto tuviera una sola implementación, «es
hexagonal» sería una afirmación sin comprobar, y el día que llegue el modelo habría que
descubrir a la vez qué contrato necesitaba y por qué el pipeline no lo respetaba.

## La cola, y cómo se cierra un caso

`GET /v1/workers/identity-verification/reviews` — la cola, paginada y por categoría.
`POST …/{requestId}/claim` — reclamar. `POST …/{requestId}/resolve` — cerrar.

Dos acciones y no cuatro, porque la pregunta que se hizo es una sola:

- **`CONFIRM_DOCUMENT`** exige nombrar el tipo. Sin tipo no hay analizador, y reencolar sin
  él devolvería el caso a la misma cola por el mismo motivo — el bucle es exactamente lo que
  ese campo impide. La ejecución vuelve a `QUEUED` y el worker la retoma; esta vez la puerta
  **no pregunta**, porque la respuesta ya está dada (`DOCUMENT_ARBITRATED` queda en las
  marcas de riesgo del veredicto final).
- **`REJECT_DOCUMENT`** exige un motivo: un rechazo sin motivo no es medible.

En el portal es la pestaña **Revisión** del worker de identidad
(`IdentityArbitrationQueue`), encima de la bandeja de parecidos ambiguos.

## Invariantes que el resto del módulo da por ciertas

1. `DOCUMENT_REJECTED` **siempre** lleva `rejection_reason` y **nunca** `review_reason`, así
   que jamás aparece en la cola. Es la regla que impide que la cola se convierta en el
   basurero de lo que el motor no entendió. Lo sostienen dos `CHECK` en la base.
2. `PENDING_REVIEW` **siempre** lleva `review_reason`. Un pendiente sin motivo no se puede
   categorizar, y una lista sin categorías vuelve a ser la tabla gigante que la pestaña
   existe para no ser.
3. La prioridad se **deriva** del motivo (`identity-outcome.ts`). Puesta a mano acabaría
   siendo «alta» siempre, que es lo mismo que no tenerla.
4. **Un pendiente conserva las imágenes en la BASE.** La regla —borrar las columnas `Bytes`
   al cerrar— sigue intacta porque un caso en revisión no está cerrado: sin ellas, la pestaña
   ofrecería «resolver» sobre una fila sin nada que mirar.
5. Un fallo del proveedor **no** entra en la cola ni se marca como documento rechazado.
   Nadie puede resolver desde una pantalla que el servicio biométrico esté saturado, y ese
   camino conserva sus reintentos.

## Las imágenes sobreviven al cierre desde el 2026-09-03

Antes no. Las columnas `document_bytes`, `document_back_bytes` y `selfie_bytes` se ponen a `NULL`
en los seis sitios donde una ejecución termina, así que la cara y el carnet sobre los que se
decidió **dejaban de existir**: no había forma de revisar un caso cerrado, de responder a una
impugnación ni de auditar un rechazo.

Ahora se copian al almacén de objetos (MinIO) **al ingresar**, antes de crear la fila, y las tres
claves quedan en `document_object_key`, `document_back_object_key` y `selfie_object_key`. La ruta
la impone el servidor: `identity/<tenant>/<requestId>/<tipo>-<uuid>.<ext>`.

- **No se tocó ninguna ruta de borrado.** Las columnas `Bytes` siguen siendo la copia de trabajo
  del pipeline y siguen desapareciendo igual — es lo que impide que la tabla crezca sin cota.
- **Se sube ANTES de crear la fila.** Al revés, una caída entre las dos operaciones deja una
  ejecución que se procesa, decide y cierra sin evidencia, y nadie se entera hasta que alguien va
  a mirarla. En este orden, si el almacén falla no hay alta y el cliente reintenta.
- **`IDENTITY_IMAGE_RETENTION_REQUIRED=true` convierte «no hay almacén» en un fallo de arranque.**
  Sin eso, la única señal de que se está perdiendo evidencia es su ausencia semanas después.
- **Las imágenes se sirven por la API**, no por una URL prefirmada del almacén:
  `GET /v1/workers/identity-verification/runs/:requestId/images/:kind` con `kind` en `document`,
  `documentBack` o `selfie`, y `Cache-Control: no-store`. La autorización por inquilino y rol la
  impone el motor; una URL firmada se reenvía por un chat y sigue valiendo hasta que vence.
- **Las ejecuciones anteriores a la migración tienen las tres claves en `NULL`**, y es la verdad:
  sus imágenes ya no están. El endpoint responde 404 y el portal lo dice con esas palabras.

El portal las pinta en la propia cola de arbitraje
(`AtlasDecisionEngineFrontend/src/features/workers/IdentityRunImagesPanel.tsx`), sólo al ABRIR un
caso: montarlas con la lista descargaría el carnet y la cara de las veinticinco personas de la
página para enseñar una tabla de resúmenes.

## Dónde está cada cosa

| Archivo                                              | Responsabilidad                                  |
| ---------------------------------------------------- | ------------------------------------------------ |
| `core/catalog/bolivia-ci.catalog.ts`                | Las dos generaciones de la tarjeta, como dato.   |
| `core/catalog/approximate-match.ts`                 | Cotejo tolerante a las erratas del reconocedor.  |
| `core/catalog/bolivia-ci.recognizer.ts`             | La cobertura: cuánta plantilla se reconoce.      |
| `core/engine/identity-evidence.ts`                   | Mide. No decide nada.                            |
| `core/engine/identity-triage.ts`                     | Decide entre rechazar, arbitrar y procesar.      |
| `core/adapters/identity-arbitration.adapter.ts`      | Los dos árbitros.                                |
| `identity-outcome.ts`                                | El único sitio que fija el estado final.         |
| `review/identity-review.service.ts`                  | La cola y sus dos acciones.                      |
| `common/storage/object-storage.service.ts`           | El almacén: dónde sobreviven las imágenes.       |

Pruebas: `test/identity-document-gate.spec.ts` (la política, sin imágenes),
`test/identity-verification-pipeline.spec.ts` (el camino completo, con imágenes generadas) y
`test/identity-degraded-ocr.spec.ts` (lo que devuelve el reconocedor sobre una fotografía real,
con datos sintéticos).
