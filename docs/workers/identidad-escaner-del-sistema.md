# El carnet tomado con el escáner del sistema

La app del cliente puede capturar el anverso y el reverso del carnet con el **escáner de documentos
del propio teléfono** —VisionKit en iPhone, ML Kit en Android— en vez de con su cámara. Lo decide la
bandera `EXPO_PUBLIC_ATLAS_ESCANER_DOCUMENTO` de la app, apagada por omisión. Esta página cuenta qué
hace el worker de identidad cuando la imagen viene de ahí, y por qué hace tan poco.

## Por qué el worker tiene que saberlo

Todo lo que el worker mide del documento —el [recorte por
densidad](identidad-cinco-cedulas-reales.md), la cobertura del catálogo, el forense de pantallas y
muaré ([fraude documental](identidad-fraude-documental.md))— se calibró con **fotografías** de
cédulas. Un escáner del sistema no entrega una fotografía:

- entrega la tarjeta **ya recortada** y con la perspectiva corregida;
- la **recodifica**, y ni VisionKit ni ML Kit dan acceso al original;
- en iOS aplica el **filtro que elija el usuario**: *Color* (por omisión), *Escala de grises*,
  *Blanco y negro* o *Foto*. En Android, en modo `base`, no aplica ninguno.

Es otra población de imágenes. Hasta que se mida contra ella, el caso tiene que decirlo.

## Por dónde llega el origen

| Paso | Dónde |
| --- | --- |
| La app lo manda a AtlasBackend | `POST /mobile/identity-verifications`, campo `documentCaptureSource` |
| AtlasBackend lo reenvía al Motor | `context.documentCaptureSource` de la petición de decisión |
| El runtime lo entrega al invocador de workers | `WorkerServiceInvokerService.bind(tenantId, principal, dto.context)` |
| El invocador lo valida y lo pasa al pipeline | `documentCaptureSourceFromContext` → `IdentityPipelineInput.documentCaptureSource` |

Valores: `camera` y `system_scanner` (`document-capture-source.ts`). La ausencia, `camera` y
cualquier valor desconocido significan lo mismo: la cámara, que es la población calibrada. Un valor
desconocido **no** rechaza la ejecución: quien lo manda mal no es la persona que está delante del
móvil.

**Por qué el contexto y no una variable del artefacto.** `IDENTIDAD_CARNET_MOVIL` es un artefacto
gobernado: una variable nueva exige una versión nueva, y esa versión la firman **dos personas** desde
el portal. El `context` ya viajaba en cada ejecución —entra en la huella de idempotencia— pero no
pasaba de ahí: el motor de grafo sólo entrega a los nodos las variables del artefacto. Ahora el
invocador de workers lo recibe al atarse a la ejecución, y cada servicio lee de él sólo la clave que
conoce. Las simulaciones reciben el mismo `context` que la ejecución real, también en la comparación
con producción.

Lo que **no** recibe el contexto: los casos de prueba del artefacto (`test-case-executor.service.ts`)
y las corridas directas del worker (`POST /v1/workers/identity-verification/runs`). Las dos siguen
por el camino de la cámara, como hoy.

## Qué cambia con `system_scanner`

1. **No se recorta el fondo.** `document-framing.ts` no se llama: la imagen ya es la tarjeta. La
   guarda del detector («si el documento ya llena el encuadre, no recortes») lo dejaría igual casi
   siempre, pero no siempre —un escaneo con un borde claro puede parecerle fondo— y en todo caso se
   gastaría el análisis. El resultado lleva `framing: { recortado: false, areaConservada: 1 }`.
2. **Se marca la población como no medida**: `THRESHOLD_PROFILE_UNMEASURED`, la MISMA marca que ya
   sale cuando el perfil de umbrales es sintético, más `DOCUMENT_CAPTURE_SYSTEM_SCANNER`, que dice
   por qué. Con un perfil medido, la primera sale igual: la pone el origen, no el perfil.
3. **Se mide el color del anverso** (`core/forensics/document-color.ts`) y, si no tiene, se añade
   `DOCUMENT_GRAYSCALE`. Es la fracción de píxeles con croma ≥ 24 sobre una miniatura de 256 px; por
   debajo del 1 % la imagen cuenta como sin color. Si `sharp` no puede con la imagen, no hay medida
   ni marca: una medida informativa no puede tumbar una verificación.
4. El resultado gana un bloque `capture: { source, encuadreOmitido, color }`, sólo en este caso.

Con el origen ausente o `camera` no cambia nada: no se mide el color, no hay bloque `capture`, el
recorte corre como siempre y las marcas son las de siempre.

## Por qué las tres marcas no deciden nada

Una marca de riesgo sólo pesa en la decisión por dos caminos, y las tres nuevas no entran en
ninguno:

- **Dentro del worker**, sólo escalan a revisión las marcas de la lista `escalantes` de
  `identity-pipeline.service.ts` (varios rostros, rostro diminuto, señales de vida de la selfie) y
  el veredicto del fraude. Las tres nuevas no están.
- **En el artefacto**, el nodo `VERIFICAR_IDENTIDAD` de `IDENTIDAD_CARNET_MOVIL` sólo proyecta
  `call.status`, `call.errorCode`, `result.decision`, `result.faceSimilarity`,
  `result.documentEvidence`, `result.documentType` y `result.liveness`. Ninguna condición lee
  `riskFlags`. Una prueba lo fija contra `scripts/lib/identidad-carnet-movil.definicion.json`: si una
  versión futura empieza a leerlas, se pone roja.

Las marcas sí viajan en `result.riskFlags` del nodo, que es lo que ve quien revisa el caso.

## Lo que prueban las pruebas, y lo que no

`test/identity-escaner-del-sistema.spec.ts`, con las cédulas **dibujadas** de
`src/modules/workers/identity-verification/fixtures/identity-card.ts` (ningún dato ni foto de una persona real):

- con `camera`, el desenlace entero es el mismo que sin origen, campo por campo;
- con `system_scanner` sobre una tarjeta ya recortada, no se llama al recorte y lo que decide
  —veredicto, motivos, campos, parecido, calidades, fraude— es igual al de la cámara sobre los
  mismos píxeles;
- sobre la misma tarjeta en grises, cámara y escáner deciden igual en los tres escenarios
  (aprobada, revisión, rechazada), y la única diferencia son las marcas del escáner;
- con la medida del color forzada a «sin color» sobre un VERIFICADO, sigue VERIFICADO;
- el origen llega desde el `context` hasta el pipeline, y un valor desconocido no llega.

La comparación redondea los números a 6 decimales: dos corridas del mismo pipeline sobre la misma
imagen no dan los mismos bits en las calidades (el último dígito, ~1e-14, cambia entre corridas).
Ningún umbral del worker tiene más de 4 decimales.

**Un hallazgo que no es de la marca.** Sobre las cédulas dibujadas, pasar el anverso a grises baja
el parecido con la selfie en color (0,95 → 0,72 en `identidad-aprobada`) y los tres escenarios
acaban en `NOT_VERIFIED` con `FACE_NO_MATCH`, por la cámara igual que por el escáner. Con rostros
dibujados no prueba nada sobre uno real, pero dice qué hay que mirar primero en la medición.

**Lo que no se ha medido: cómo lee el worker un escaneo real.** Eso es la fase 5 del plan del
escáner: las cinco cédulas del 6 de septiembre escaneadas con VisionKit (filtros *Color*, *Escala de
grises* y *Foto*) y con ML Kit `base`, pasadas por `scripts/diagnosticar-carnets.ts`. Ninguna imagen
ni dato de esas cédulas entra al repositorio. Criterio para seguir con el escáner del sistema:
números 5/5, nombres ≥ 4/5, ninguna marcada como compuesta ni como pantalla, y cobertura del catálogo
no peor que la de la foto directa de la misma cédula.

## Cuando la medición salga bien

`system_scanner` pasa a `DOCUMENT_CAPTURE_SOURCES_MEASURED` en `document-capture-source.ts`, y sus
casos dejan de llevar `THRESHOLD_PROFILE_UNMEASURED`. Es un cambio de código y no una variable de
entorno a propósito: declarar medida una población es una afirmación sobre un corpus, y tiene que
quedar en el historial junto a la medición.
