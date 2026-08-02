# Pruebas automatizadas

Esta carpeta contiene evidencia ejecutable de correctitud, seguridad y compatibilidad. A nivel de
negocio evita aprobar reglas o entregas basadas sólo en revisión manual; a nivel de sistema combina
unitarias rápidas, integraciones PostgreSQL/Redis y escenarios E2E sobre la API real.

Los `*.spec.ts` cubren unidades e integración y los `e2e/*.e2e-spec.ts` usan configuración separada.
Una prueba omitida debe declarar la dependencia externa exacta. Los logs esperados de fallos
simulados no equivalen a una suite fallida.
