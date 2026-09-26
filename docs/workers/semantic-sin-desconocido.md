# Ninguna glosa se queda sin categoría

Un informe de gastos con filas vacías no es un informe a medias: es un informe que
traslada el problema entero a quien lo recibe, fila por fila. «Sin determinar» no se suma,
no se audita y no se puede explicar.

El worker semántico podía abstenerse por **tres motivos que no tienen nada que ver entre
sí**, y los tres acababan igual:

1. El modelo respondió y ninguna candidata alcanzó su umbral.
2. El presupuesto del tenant se agotó y no llegó a preguntarse nada.
3. El análisis tardó más que su reloj y murió a medias.

Los tres se cierran con la misma pieza —las reglas deterministas, que no consultan a
nadie— y con una distinción que hace que cerrarlos sea honesto.

## La distinción: se publica QUÉ, y también QUIÉN lo decidió

```text
SemanticAnalysisResult
  ├─ decidedBy: MODEL | RULE | BIN
  ├─ requiresReview: boolean
  └─ reviewReason: LOW_CONFIDENCE | TIMEOUT | PROCESSING_ERROR | null
```

Desde que la red de seguridad garantiza que siempre hay categoría, «tiene categoría» dejó
de significar «el modelo la entendió». Sin `decidedBy`, un `MATCH` del modelo y un cajón
por sentido se leen igual en el informe, en la métrica y en la bandeja — y no se pueden
sumar en el mismo número.

`requiresReview` es la contrapartida: se publica algo útil y se dice, en el mismo objeto,
que alguien debería mirarlo. **Sin él, dejar de emitir `UNKNOWN` habría vaciado la bandeja
de revisión sin haber resuelto un solo caso más.** Por eso el procesador escala por esa
bandera y ya no por el estado.

## Las dos capas de reglas

`core/application/glosa-fallback.ts`, y el orden entre ellas no es negociable:

- **RUBRO.** La glosa nombra el concepto: `ELFEC`, `YPFB`, `IMPUESTOS NACIONALES`, `AFP
  FUTURO`, `ALQUILER`, `NETFLIX`. Aquí el texto dice **en qué** se gastó, y es una
  afirmación tan fuerte que puede resolver sin consultar al modelo.
- **INSTRUMENTO.** La glosa sólo declara el vehículo: traspaso, QR, POS, retiro, comisión.
  Es cierto pero pobre, y sólo actúa cuando ningún rubro casó.

`PAGO SERVICIO ELFEC` es electricidad antes que «un pago». Por eso el rubro gana siempre.

### Resolución jerárquica contra el catálogo del tenant

Una regla propone una **lista** de códigos, no uno. Si el catálogo no tiene la hoja fina se
prueban sus ancestros por la ruta punteada; lo que nunca hace es bajar ni saltar de rama —un
hermano no es una aproximación, es otra afirmación—. Si la regla no tiene dónde caer, **no
descarta a las demás**: la clasificación baja de rubro a instrumento en vez de desplomarse
hasta el cajón. Lo degradado se marca (`degradado: true`) y deja de poder usar el atajo.

## El atajo: resolver sin preguntarle a nadie

Los rubros de certeza ALTA resuelven **antes** de llamar al modelo
(`SEMANTIC_ANALYSIS_RULE_FAST_PATH_ENABLED`, encendido por defecto). No es una optimización
cosmética: un extracto de trescientas filas trae más de la mitad con el rubro rotulado, y
sin atajo son trescientas llamadas compitiendo por el mismo reloj — las últimas son las que
agotan el presupuesto y acaban en la bandeja por lentitud.

Se publica con `model: "rule-fast-path"` para que los tableros no cuenten como llamada del
proveedor algo que nunca lo invocó.

## El rescate por lentitud

`SEMANTIC_ANALYSIS_TIMEOUT_RESCUE_ENABLED`, encendido por defecto. Agotar el reloj deja de
ser un fallo terminal: la glosa se lee por reglas y se publica con `reviewReason: TIMEOUT`.
Antes moría la ejecución, la cola reintentaba y el mismo texto volvía a tardar lo mismo; el
movimiento no llegaba nunca al informe.

**Lo que NO se rescata es un error del proveedor.** Ahí no se sabe si el modelo habría dicho
otra cosa, así que sigue fallando y reintentándose: un corte escondido detrás de miles de
«otros gastos» es peor que un corte visible.

## El último escalón

`GASTOS.OTROS` / `INGRESOS.OTROS`, con umbral de aceptación `1` —inalcanzable por
similitud— para que el cajón nunca le robe un movimiento a una hoja real. Sólo llega ahí
quien lo coloca a propósito, y siempre marcado para revisión.

Ante la duda de sentido se asume **salida**: en un extracto la mayoría de las filas lo son,
y equivocarse hacia el gasto es el error conservador cuando lo que se mide es capacidad de
pago.

## Qué lo vigila

| Prueba                                    | Qué fija                                                        |
| ----------------------------------------- | --------------------------------------------------------------- |
| `test/semantic-cobertura-categorias.spec.ts` | Que toda categoría que una regla propone **existe** como hoja sembrada, y que ninguna glosa sale sin código. |
| `test/semantic-pipeline-garantias.spec.ts`   | Que el pipeline usa las reglas en las **tres** salidas, y que dice de dónde salió cada decisión. |

La primera es la que atrapa el fallo más fácil de introducir aquí y más difícil de notar:
una regla con un código mal escrito compila, no rompe nada y sólo se manifiesta como
movimientos que caen al cajón sin que nadie sepa por qué.
