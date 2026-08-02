# Banco de pruebas

Este módulo demuestra que una versión decide como se espera antes de gobierno. A nivel de negocio
implementa regresión, evidencia de cobertura y gates bloqueantes; a nivel de sistema persiste
suites/casos, encola runs con lease, ejecuta con concurrencia acotada y guarda aserciones/cobertura.

El worker puede recuperarse de un lease expirado sin duplicar evidencia parcial. Las variables de
salida se excluyen de la resolución de entradas y cada caso usa el motor real.
