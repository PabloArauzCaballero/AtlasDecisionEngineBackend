# ADR-0032 — Admisión del extracto y capacidad de pago sobre tres meses

- **Estado**: aceptado
- **Fecha**: 2026-08-26
- **Sustituye a**: nada
- **Contexto relacionado**: ADR-0026 (integración de workers adicionales), ADR-0006 (importes como cadena)

## Contexto

El worker de extractos sabía convertir un PDF en movimientos y sabía preguntar dos cosas sobre
él: **«¿es un estado de cuenta?»** —el clasificador— y **«¿de quién es?»** —la compuerta de
emisor—. Las dos se responden leyendo el texto que el documento imprime.

Ese es exactamente el agujero. El texto lo escribe quien fabrica el archivo. Un documento
compuesto en un procesador de textos con la carátula de un banco copiada suma 1.00 en el
clasificador, se atribuye al banco cuyo nombre lleva escrito, y llega al análisis con una tabla
de movimientos que redactó el propio solicitante. Ninguna de las dos preguntas puede detectarlo,
porque ninguna de las dos mira el archivo: miran lo que el archivo dice.

Y una vez convertido, lo que se hacía con los movimientos era sumar. El consumidor de este motor
—el core de Atlas— tenía su propio lector: buscaba «abono» y «cargo» en el texto, sumaba y
restaba. Producía un ingreso que incluía los traspasos entre cuentas del propio titular y los
desembolsos de préstamo, un gasto que suponía que la persona no puede dejar de gastar nada, y
las dos cifras sobre el periodo que trajera el documento, fuera cual fuera. Un mes con el
aguinaldo dentro afirmaba que la persona gana el doble de lo que gana.

## Decisión

Tres cosas, y el orden entre ellas es parte de la decisión.

### 1. Una tercera compuerta, la PRIMERA: el contenedor

`core/engine/authenticity/` pregunta **con qué se fabricó el archivo y si se tocó después**. Lee
la estructura del PDF —diccionario `/Info`, revisiones incrementales, anotaciones superpuestas,
contenido activo, incrustación de fuentes— sobre los bytes en crudo y con expresiones regulares:
no interpreta el PDF, que es la misma decisión de seguridad que toma el lector de texto del core
—el archivo lo sube un desconocido y aquí no se ejecuta nada de lo que trae—.

Va **antes** que las otras dos porque es la única de las tres que no se puede satisfacer
escribiendo el texto correcto.

La evidencia va **ponderada**, no en una lista de prohibiciones. Que un PDF lo produjera Chrome
es normalísimo —media Bolivia imprime su banca por internet con «Guardar como PDF»— y sería un
rechazo absurdo; que lo produjera un programa de diseño no lo es en ningún escenario. Con una
lista de prohibiciones habría que elegir entre rechazar a los primeros o dejar pasar a los
segundos. Tres veredictos: se procesa, lo mira una persona, o se rechaza con un motivo que quien
lo subió puede resolver.

**No es verificación de firma digital.** Un extracto boliviano no viene firmado —ni ASFI lo exige
ni los bancos lo emiten así—, de modo que exigir firma rechazaría el 100 % de los documentos
legítimos. Esto es evidencia circunstancial, ponderada y explicada.

### 2. Tres meses naturales completos, y no menos

`core/engine/affordability/affordability-policy.ts`. La cobertura mínima es una **condición de
admisión del documento**, no un informe posterior: un extracto que no la cumple se rechaza con su
propio motivo, distinto del de «no es un extracto».

Tres, porque con uno o dos no existe ninguna forma estadística de separar un ingreso de un cobro
extraordinario. Con tres observaciones ya hay mediana —que ignora el mes raro— y ya hay pendiente
—que distingue «gana 4.000» de «ganaba 6.000 y va cayendo»—, que son las dos preguntas que decide
el módulo. Es además el mínimo que exige la práctica supervisora comparada para verificar ingreso
con datos bancarios, y lo que un banco boliviano entrega sin trámite desde su banca por internet.

`normalizeAffordabilityPolicy` **no deja bajarlo por configuración**. Es la única constante del
archivo que se defiende de quien la configura: todo lo demás son calibraciones, y ésta es la
exigencia que da sentido al módulo.

### 3. La capacidad de pago se calcula DENTRO de la conversión

Y no en un servicio que lea el resultado después, porque entonces sería un análisis opcional que
cualquier consumidor puede saltarse.

Lo que hace, en orden: clasifica cada movimiento por su glosa —con un léxico boliviano, no con un
modelo: son entre cien y quinientos movimientos por documento y esto corre en el camino
caliente—, agrupa por **mes natural**, descarta del ingreso los traspasos entre cuentas propias,
los reversos y los desembolsos de crédito, **rescata por cadencia** el ingreso cuya glosa no lo
identifica —el trabajador por cuenta propia que cobra por transferencia—, y saca las cifras con
estadísticos robustos: mediana y media recortada, y **se toma la menor de las dos**.

El disponible **no** es «ingreso menos gasto observado». Se separa lo comprometido —cuotas,
seguros, servicios básicos, alquiler, efectivo— de lo comprimible, y se ancla en un **piso de
subsistencia**: quien tiene poco ajusta su gasto a lo que tiene, así que un extracto austero
produce un disponible que no existe.

La cuota máxima es el **mínimo de tres topes**: el disponible tensionado con su margen, el tope
de cuota sobre ingreso, y el tope de deuda total sobre ingreso contando lo que la persona ya
paga a otros. Se publica cuál mordió.

## Consecuencias

- **El primer documento de cada proceso ya no acaba en la cola.** El padrón de entidades se
  espera una vez por tenant antes de analizar (`ensureLoaded`). Sin eso, en frío no había
  instantánea, la compuerta de emisor lo tomaba —con razón— como «no pude comprobar la licencia»
  y derivaba a revisión con un motivo que apunta a la entidad. Se curaba solo en el documento
  siguiente, que es lo que lo hacía imposible de diagnosticar.
- **El consumidor deja de leer extractos.** El core de Atlas manda el archivo a este worker y
  aplica lo que concluya. Dos implementaciones de la misma regla acaban discrepando, y el día que
  discrepan nadie sabe cuál decidió.
- **El motivo del rechazo es información del cliente.** Un extracto de un mes, un PDF compuesto
  en un editor y una factura de una telefónica son tres rechazos con tres acciones distintas.
  El detalle técnico —qué herramienta, cuántas revisiones— queda en la traza y **no** viaja al
  cliente: decirle a quien manipuló un extracto qué señal lo delató es enseñarle qué evitar.
- **La evaluación viaja versionada** (`modelVersion`). Una cifra sin versión no se puede comparar
  con otra de hace tres meses: no habría forma de saber si la diferencia la produjo el cliente o
  un cambio en la fórmula.
- **El motor mide; no aprueba.** La evaluación tiene puntaje, banda y motivos. Qué hacer con ella
  lo decide la política de crédito, versionada y auditable. Es la misma frontera que respeta el
  resto del motor.
