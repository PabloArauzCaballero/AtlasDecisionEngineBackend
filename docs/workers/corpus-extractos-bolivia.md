# El glosario del emisor, los impuestos que cambiaron y los umbrales que nadie midió

El worker de extractos sabía leer un PDF, atribuirlo a una entidad de ASFI y calcular una capacidad
de pago. Lo que no sabía era **de dónde salía cada cosa que afirmaba**: la categoría de un
movimiento la decidían unas palabras que escribimos nosotros, el 35 % del endeudamiento se
justificaba con «la práctica prudencial», y el ITF seguía siendo un impuesto vigente dieciocho meses
después de que una ley lo abrogara.

Este documento cuenta qué cambió con el corpus de extractos delante, y qué se midió sobre extractos
bolivianos reales.

## Los dos corpus viven en el repositorio

En `corpus/`, sin editar, con su procedencia y sus prohibiciones escritas en `corpus/README.md`. No se leen en tiempo
de ejecución: `yarn corpus:generar` los convierte en TypeScript tipado y `yarn corpus:check` falla si
alguien cambia uno y no regenera el otro. Cada catálogo derivado lleva el SHA-256 del corpus del que
salió, y `test/corpus-catalogos-derivados.spec.ts` comprueba que sigue siendo el del archivo.

El motivo de generar en vez de transcribir es aritmético: 147 glosas oficiales, 67 fichas de emisor y
veinte rótulos legales copiados a mano garantizan que alguno se desvíe, y **una glosa mal copiada no
rompe nada** — sólo clasifica mal el dinero de una persona, en silencio, durante meses.

## El glosario oficial del BCP, medido sobre un extracto real

El corpus trae las **147 filas del glosario que publica el BCP**, que es el único glosario oficial
boliviano que la investigación encontró. Son códigos, no palabras: `CENT_PAGO_PREST`, `NCRSIREJRET`,
`WASIREJSUSODSCICC-`, `ODG`, `CTPV`. Ninguna regla escrita de memoria las acierta.

Medido sobre un extracto real del BCP con 112 movimientos: **75 casan con el glosario oficial**.

```
Interesganado                  → INTEREST            [literal exacto]
Retencionrciva                 → TAX_RCIVA           [alternativa declarada]
Transferencia Qr Bm Qr …       → TRANSFER_OTHER_BCP  [prefijo]
Transferencia Qr Bcp 7011…     → TRANSFER_OTHER_BCP  [prefijo]
```

Sobre los otros cinco extractos reales —BancoSol, Mercantil, Ganadero, Nacional, Unión— casan
**cero**, que es exactamente lo correcto: de esos emisores no hay glosario publicado y rellenar el
hueco con las glosas del BCP parecería cobertura.

### Cuatro reglas que gobiernan esa consulta

1. **La columna contable manda sobre la dirección declarada.** El glosario dice que `ACH REC` va en
   los dos sentidos y que los `NCR…` son cargos; cuando la fila dice otra cosa, gana la fila. Forzar
   el lado por la glosa es una de las reglas de importación que el corpus prohíbe. La discrepancia se
   **declara** (`CONTRADICTS_GLOSSARY`) porque casi siempre es una columna mal leída por el extractor.
2. **La categoría es analítica, no del banco.** Las 147 llegan con
   `analytical_category_provenance: INFERIDO`. No se puede decir «el banco dice que esto es un
   seguro».
3. **No se inventan expresiones regulares.** Las 147 traen `regex: null`. Lo único que se deriva es lo
   que el propio literal declara: en `COBRO_SPF_AAAAMM` el emisor escribió que ahí va un año y un mes;
   en `D.A. "Empresa"`, que ahí va un nombre.
4. **Un literal de una o dos letras sólo casa exacto.** El glosario tiene `I` (internet), `M`
   (móvil), `AP`, `BA`, `BL`, `CW`. Casarlos por prefijo convertiría cualquier glosa que empiece por
   «I » en una operación de banca por internet.

### El glosario puede QUITAR un ingreso, no darlo

`PagoHAB` tiene categoría `SALARY_PAYMENT` y tratamiento `DO_NOT_ASSUME_INCOME`, y las dos cosas son
ciertas a la vez: desde la cuenta de una empresa, esa glosa es la planilla que **paga**. Sólo tres de
las 147 —`SALARY_CANDIDATE_REQUIRES_CREDIT_AND_VERIFICATION`— autorizan a llamar nómina a un abono, y
aun así hay que comprobar que sea un abono mirando la columna.

Hay una excepción, y está medida. Cuando el glosario casa **sólo por prefijo** y el léxico local
encontró algo más específico dentro de la misma glosa, gana el léxico: en `Transferencia QR BM QR
Restotech Ventaid` el literal oficial que casa es `TRANSFERENCIA` —correcto para «una transferencia»,
demasiado ancho para ésta—, y `QR` más el nombre del comercio dicen que es el cobro de una venta. Sin
esa excepción, la capacidad de pago de cualquier comerciante que cobra por QR se hundía por la
primera palabra de su glosa.

## El ITF está abrogado, y eso no hace falso a ningún extracto

La Ley 1717, promulgada el 10 de abril de 2026, abrogó el Impuesto a las Transacciones Financieras. Y
sin embargo el glosario del BCP sigue publicando `ITF`, `IMPUESTO ITF` y `DEVOLUCION ITF`, y los
extractos reales siguen trayendo esas filas: un reverso, una regularización o un hecho anterior al
corte llevan el impuesto de su época.

Es el escenario que rompe un motor ingenuo por los dos lados. `core/engine/quality/bolivia-taxes.ts`
lo resuelve con tres hechos versionados:

- el ITF **no** es un cargo regular vigente (`currentlyChargeable: false`),
- **ni** su presencia en una glosa es una marca de fraude (`automaticFraud: false`, y está escrito
  como campo para que sobreviva a la próxima refactorización),
- la fecha exacta de corte operativo **no se verificó**, así que ninguna fecha convierte una fila en
  sospechosa.

Del RC-IVA sólo están verificados los tres literales del glosario: alícuota, base y exenciones son un
hueco declarado, así que no se reconstruye el importe esperado de una retención. Del IUE sobre
intereses, nada: el corpus lo deja en `UNRESOLVED` con la instrucción de no aplicarlo por coincidencia
léxica.

## Los ocho parámetros de capacidad de pago, con su procedencia

La auditoría del corpus revisó los ocho uno por uno y devolvió lo mismo en los ocho:
`calibrated_on_observed_arrears: false`, `verified_replacement_value: null`,
`measured_error_of_current_value: null`.

Los valores no se han movido —el corpus entrega rejillas de sensibilidad para medirlos y advierte,
con esas palabras, que **una rejilla no es una política**—. Lo que ha cambiado es que ya no se
presentan como medidos: `AffordabilityAssessment.calibration` viaja en cada evaluación diciendo
`NOT_CALIBRATED_AGAINST_OBSERVED_ARREARS` y `engineRole: MEASUREMENT_NOT_APPROVAL`.

Y se han corregido las justificaciones que no se sostenían:

| decía                                                                                  | dice ahora                                                                                                                          |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| «tres meses es el mínimo que exige la práctica supervisora (FCA, EBA)»                 | ASFI no publica un mínimo universal de tres meses, y la literatura citada describe ventanas de hasta doce sin prescribir ninguna    |
| «15 % es el techo habitual del consumo a plazo corto»                                  | aparece en una norma boliviana **histórica** de 2013, con un denominador concreto, y no se verificó que siga vigente                |
| «35 % es el corte de la práctica prudencial»                                           | no está verificado como tope de ASFI; el 35-40 % de CONDUSEF es material educativo mexicano y su ejemplo mide sobre el **residual** |
| «el piso se ancla en el salario mínimo, que es el suelo de un ingreso de subsistencia» | el salario mínimo 2026 son 3.300 Bs **y no es una canasta de gasto**; por eso el piso de 2.750 no se sustituye solo por 3.300       |

## Lo desconocido dejó de valer cero

Tres cambios con la misma forma, y los tres mueven dinero:

- **La deuda que se paga en otro banco no está en este extracto, y no vale cero.**
  `obligations.externalDebtService` es `number | null` y nunca se rellena solo; cuando llega `null`,
  la evaluación publica `isLowerBound: true` y un motivo que lo dice
  (`AFF_DEUDA_EXTERNA_NO_OBSERVADA`). Con la confusión anterior, la peor cartera posible —quien paga
  tres cuotas en entidades que no vemos— salía con la mejor relación de endeudamiento del sistema.
- **Un mes cubierto sin ingresos vale cero; un mes no cubierto no vale nada.** Los meses salían de
  agrupar movimientos, así que un mes entero sin actividad desaparecía de la serie: una persona con
  5.000 en enero, nada en febrero y 5.000 en marzo declaraba una mediana de 5.000 cuando su ingreso
  mensual observado es 3.333. Ahora el hueco se materializa dentro de la ventana observada y cuenta
  como cero **para el ingreso**; para el gasto no, porque un mes sin cargos no significa que la
  persona no comiera.
- **El mínimo y la media del saldo no son intercambiables.** Dos cuentas con el mismo mínimo de cero:
  una tuvo 10.000 durante veintinueve días y otra no tuvo nada nunca. `balance-series.ts` publica las
  dos medidas, los días en negativo y los **episodios** de sobregiro —un descubierto de doce días es
  un episodio, no doce—.

## La marca no es el operador

`Tigo Money` lo opera E-FECTIVO ESPM S.A., una empresa de servicio de pago móvil con licencia de ASFI
(sigla `MEF`). Su estado de cuenta lleva la palabra TIGO en la carátula y se rechazaba como si fuera
la factura de una telefónica. Ahora la marca de la telefónica lleva exclusiones, y la carátula de la
billetera publica `billetera-con-operador:MEF` para que quien revise sepa qué tiene delante. La
factura de telefonía del mismo grupo se sigue rechazando.

En la misma línea, el padrón incorpora los estados que el corpus publica al corte del 31 de agosto de
2026: Banco Fassil pasa de `REVOKED` a **`INTERVENED`** —una intervención no implica revocación
automática, y no consta ni fecha ni resolución—, y entran Banco Do Brasil (liquidación voluntaria),
Intercoop (quiebra) y Sembrar Sartawi (absorbida por IDEPRO, con su sucesora nombrada).

## Los dos ejes de la forense del PDF

Seguridad del archivo y procedencia del documento son preguntas **independientes**, y mezclarlas en
un solo número dejaba abierta la peor operación posible: que una señal favorable de procedencia —el
generador institucional, que vale −25— restara de un fallo de seguridad. `ForensicReport` publica
ahora `securityScore` y `provenanceScore` por separado, y el primero **nunca** aplica créditos.

Los pesos siguen siendo los que declaró el encargo, y el informe lo dice:
`calibration: UNCALIBRATED_WEIGHTS_DECLARED_IN_BRIEF`. La auditoría del corpus devolvió
`recommended_numeric_weight: null` en las diez señales, porque no existe un corpus de extractos
bolivianos alterados con verdad conocida contra el que medirlas.

## El documento equivocado ya no recibe una respuesta inútil

Quien sube un archivo a un flujo de crédito sube lo que tiene a mano, y casi nunca es un extracto de
tres meses. `document-routes.ts` traduce el tipo reconocido a la **ruta** del corpus, y la ruta a una
frase accionable:

| lo que subió                 | lo que se le dice                                                          |
| ---------------------------- | -------------------------------------------------------------------------- |
| comprobante de transferencia | es el comprobante de una operación, no la historia de una cuenta           |
| certificado de saldo         | es una foto de un día, no una historia: no permite ver regularidad         |
| resumen de tarjeta           | describe **deuda**, no ingreso; el límite disponible no es dinero de nadie |
| boleta de pago               | respalda el ingreso, no demuestra que llegara a una cuenta                 |
| billetera móvil              | se puede usar: hay que comprobar titularidad, cobertura y contrapartes     |

Ninguna es una acusación. Un documento mal elegido se arregla subiendo otro.

## Cuatro medidas sobre el dinero, sin un solo umbral

Las compuertas de autenticidad preguntan si el PDF es el que emitió un banco.
`economic-plausibility.ts` pregunta otra cosa, que un PDF perfectamente auténtico puede fallar: si lo
que el extracto describe es una vida económica o una puesta en escena.

- **Flujo pareado por contraparte** — entra 5.000 de alguien y salen 5.000 al mismo sitio, tres meses
  seguidos.
- **Concentración antes del cierre** — abonos elegibles de los últimos **7 días** (la ventana viaja
  declarada en el resultado) sobre los del periodo.
- **Movimientos repetidos** — misma fecha, importe, sentido y glosa.
- **Cargos sobre abonos** — `null` cuando no hubo abonos, porque sin denominador no hay ratio.

Las cuatro llegan con `threshold: null` en el corpus y con su lista de confusores legítimos: un
reembolso familiar, un préstamo entre conocidos, la tesorería entre cuentas propias, el sueldo que
siempre cae a fin de mes, la cuota fija que se repite idéntica, la cuenta de ahorro donde nadie
gasta. Cada confusor es una persona honesta a la que un corte mal puesto le cierra el crédito, así
que esto **mide y publica**: no puntúa, no marca y no rechaza. El día que haya cartera con mora
observada serán las variables candidatas de un modelo, y el corte saldrá de los datos.

## Lo que se puede afirmar con una muestra

`src/common/statistics/binomial.ts` existe porque las dos frases que más circulaban en este
repositorio no eran mediciones: «el clasificador acierta el 81 %» (sobre 21 casos) y «cero falsos
positivos». Con 17 aciertos de 21, el intervalo de Wilson al 95 % va de **0,60 a 0,92**; con cero
falsos positivos sobre 299 documentos, lo que se puede afirmar es que la tasa está **por debajo del
0,997 %**, no que sea cero.

Las fórmulas son las del NIST y la implementación se comprueba contra las tablas que los propios
corpus traen calculadas — un oráculo independiente, no nuestras propias pruebas.

## Los 21 casos de contrato

`test/corpus-extractos-regresion.spec.ts` ejecuta contra el código los 21 casos que el corpus define,
y una prueba comprueba que no se quede ninguno sin ejecutar. No miden el worker: fijan lo que el
worker **no** puede hacer.
