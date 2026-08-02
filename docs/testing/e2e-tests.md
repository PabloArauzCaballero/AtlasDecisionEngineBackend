# Pruebas extremo a extremo

```bash
yarn test:e2e    # test/jest-e2e.json — requiere PostgreSQL y Redis
```

## Estado real

```
Test Suites: 13 passed, 13 total
Tests:       67 passed, 67 total
[e2e teardown] 10 artefactos de prueba eliminados
```

## Qué cubren

| Suite | Flujo |
| --- | --- |
| `artifact-lifecycle` | Crear → validar → compilar → revisar → aprobar → desplegar |
| `runtime` | Decisión en línea, incluida la respuesta idempotente |
| `nested-decision-trees` | Encadenamiento entre artefactos con presupuesto |
| `security` | Autenticación, autorización y aislamiento por tenant |
| `access-denial-audit` | Toda denegación queda registrada |
| `security-review` | Revisión de seguridad de una versión |
| `notifications` | Del outbox a la bandeja |
| `sample-inputs` | Generar valores de prueba y simular con ellos, ida y vuelta |
| `contract-conformance` | La respuesta **real** cumple el esquema que el contrato declara |
| `health` | Sondas |

## Infraestructura, no mocks

Se ejecutan contra PostgreSQL y Redis reales. Un mock de la base no habría detectado que RLS
estaba inerte con el rol equivocado, ni que un `createManyAndReturn` cambió la forma de un
resultado.

## Utilidades

- `createTestApp()` levanta la aplicación con la configuración de prueba.
- `test/e2e/support/` trae los clientes autenticados por audiencia.
- La limpieza es un `globalTeardown` **común**, no por especificación: por-especificación dejaba restos cuando una suite fallaba a mitad.

## Escribir una nueva

1. Ejercite el flujo por **HTTP**, como lo haría un integrador. Si llama a un servicio directamente, es de integración.
2. Autentíquese con el cliente de la audiencia correcta: uno de runtime no puede administrar.
3. Filtre por código; no asuma la primera página.
4. Deje que el teardown común limpie.

## Lo que las e2e no cubren

- **Rendimiento**: ver [pruebas de rendimiento](performance-tests.md).
- **El sandbox bajo gVisor**: se prueba el runner, pero el aislamiento real depende del anfitrión.
- **El portal**: tiene su propia suite en el repositorio del frontend.
