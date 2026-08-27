# Verificación del expediente del comercio (KYB)

Artefacto `PARTNER_KYB_REVIEW`. Decide si un comercio puede empezar a operar: aprueba el
expediente completo y sin señales, manda a revisión manual el que exige criterio humano, y
rechaza el que no cubre los requisitos que impiden cobrar.

## Por qué existe

El expediente del comercio ya sabía decir qué le faltaba —matrícula, representante con su poder,
sucursal, los dos QR—, pero esa lista vivía dentro del backend de altas y no se ejecutaba en
ninguna parte. No había artefacto, así que no había versión, ni traza, ni ejecución que enseñar,
ni forma de mover un umbral sin tocar código. Decidir si un comercio puede cobrar dinero de sus
clientes es exactamente la clase de decisión que este motor existe para gobernar.

## Lo que decide, y lo que no

| Desenlace | Cuándo | Motivo publicado |
| --- | --- | --- |
| `RECHAZADO` | Falta al menos un requisito duro | `KYB_REQUISITOS_INCOMPLETOS` |
| `REVISION_MANUAL` | Completo, pero con señales operativas | `KYB_SENALES_OPERATIVAS` |
| `APROBADO` | Completo y sin señales | `KYB_COMPLETO` |

**No aprueba lo que exige criterio humano.** Un expediente completo con el correo sin verificar,
sin ninguna sucursal declarada o abierto hace demasiado tiempo sale a `REVISION_MANUAL`: la
aprobación de un comercio la firma una persona, y lo que el artefacto aporta es decirle a esa
persona qué mirar y por qué.

## Entradas

Son booleanas a propósito y no «el documento» en sí: lo que el motor decide es si el requisito
está cubierto. Quién guarda la evidencia —con su hash y su trazabilidad— es el expediente en
AtlasBackend. Copiar aquí el número de matrícula o la cuenta bancaria sería duplicar datos
personales del comercio en un segundo sitio para no usarlos.

| Variable | Tipo | Qué significa |
| --- | --- | --- |
| `kyb_tiene_matricula` | BOOLEAN | La empresa declaró su matrícula de comercio |
| `kyb_representante_acreditado` | BOOLEAN | Hay representante **y** su poder está subido |
| `kyb_qr_negocio` | BOOLEAN | QR del negocio registrado |
| `kyb_qr_bancario` | BOOLEAN | QR de cobro registrado: a qué cuenta va el dinero |
| `kyb_correo_verificado` | BOOLEAN | El correo del expediente respondió al código |
| `kyb_sucursales` | INTEGER | Cuántos locales declaró |
| `kyb_antiguedad_dias` | INTEGER | Días desde que se abrió el expediente |

## Las dos reglas que lo hacen útil

1. **Los requisitos duros no se compensan.** Los cuatro primeros se suman en la intermedia
   `requisitos_faltantes`, y cualquiera que falte rechaza — por impecable que esté todo lo demás.
   Sin esta regla, un expediente perfecto salvo el QR bancario podría aprobarse: habilitar a
   cobrar a un comercio que no ha dicho a qué cuenta va el dinero.
2. **Las señales nunca aprueban solas.** `senales_operativas` cuenta el correo sin verificar, la
   ausencia de sucursales y la antigüedad por encima de 120 días. No bloquean, pero desvían a una
   persona.

El umbral de antigüedad (120 días) es lo primero que hay que recalibrar con expedientes reales:
está en `DIAS_PARA_CONSIDERAR_ANTIGUO`, en el grafo.

## Dónde vive

- Grafo y casos esperados: `src/modules/seeding/data/partner-kyb.graph.ts` (función pura).
- Siembra: `src/modules/seeding/data/partner-kyb.seed.ts`, llamada desde `seed-runner.ts`.
- Prueba que lo ejecuta con el motor real: `test/partner-kyb-seed.spec.ts`.

Los desenlaces esperados **no** están escritos a ojo: la prueba los ejecuta contra el motor y
falla si difieren. Un seeder que afirma «este expediente se aprueba» y un motor que lo rechaza es
peor que no tener el artefacto, porque la demostración enseña una decisión que en producción no
ocurre.

## Sembrarlo o rehacerlo

```bash
npx ts-node --transpile-only prisma/dev-seeds/seed-partner-kyb.ts [--force]
```

Deja el artefacto **ejecutable**, no sólo sembrado: escribe el despliegue y el binding de runtime
en DEV y TEST. Hacen falta las dos filas — el motor resuelve por `decision_runtime_binding`, así
que un despliegue sin binding le es invisible y la ejecución falla con
`ACTIVE_DEPLOYMENT_NOT_FOUND`.

## Ejecutarlo

```bash
curl -X POST http://127.0.0.1:3020/v1/decisions/PARTNER_KYB_REVIEW \
  -H "x-api-key: $RUNTIME_API_KEY" -H 'Content-Type: application/json' \
  -d '{"requestId":"kyb-expediente-7","idempotencyKey":"kyb-7-1","environmentCode":"DEV",
       "subjectReference":"partner-7",
       "variables":{"kyb_tiene_matricula":false,"kyb_representante_acreditado":false,
                    "kyb_qr_negocio":false,"kyb_qr_bancario":true,"kyb_correo_verificado":true,
                    "kyb_sucursales":1,"kyb_antiguedad_dias":20}}'
```

La ejecución queda en el portal (Ejecuciones) con su traza paso a paso, y desde ahí se descarga
como informe PDF.
