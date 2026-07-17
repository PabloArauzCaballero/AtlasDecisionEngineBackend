# ATLAS — Paquete de arquitectura PlantUML

Este paquete contiene una arquitectura integral para un motor de decisión de crédito, riesgo y fraude, con edición visual, contratos de variables, versionado inmutable, pruebas deterministas, aprobaciones, despliegues, rollback, ejecución reproducible, explicabilidad y auditoría.

## Diagramas incluidos

1. Modelo relacional integral.
2. Modelo de clases y servicios de dominio.
3. Casos de uso y segregación de funciones.
4. Actividad end-to-end.
5. Estados de la versión.
6. Secuencia de edición, validación y pruebas.
7. Secuencia de ejecución online.
8. Secuencia de aprobación, despliegue y rollback.
9. Componentes Control Plane / Data Plane.
10. Despliegue de infraestructura.
11. Contexto del sistema e integraciones.
12. Flujo de decisión de crédito BNPL.
13. Flujo de fraude y revisión manual.
14. Gobierno y aprobaciones con swimlanes.
15. Test Bench, cobertura y regresión.
16. Catálogo, linaje y snapshot de variables.
17. Auditoría, explicabilidad y observabilidad.
18. Seguridad, RBAC y multitenancy.
19. Privacidad, retención y minimización.
20. Evolución de reglas a scorecards y ML.
21. Trazabilidad de requisitos a evidencia.
22. Paquetes backend y límites modulares.

## Principios de diseño incorporados

- El editor visual es fuente de diseño, pero el runtime ejecuta un artefacto compilado e inmutable.
- Solo DRAFT es editable; una versión aprobada o desplegada no se modifica.
- Toda variable tiene contrato, tipo, fuente, versión, validación y linaje.
- Las pruebas conservan corridas históricas y miden cobertura de nodos, aristas y rutas.
- Las razones de decisión se modelan mediante reason codes estructurados.
- La promoción a producción exige pruebas, aprobaciones y segregación de funciones.
- Cada ejecución persiste despliegue, versión, snapshot, ruta, razones y errores.
- Control Plane y Data Plane pueden escalar y desplegarse de forma independiente.
- El modelo permite empezar con reglas deterministas y evolucionar a scorecards/ML sin romper gobierno ni auditoría.

## Compilación

Coloque `plantuml.jar` junto a este directorio y ejecute:

### PowerShell

```powershell
./compile_all.ps1 -PlantUmlJar ../plantuml.jar -Format svg
```

### Linux/macOS

```bash
chmod +x compile_all.sh
./compile_all.sh ../plantuml.jar svg
```

Los scripts generan los diagramas dentro de `rendered/`.
