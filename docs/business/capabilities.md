# Capacidades

Cada capacidad indica dónde vive en el código y qué la respalda.

## 1. Catálogo gobernado de variables

Una variable tiene contrato: tipo, nulabilidad, restricciones configurables, mensaje de
validación, ejemplos válido e inválido, origen esperado y clasificación de sensibilidad. Cada
versión es **inmutable**; publicar una nueva exige comprobación de compatibilidad.

- Módulo: [`variables`](../modules/variables.md) · Contratos: `src/common/contracts/`
- Manual: `docs/variable-contracts.md`

## 2. Variables intermedias con ámbito de ejecución

Existen solo durante una ejecución y desaparecen al terminar o fallar. No cuelgan del catálogo
global: reutilizarlas entre ejecuciones rompería el aislamiento. Se referencian como
`intermediate.<code>` y la traza dice **en qué paso se creó** cada una.

## 3. Contrato de salida explícito

La respuesta **no se infiere del último nodo**. Un campo que no está declarado en el contrato
de salida no se publica, aunque algún nodo lo haya calculado.

## 4. Campos calculados y librerías autorizadas

Funciones pequeñas, gobernadas y reutilizables, con contrato de retorno obligatorio y un
guardián de código (máximo 3 líneas ejecutables, sin bucles ni funciones anidadas). Una fila
del registro de librerías solo puede **habilitar** un prelude ya revisado en el repositorio;
nunca aportar código.

## 5. Diseño, validación y compilación de algoritmos

Grafo con nodos de condición, expresión, tabla de decisión, score, acción, resultado y revisión
manual. La validación cubre estructura, expresiones, determinismo, contrato de salida y
dominancia de las intermedias. Compilar produce un artefacto inmutable con checksum.

## 6. Importación de código a flujo

Convierte código existente en un grafo revisable. El análisis de sintaxis **nunca ejecuta** el
código: JavaScript se compila con `vm.Script` (que no lo corre) y Python se analiza con
`ast.parse` en un subproceso desechable.

## 7. Encadenamiento entre algoritmos

Un artefacto puede invocar a otro con presupuesto acotado: número de artefactos, tiempo total,
tiempo por salto, tamaño de cada resultado y **memoria acumulada retenida**. Los ciclos se
detectan antes de ejecutar.

## 8. Pruebas deterministas y QA Lab

Suites de regresión por versión con cobertura de nodos, aristas y rutas; y generación masiva
guiada por contrato, reproducible por semilla, con distribución configurable por variable y
reducción de contraejemplos.

## 9. Gobierno, aprobaciones y despliegue

Flujo de estados con segregación de funciones, aprobaciones mínimas configurables, despliegue
por ambiente y reversión a una versión anterior.

## 10. Ejecución en línea idempotente

Una clave de idempotencia con lease corto: un titular que muere libera la clave en segundos en
vez de bloquearla el TTL completo. La evidencia se persiste en la misma transacción.

## 11. Simulación y comparación DEV/PROD

Ejecuta sin persistir nada y, opcionalmente, corre las **mismas entradas ya resueltas** contra
el artefacto activo en PROD para medir la divergencia.

## 12. Auditoría, explicabilidad y observabilidad

Cadena append-only encadenada por hash con rotación de clave; métricas Prometheus; trazas
OpenTelemetry; bandeja de notificaciones alimentada por un outbox transaccional.

Detalle por módulo: [índice de módulos](../modules/index.md).
