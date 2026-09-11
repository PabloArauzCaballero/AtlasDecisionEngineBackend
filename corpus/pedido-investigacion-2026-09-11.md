# Pedido de investigación profunda — Atlas, workers de documentos (2026-09-11)

Este documento es para pasárselo a un sistema de investigación profunda. Está escrito para que
**no rehaga lo ya verificado** y para que lo que devuelva entre en `corpus/` sin tocarse a mano.

---

## 0. Reglas que la respuesta DEBE cumplir (no negociables)

1. **`null` significa NO VERIFICADO.** Nunca cero, nunca falso, nunca «no aplica». Si un dato no se
   pudo comprobar, va `null` y su motivo en `reason_unresolved`.
2. **Cada dato lleva su procedencia**: campo `sources` con URL, título, fecha de publicación y fecha
   de consulta. Un dato sin fuente se descarta entero.
3. **Cada dato lleva su clasificación**: `VERIFICADO` (documento oficial a la vista),
   `INFERIDO` (deducido de fuentes secundarias, con el razonamiento escrito) o
   `NO_VERIFICADO`.
4. **Nada de umbrales inventados.** Si el pedido es un umbral y no hay población medida detrás,
   la respuesta correcta es `null` + `reason_unresolved`, no un número plausible.
5. **Prohibido afirmar** lo que el corpus anterior ya prohíbe: «ratio ASFI vigente certificado»,
   «pesos de fraude calibrados», «umbral de capacidad validado con mora», «calibración de
   producción».
6. **Un solo JSON por paquete**, UTF-8, con `manifest` al principio (nombre, versión,
   `evidence_cutoff`, `status`, `gaps`, `contradictions`, `prohibited_claims`).
7. **Sin imágenes de documentos reales** y sin datos personales de nadie.

---

## 1. Lo que el corpus anterior YA resolvió (no volver a pedirlo)

Medido en el motor, no estimado:

| Qué | Resultado medido |
|---|---|
| Cola humana de identidad, sobre 23 cédulas bolivianas auténticas | bajó del **48 % al 9 %** |
| Expedientes completos | 17/23 antes y 17/23 después (no se perdió ninguno) |
| Acusaciones falsas sobre documentos auténticos | **0** |
| Controles de MRZ marcados «fallidos» | de **6/23 a 0/23** |
| Glosario oficial del BCP contra un extracto real de 112 movimientos | casan **75** |
| ITF abrogado (Ley 1717, 10-04-2026) sin marcar falso ningún extracto auténtico | resuelto |

Y quedó fijado en código: los tres estados de los controles de MRZ (`true/false/null`), la
alineación de la MRZ elegida por norma (cabecera `[ACI]` + emisor alfa-3), el suelo de legibilidad
de 1.000 px de lado largo, el catálogo tolerante de rótulos (la cobertura techo de una cédula REAL
es ~0,69, no 1), y que un umbral sin calibrar escala en vez de rechazar.

**No hace falta** volver a investigar: padrón ASFI en su versión publicada, las 147 glosas del BCP,
la abrogación del ITF, la especificación MRZ TD1, ni el catálogo de rótulos de la cédula PRE_2023.

---

## 2. Lo que NINGUNA investigación puede resolver (no pedirlo)

Estos huecos necesitan **datos propios**, no documentos públicos. Si la respuesta trae números
aquí, son inventados:

- **Umbral de similitud facial** (`identidad G01`). Hoy hay 1 pareja genuina medida y 21 impostoras.
  Medido: impostor máximo 0,5584, genuina 0,6392, margen 0,0808 — pero 0 falsas aceptaciones de 21
  es un techo del **13,3 %** al 95 %, y 1 acierto de 1 da un intervalo de 2,5 % a 100 %. Para
  prometer FMR 1e-3 hacen falta **2.995** parejas impostoras sin un fallo. Lo que falta son
  **selfies consentidas de las personas cuyos carnets ya existen**, no bibliografía.
- **Calibración del PAD / prueba de vida** (`identidad G02`, `G11`): necesita población de ataques.
- **Los ocho parámetros de capacidad de pago** (`extractos G15`) y los coeficientes/AUC
  (`G16`): necesitan cartera con **mora observada**. Atlas hoy tiene 2 préstamos reales.
- **Tasas de detección de fraude documental por familia de alteración** (`extractos G18`, `G19`,
  `G20`): necesitan PDF bancarios originales y alterados.

---

## 3. PEDIDO, en orden de impacto medido

### PRIORIDAD 1 — Glosas oficiales de los emisores que no son BCP (`extractos G10`)

**Por qué primero:** es el único hueco con impacto ya medido. El glosario oficial del BCP casa 75 de
112 movimientos de un extracto real; sobre los otros cinco bancos casa **cero**, y cada glosa que no
se reconoce es dinero que el cálculo de capacidad de pago coloca mal.

Emisores por orden de interés: **BNB, Banco Mercantil Santa Cruz, Banco Unión, Banco Ganadero, Banco
Económico, Banco Sol, Banco Fassil (si aplica), Banco Fortaleza, Banco Prodem**, más billeteras
(**Tigo Money — operado por E-FECTIVO ESPM**, Yolo Pago, Billetera Móvil).

Para **cada glosa**:

```json
{
  "issuer_code": "BNB",
  "literal": "CENT_PAGO_PREST",
  "meaning": "Pago de préstamo debitado en centralizado",
  "accounting_side": "DEBIT | CREDIT | BOTH | null",
  "income_relevance": "NEVER | CANDIDATE_PAYROLL | NEUTRAL",
  "is_tax": false,
  "is_fee": false,
  "is_internal_transfer": false,
  "classification": "VERIFICADO | INFERIDO | NO_VERIFICADO",
  "sources": [{ "url": "...", "title": "...", "published": "2025-11-02", "retrieved": "2026-09-12" }]
}
```

Reglas de esta sección: **la columna contable manda sobre la glosa** (si el extracto dice otra cosa,
gana el extracto y se declara la discrepancia); una glosa puede **QUITAR** el reconocimiento de
ingreso pero **nunca darlo**, salvo las marcadas `CANDIDATE_PAYROLL`; y **un prefijo no basta** —
`TRANSFERENCIA` casando el principio de «Transferencia QR BM QR Restotech» hundía la capacidad de
todo comerciante que cobra por QR.

### PRIORIDAD 2 — Ficha de formato por emisor (`extractos G09`, `G05`, `G11`, `G12`)

**Estado real hoy: 67 fichas y CERO plantillas verificadas.** Todos los campos de posición y formato
están en `null`. Ese vacío es deliberado (no se inventan), y es lo que impide leer bien las columnas.

Rellenar, por emisor, exactamente esta forma (es la que el código ya consume):

```json
{
  "code": "BNB",
  "name": "Banco Nacional de Bolivia S.A.",
  "channels": ["WEB", "APP", "VENTANILLA"],
  "pdfProducer": "iText 7.1.15 | null",
  "header": ["texto literal de la carátula, línea a línea"],
  "columns": ["FECHA", "GLOSA", "DEBITO", "CREDITO", "SALDO"],
  "dateFormat": "DD/MM/YYYY",
  "amountFormat": { "thousands": ".", "decimal": ",", "negative": "PARENTHESES | MINUS_PREFIX | SEPARATE_COLUMN" },
  "debitCreditStyle": "TWO_COLUMNS | SIGNED_SINGLE_COLUMN",
  "pdfTextOrImage": "TEXT | IMAGE | MIXED",
  "pdfProtection": "NONE | OWNER_PASSWORD | ...",
  "accountNumberFormat": "10 dígitos, sin guiones",
  "interbankAccountCode": "estructura CCI si existe",
  "verification": { "kind": "QR | CODIGO | NINGUNA", "detail": "qué se puede comprobar y contra qué" },
  "classification": "VERIFICADO | INFERIDO | NO_VERIFICADO",
  "sources": [...]
}
```

### PRIORIDAD 3 — El QR de la cédula boliviana (`identidad G07`)

**Por qué importa tanto:** si el QR de la cédula se puede verificar criptográficamente, la
autenticidad del documento deja de depender de umbrales y heurísticas. Es el único hueco de
identidad que podría cambiar la arquitectura de la decisión.

Pedido: esquema del *payload*, codificación, algoritmo de firma, **claves públicas de verificación**
y su publicación oficial, versiones del formato por generación de carnet, y qué campos van dentro.
Si no existe firma verificable públicamente, decirlo con esa claridad: `"verifiable": false` +
fuente.

### PRIORIDAD 4 — Caducidad indefinida y el centinela 2049 (`identidad G06`)

`DOCUMENT_EXPIRED` es un **rechazo incondicional**: una regla mal puesta aquí rechaza a personas
legítimas. Hace falta la norma exacta sobre cédulas de vigencia indefinida, qué fecha imprimen esos
carnets, y si `2049-12-31` (u otra) actúa como centinela de «no caduca».

### PRIORIDAD 5 — Geografía y rótulos del SEGIP (`identidad G05`, `G03`, `G04`)

Defecto visible hoy: en una cédula auténtica el lugar de nacimiento se publica como
`"SANTA CRUZ - ANDRES IBAÑEZ - SANTA”"` — truncado y con una comilla de basura.

Pedido: lista oficial de **departamentos, provincias y municipios** con sus **abreviaturas
oficiales** tal como el SEGIP las imprime; rótulos exhaustivos por variante de la generación
anterior y de la 2023+; y la **gramática completa del número de cédula y su complemento**
(longitudes, alfabeto del complemento, guiones).

### PRIORIDAD 6 — Matriz de confusiones de Tesseract (`identidad G09`, `G10`)

Pedido: confusiones carácter a carácter con frecuencia, para `spa`, versión 5.x, sobre texto pequeño
impreso a 300 ppp y sobre 600/900/1200/1600 px de lado largo, y el efecto cuantificado de cada
preprocesamiento (binarizado, deskew, upscaling). Esto permite **corregir** el OCR en vez de
tolerarlo.

### PRIORIDAD 7 — Impuestos, tarifas y tope de tasa (`extractos G06`, `G08`, `G13`)

- Alícuotas **históricas** del ITF con vigencias, y RC-IVA/IUE sobre intereses de cuentas.
- **Tope de tasa vigente de ASFI para crédito de consumo**, del texto consolidado (el acceso falló:
  quedaron 15 %/25 % de normas secundarias, que no sirven para decidir).
- **Piso de subsistencia 2026 por hogar y ciudad** (canasta del INE). Hoy sólo está verificado el
  salario mínimo, 3.300 Bs, y **un salario no es una canasta**.

### PRIORIDAD 8 — Productores de PDF legítimos por emisor (`extractos G20`)

Lista de cadenas `pdfProducer`/`Creator` que los bancos bolivianos emiten de verdad. Hoy el puntaje
de seguridad castiga o acredita sin una lista verificada, y eso produce falsos positivos sobre
documentos auténticos.

### PRIORIDAD 9 — Catálogo literal de los otros documentos (`identidad G18`)

Pasaporte boliviano, licencia de conducir, carnet de extranjería: rótulos, zonas, MRZ y reglas.
Hoy sólo la cédula tiene analizador verificado y el resto se rechaza **con ese motivo**, que es
correcto pero limita el flujo.

---

## 4. Forma de entrega

Dos archivos, uno por dominio, para que entren junto a los actuales:

- `corpus-extractos-bo-v2.json` → prioridades 1, 2, 7, 8
- `corpus-identidad-bo-v2.json` → prioridades 3, 4, 5, 6, 9

Cada uno con:

```json
{
  "manifest": {
    "name": "...", "version": "2.0.0", "language": "es-BO",
    "evidence_cutoff_requested": "2026-09-12",
    "retrieved_utc_date": "2026-09-12",
    "status": "PARTIAL_PUBLIC_EVIDENCE_WITH_EXPLICIT_GAPS",
    "contains_calibrated_credit_policy": false,
    "not_a_production_calibration": true,
    "prohibited_claims": ["..."]
  },
  "sources": [ { "id": "S01", "url": "...", "title": "...", "published": "...", "retrieved": "..." } ],
  "modules": { "...": { "records": [ ... ] } },
  "gaps": [ { "id": "G01", "requirement": "...", "status": "UNRESOLVED", "reason_unresolved": "..." } ],
  "contradictions": [ { "id": "C01", "statement_a": "...", "statement_b": "...", "resolution": "..." } ]
}
```

Al recibirlos: `yarn corpus:generar` los convierte en TypeScript tipado, `yarn corpus:check` exige
que lo generado coincida, y cada catálogo queda sellado con el SHA-256 del corpus del que salió.
