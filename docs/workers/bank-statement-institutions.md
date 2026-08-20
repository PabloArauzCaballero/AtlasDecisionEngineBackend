# El padrón de entidades y la compuerta de emisor

El worker de extractos sabía responder «¿esto es un estado de cuenta?». No sabía responder
la otra mitad: **«¿de quién es?»**. Este documento describe la compuerta que la responde y
el padrón administrable contra el que lo hace.

Complemento de [Triage de extractos y revisión humana](bank-statement-triage.md): aquél
separa procesar, preguntar y rechazar según la FORMA del documento; éste añade la pregunta
por su EMISOR.

## El agujero, medido

La factura mensual de una telefónica se titula «Estado de Cuenta», imprime número de
cuenta, saldo, una columna de importes y una tabla de consumos con fecha. En el
clasificador suma **1.00 sobre 1.00** —el máximo— y **ninguna de esas señales es falsa**:
de verdad es el estado de una cuenta. Lo único que la distingue de un extracto bancario es
quién la manda.

La pregunta por el emisor existía, pero sólo se hacía dentro de la ruta de error, cuando
NINGUNA estrategia aceptaba el documento. El motor generalista acepta cualquier cosa con una
tabla de fechas e importes, así que en la práctica no se hacía nunca: el documento ajeno no
se rechazaba, se convertía en movimientos.

## Los cuatro veredictos

`core/engine/issuer-gate.ts`, evaluado **antes** de la cascada de analizadores.

| Veredicto      | Qué significa                                                   | Desenlace | Código                    |
| -------------- | --------------------------------------------------------------- | --------- | ------------------------- |
| `LICENSED`     | Se atribuye a una entidad con licencia de ASFI                    | procesar  | —                         |
| `UNLICENSED`   | Entidad del padrón cuya licencia no está vigente                  | revisión  | `UNLICENSED_INSTITUTION`  |
| `NON_BANKING`  | Lo emitió una telefónica, una aseguradora, un banco extranjero…   | rechazo   | `NON_BANKING_ISSUER`      |
| `UNATTRIBUTED` | No se pudo atribuir · con señales financieras → revisión          | revisión  | `UNSUPPORTED_INSTITUTION` |
| `UNATTRIBUTED` | No se pudo atribuir · sin ninguna señal financiera → rechazo      | rechazo   | `UNRECOGNIZED_ISSUER`     |

Tres decisiones que no son obvias:

- **La entidad intervenida va a una persona, no al rechazo.** El documento es auténtico y
  su historial es cierto; lo que hace falta es que alguien decida qué peso darle sabiendo
  que la entidad ya no opera, y eso no lo puede resolver quien subió el archivo.
- **El emisor no financiero se cierra sin preguntar.** Es el único veredicto apoyado en
  evidencia POSITIVA de lo contrario: la carátula nombra a quien lo emitió. Mandarlo a una
  persona sería pedirle que confirme lo que el documento dice de sí mismo.
- **Lo no atribuido se parte en dos.** Con alguna señal financiera —el aviso de supervisión
  de ASFI, un dominio bancario, el seguro de depósitos— es probablemente una entidad
  pequeña cuya carátula no imprime su nombre, y eso lo mira alguien. Sin ninguna, no hay
  nada que mirar.

La clasificación manda sobre el emisor: si el documento además falla la compuerta de forma,
el error es `NOT_A_FINANCIAL_STATEMENT` o `DOUBTFUL_DOCUMENT`. «No es un estado de cuenta»
dice más —y es más accionable— que «no reconozco a su emisor».

## Los contraindicadores decisivos del clasificador

`core/engine/document-classifier.ts` gana además una salida temprana. La penalización de
0.35 está bien calibrada para el documento AMBIGUO, y no alcanza para el que suma todas las
señales legítimas a la vez. Lo que la cierra no son palabras que «suenan» a otra cosa, sino
marcas que sólo existen en ese otro documento:

| Tipo           | Marca                                                                |
| -------------- | -------------------------------------------------------------------- |
| `TAX_INVOICE`  | código de control, número de autorización, la leyenda de la Ley 453  |
| `CONTRACT`     | cláusula numerada, testimonio notarial, minuta                        |
| `RESUME`       | hoja de vida, currículum vitae                                        |
| `PAYROLL_SLIP` | boleta de pago, planilla de sueldos, aportes patronales                |

Ningún banco los imprime en un extracto, así que encontrarlos **en la carátula** no es
evidencia en contra: es la respuesta. El veredicto es `REJECT` con confianza 0, sin puntuar.
Se buscan sólo en la carátula porque un extracto real menciona facturas en las glosas de sus
movimientos, y esa palabra describe EL MOVIMIENTO.

## El padrón

La nómina oficial de ASFI al 30 de abril de 2026: 11 bancos múltiples, 2 bancos PYME, 2
entidades del Estado, 3 entidades financieras de vivienda, 41 cooperativas de ahorro y
crédito y 8 instituciones financieras de desarrollo, más las que perdieron la licencia y
siguen apareciendo en documentos reales. Los códigos son las **siglas de ASFI**, así que
`institution_id` de una ejecución se cruza con cualquier reporte del regulador sin una tabla
de traducción.

Antes eran veinte nombres compilados. Las entidades que faltaban caían en «entidad
desconocida», que es la misma respuesta que recibe una factura: un extracto legítimo de una
cooperativa era indistinguible de un documento ajeno.

- **Semilla:** `core/institutions/bolivia-institutions.ts`. Es lo que usa el motor embebido,
  las pruebas y el arranque en frío.
- **Fuente de verdad en ejecución:** la tabla `decision_financial_institution`, sembrada
  desde esa semilla y administrada desde el portal. Es una tabla y no una constante porque
  una licencia se revoca por resolución de ASFI: esperar a un despliegue para dejar de
  procesar los documentos de una entidad intervenida sería exactamente el fallo que la
  compuerta existe para impedir.
- **Caché:** `InstitutionCatalogService` mantiene una instantánea por tenant con 60 s de
  vida. Una instantánea vencida no bloquea al documento que llega: se sirve la anterior y se
  pide la nueva. Toda escritura del CRUD la invalida.
- **Un padrón vacío nunca se toma en serio.** `resolvedRegistry` cae a la nómina compilada:
  una tabla vacía no es una afirmación sobre el sistema financiero boliviano, es un fallo de
  carga, y tomárselo al pie de la letra rechazaría todos los extractos a la vez.

### Marcadores y exclusiones

Un marcador es lo que, impreso en la carátula, atribuye el documento a la entidad. Una
exclusión ANULA la atribución aunque un marcador coincida, y existe por un falso positivo
real del grupo financiero: la póliza de «BISA Seguros y Reaseguros S.A.» lleva la palabra
BISA en la carátula y se atribuía al Banco BISA. El apellido de la filial es lo único que las
distingue. Lo mismo separa al Banco de Crédito de Bolivia del BCP del Perú.

Se guardan como fuente de expresión regular y se compilan sin distinguir mayúsculas. Se
validan al escribir y **otra vez al leer** —longitud, compilación y `safe-regex`—: un patrón
catastrófico en el padrón se ejecuta contra la carátula de cada documento que entra. Un
patrón roto se descarta y la entidad sigue; dejarla caer entera haría que sus extractos
pasaran a rechazarse.

### El catálogo de lo que NO es

`core/institutions/non-banking-issuers.ts` enumera a quien más imprime un papel titulado
«estado de cuenta»: telefónicas, cooperativas de servicios, distribuidoras de electricidad y
agua, AFP, aseguradoras, participantes del mercado de valores, banca extranjera y
billeteras. Convierte una ausencia de evidencia en evidencia.

Las cooperativas de servicios son la trampa fina del dominio: CRE, SAGUAPAC y COTAS se
llaman «Cooperativa … R.L.» igual que las 41 cooperativas de ahorro y crédito del padrón, así
que una regla que mirara sólo la palabra «cooperativa» las daría por financieras.

## Administración

`v1/workers/bank-statement/institutions` — listar, crear, actualizar, dar de baja, reactivar
y sembrar la nómina que falte. Escribir exige `RISK_ANALYST` o `FRAUD_ANALYST`, los mismos
que gobiernan los artefactos de decisión; leer lo puede hacer también quien opera, porque la
pantalla de extractos necesita el padrón para explicar por qué se rechazó un documento.

La baja es lógica: la fila no se borra porque las ejecuciones ya hechas citan el código con
el que se atribuyó el documento. La siembra sólo CREA lo que falta y nunca pisa una entidad
existente — quien administra el padrón añade la marca nueva de un banco porque la vio en un
extracto que llegó ayer, y una resiembra que la borrara convertiría el mantenimiento en
trabajo que se deshace solo.

En el portal vive dentro del propio worker, pestaña **Entidades financieras**, por el mismo
criterio que el árbol de categorías: es donde se descubre que hace falta.

## Configuración

| Variable                                 | Por omisión | Qué hace                                                        |
| ---------------------------------------- | ----------- | --------------------------------------------------------------- |
| `BANK_STATEMENT_REQUIRE_LICENSED_ISSUER` | `true`      | Exige que el documento se atribuya a una entidad con licencia    |

Con `false` la compuerta sigue evaluando y dejando constancia del veredicto real, pero no
rechaza. Existe porque encender una exigencia nueva sobre un motor en marcha rechaza
documentos que ayer pasaban, y esa decisión es de quien opera el sistema: permite medir
cuánto rechazaría antes de dejar que rechace.
