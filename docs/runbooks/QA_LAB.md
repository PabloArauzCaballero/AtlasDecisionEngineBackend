# Runbook — QA Lab: corridas generativas y contraejemplos

Cubre §10. Manual de referencia: [`../calculated-fields.md`](../calculated-fields.md) §6.

Dos invariantes que condicionan todo lo demás:

- **PROD está excluido por diseño** (`QA_RUN_PROD_FORBIDDEN`). Una corrida mete miles de
  ejecuciones sintéticas; contra producción contaminaría métricas y datos reales.
- **Una corrida es reproducible o no sirve.** Semilla, mezcla, distribuciones, contrato y
  versiones de herramientas quedan archivados con la corrida. Por eso el generador no usa
  `Math.random` ni Faker en línea: Faker es dependencia de desarrollo y su algoritmo puede
  cambiar entre versiones menores.

---

## Reproducir un contraejemplo

1. `POST /v1/qa-lab/counterexamples/{id}/replay` reejecuta el caso archivado contra la misma
   versión que lo produjo. No regenera nada: usa la entrada guardada.
2. El contraejemplo trae `shrunkInput` (mínimo que sigue fallando) y `replaySeed`/`replayPath`
   para volver a generarlo desde cero si hace falta.
3. Si el replay **pasa** y el original falló, la diferencia está fuera del motor: mirar
   proveedores externos o el runner de scripts, no el generador.

## Una corrida no encuentra nada y se sospecha que no prueba lo que importa

Es el fallo más caro del QA Lab: verde por no haber mirado. Casi siempre es reparto uniforme.

1. Declarar distribuciones por variable (§10.4) en `distributions`:

```jsonc
{
  "caseCount": 500,
  "environmentCode": "TEST",
  "distributions": [
    { "variableCode": "ingreso_mensual", "shape": "LOW_TAIL" },
    { "variableCode": "producto", "valueWeights": { "BNPL": 8, "CONSUMO": 1 } }
  ]
}
```

| Forma | Para qué |
| --- | --- |
| `UNIFORM` | Reparto plano (por defecto) |
| `LOW_TAIL` / `HIGH_TAIL` | Concentrar en la cola baja / alta del rango |
| `CENTERED` | Concentrar cerca del centro |
| `EXTREMES` | Vaciar el centro y castigar los dos umbrales a la vez |

2. Sesgar **no relaja el contrato**: todo valor generado sigue siendo válido. Y una variable
   que no exista entre las entradas se rechaza con `QA_DISTRIBUTION_VARIABLE_UNKNOWN` en vez
   de ignorarse en silencio, que dejaría la corrida verde con un sesgo que nunca ocurrió.
3. Subir el porcentaje de `BOUNDARY` también ayuda: los bordes exactos destapan más que los
   valores medios.

## Una corrida agota su tiempo o carga demasiado el motor

`timeoutMs` acota la corrida completa y `concurrency` cuántos casos corren a la vez.

1. Bajar `concurrency` antes que `caseCount`: el problema suele ser presión instantánea, no
   volumen total.
2. `stopOnFirstFailure: true` para el ciclo corto de diagnóstico.
3. Una corrida que agota el tiempo queda archivada igual, con lo ejecutado hasta ese punto.

## Cambió el generador: ¿siguen valiendo las corridas antiguas?

`GENERATOR_VERSION` se guarda en cada corrida junto a las versiones de herramientas. Al
comparar dos corridas hay que comparar también esa versión: cambiarla puede cambiar qué
valores salen de una misma semilla.

Regla que se respetó al añadir las distribuciones: `UNIFORM` consume exactamente un valor del
flujo pseudoaleatorio, igual que la versión anterior, de modo que **una corrida archivada sin
distribuciones se reproduce idéntica**. Cualquier cambio futuro del generador debe conservar
esa propiedad o subir la versión mayor.

## Verificación

```bash
yarn jest test/qa-lab-generator.spec.ts
```
