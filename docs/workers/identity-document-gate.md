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

## Los umbrales, configurables

| Variable                              | Por defecto | Qué gobierna                                |
| ------------------------------------- | ----------- | ------------------------------------------- |
| `IDENTITY_DOCUMENT_ACCEPT_CONFIDENCE` | `0.55`      | Desde aquí se procesa sin preguntar.        |
| `IDENTITY_DOCUMENT_REVIEW_CONFIDENCE` | `0.25`      | Desde aquí hay duda; por debajo, no la hay. |
| `IDENTITY_ACCEPTED_DOCUMENT_TYPES`    | `BOLIVIA_CI`| Qué tipos admite este despliegue.           |
| `IDENTITY_ARBITRATION_MODE`           | `HUMAN`     | Quién resuelve la franja de duda.           |

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
4. **Un pendiente conserva las imágenes.** La regla de privacidad —borrarlas al cerrar—
   sigue intacta porque un caso en revisión no está cerrado: sin ellas, la pestaña ofrecería
   «resolver» sobre una fila sin nada que mirar.
5. Un fallo del proveedor **no** entra en la cola ni se marca como documento rechazado.
   Nadie puede resolver desde una pantalla que el servicio biométrico esté saturado, y ese
   camino conserva sus reintentos.

## Dónde está cada cosa

| Archivo                                              | Responsabilidad                                  |
| ---------------------------------------------------- | ------------------------------------------------ |
| `core/engine/identity-evidence.ts`                   | Mide. No decide nada.                            |
| `core/engine/identity-triage.ts`                     | Decide entre rechazar, arbitrar y procesar.      |
| `core/adapters/identity-arbitration.adapter.ts`      | Los dos árbitros.                                |
| `identity-outcome.ts`                                | El único sitio que fija el estado final.         |
| `review/identity-review.service.ts`                  | La cola y sus dos acciones.                      |

Pruebas: `test/identity-document-gate.spec.ts` (la política, sin imágenes) y
`test/identity-verification-pipeline.spec.ts` (el camino completo, con imágenes reales).
