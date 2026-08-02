# Datos de prueba

## Tres orígenes

| Origen | Para qué | Determinista |
| --- | --- | --- |
| Semillas BOOTSTRAP/MOCKUP | Escenario completo y demostrable | Sí, idempotente |
| Generador del QA Lab | Lotes masivos guiados por contrato | Sí, por semilla |
| Fixtures de las suites | Casos concretos | Sí |

## Reproducibilidad del generador

El QA Lab **no** usa `Math.random` ni Faker en línea:

- `Math.random` no lo controla el proceso: una corrida no se podría repetir.
- Faker es dependencia **de desarrollo** y su algoritmo puede cambiar entre versiones menores, lo que rompería una corrida archivada.

Se usa Mulberry32 congelado en el repositorio, versionado con `GENERATOR_VERSION`. Cada corrida
archiva semilla, configuración, distribuciones, versión del generador, versiones de las
herramientas y **una copia congelada del contrato**.

!!! important "Regla al tocar el generador"
    `UNIFORM` consume exactamente un valor del flujo pseudoaleatorio, igual que antes de existir
    las distribuciones. Por eso una corrida archivada **sin** distribuciones se reproduce bit a
    bit. Cualquier cambio futuro debe conservar esa propiedad o subir la versión mayor.

## Datos sintéticos, no reales

Los datos de prueba se generan; **nunca** se copian de producción. Copiar produciría datos
personales reales en un ambiente con menos controles, en registros y en respaldos.

Faker sí se usa en las pruebas del repositorio para lotes sintéticos, con semilla fija.

## Bases de larga vida

Dos reglas aprendidas a base de fallos intermitentes:

1. **Identificadores de tenant únicos por corrida** donde se escriba auditoría: es append-only y no se puede limpiar, así que una corrida reverificaba los restos de la anterior.
2. **No asuma «la primera página»**: filtre por código.

## Limpieza

| Datos | Se pueden borrar |
| --- | --- |
| Artefactos, versiones, grafos de prueba | Sí, en orden de dependencias |
| Ejecuciones y su evidencia | Sí (cascada desde la ejecución) |
| Idempotencia | Sí |
| **Auditoría** | **No** — permisos revocados por diseño |

Las e2e limpian en un `globalTeardown` común. Por-especificación dejaba restos cuando una suite
fallaba a mitad.

## Valores de prueba para el simulador

`POST /v1/simulations/{artifactCode}/sample-inputs` reutiliza el generador del QA Lab **sin
ejecutar ni persistir**: resuelve el contrato del ambiente, admite `VALID`/`BOUNDARY`/`INVALID`,
de 1 a 50 casos y semilla reproducible. PROD se rechaza.

Es la forma correcta de obtener una entrada válida para probar a mano: sale del contrato real,
no de un ejemplo copiado que envejece.
