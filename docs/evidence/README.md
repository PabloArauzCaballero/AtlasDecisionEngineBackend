# Evidencia de corridas contra el motor desplegado

Salidas REALES del motor, capturadas contra la instalación local con la API de gestión. No son
fixtures ni maquetas: cada fila es lo que respondió `GET /v1/workers/bank-statement/runs/{id}` tras
encolar el escenario correspondiente.

Existen porque una prueba en verde demuestra que el código hace lo que su prueba dice, y no que el
sistema desplegado —con su base, su padrón administrado y su worker— llegue al mismo desenlace. Son
dos afirmaciones distintas, y la segunda es la que se enseña.

## `2026-08-26-admision-y-capacidad.json`

Los ocho escenarios del worker de extractos, con el veredicto de las tres compuertas de admisión y
la evaluación de capacidad de pago. Reproducir:

```bash
docker compose -f docker-compose.yml -f docker-compose.no-gvisor.yml up -d api worker
node scripts/… # o: encolar cada fixtureCode y sondear la ejecución
```

Lo que la corrida demuestra, escenario a escenario:

| Escenario | Desenlace | Qué demuestra |
|---|---|---|
| `valid-basic` | `SUCCEEDED_WITH_WARNINGS`, banda `SOLIDA` | Tres meses completos, ingreso reconocido sobre la mediana y cuota máxima limitada por el tope de política. |
| `valid-complete` | `SUCCEEDED_WITH_WARNINGS`, banda `SOLIDA` | Los traspasos entre cuentas propias NO cuentan como ingreso; el cobro por QR sí, rescatado por cadencia. |
| `strained-capacity` | `SUCCEEDED_WITH_WARNINGS`, banda `INSUFICIENTE` | Aceptar no es aprobar: documento legítimo, cuota máxima cero y ocho motivos con su evidencia. |
| `boundary-case` | `SUCCEEDED_WITH_WARNINGS` | Una cooperativa sin analizador propio se procesa igual, con advertencias. |
| `short-period` | `PDF_INVALID` · `INSUFFICIENT_PERIOD` | Un extracto impecable de UN mes se rechaza por periodo, con un motivo accionable. |
| `tampered-document` | `PDF_INVALID` · `TAMPERED_DOCUMENT` | Mismo contenido que el camino feliz, rechazado por su CONTENEDOR. |
| `foreign-issuer` | `PDF_INVALID` · `NOT_BANK_STATEMENT` | El estado de cuenta de una telefónica, rechazado por su emisor. |
| `invalid-example` | `PDF_INVALID` · `NOT_BANK_STATEMENT` | Un PDF que no es un estado de cuenta, rechazado por el clasificador. |
