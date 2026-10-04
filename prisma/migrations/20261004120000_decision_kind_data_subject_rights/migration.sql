-- Solicitudes del titular sobre sus datos (corregir, borrar): una clase de decisión que no origina
-- crédito. Sin este valor el artefacto quedaría como ORIGINATION y producción le exigiría una PD.
-- Sólo añade un valor: ninguna fila cambia y el enum no se reordena.
ALTER TYPE "DecisionKind" ADD VALUE IF NOT EXISTS 'DATA_SUBJECT_RIGHTS';
--
-- Rollback operacional: PostgreSQL no quita valores de un enum. Si hubiera que retirarlo, basta con
-- no usarlo; un valor sin filas no cambia el comportamiento de nada.
