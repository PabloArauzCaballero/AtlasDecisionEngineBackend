# Pruebas de rendimiento

## Estado honesto

!!! warning "No hay arnés de carga sostenida"
    No existe hoy una suite tipo k6 o Gatling con umbrales de SLO. Es una **decisión explícita**,
    no un olvido: ese arnés es una pieza de infraestructura aparte, con su propio ambiente y su
    propio presupuesto, y montarlo a medias produce números que nadie se cree.

    Está registrado en el [análisis de brechas](../reports/documentation-gap-analysis.md).

## Lo que sí se mide hoy

| Qué | Cómo | Dónde |
| --- | --- | --- |
| Concurrencia del sidecar | Cuatro ejecuciones simultáneas frente a una | `test/sidecar-concurrency.spec.ts` |
| Cotas de memoria del sandbox | Un script desbocado muere solo, sin llevarse el contenedor | `sidecar-sandbox-escape.spec.ts` |
| Presupuesto de cadena | Artefactos, tiempo, tamaño y memoria retenida | `chain-budget.spec.ts` |
| Latencia en producción | Histograma con p95/p99 reales | `atlas_http_request_duration_ms` |
| Carga acotada del QA Lab | Lotes concurrentes con timeout | Módulo QA Lab |

## Evidencia medida, no estimada

- **Cota de memoria de Python**: con `RLIMIT_AS` a 32 MiB, `list(range(60_000_000))` muere con `MemoryError` y **solo** ese script falla. Sin la cota, el kernel responde `Killed` tras agotar el contenedor entero. A 32 MiB un script normal corre igual (probado hasta 16 MiB).
- **Concurrencia del sidecar**: antes ejecutaba con `spawnSync`, que bloquea el servidor de un solo hilo durante todo el script — la concurrencia real era 1 y un script en su techo de 5 s retenía a los demás tenants.
- **Índice de keyset**: `EXPLAIN` mostraba un recorrido inverso de la clave primaria descartando 42 filas para devolver 26; con el índice, cero filas descartadas.

## Pruebas sensibles al reloj

`sidecar-concurrency.spec.ts` compara tiempos de pared con ~5 % de margen. Pasa aislada y falla
ocasionalmente con la suite completa.

Es un aviso general: una aserción de duración mide también la carga de la máquina. Antes de
poner una en un gate bloqueante, conviértala en una comparación relativa robusta o sáquela del
gate.

## Si hace falta montar el arnés

1. Ambiente dedicado con datos representativos.
2. Perfiles: decisión en línea, lote de QA, consulta de auditoría.
3. Umbrales de los [objetivos de servicio](../observability/service-level-objectives.md).
4. Medir **con** los proveedores externos y sin ellos: su latencia domina el p99.
5. Vigilar el pool de conexiones: suele ser el techo antes que la CPU.
