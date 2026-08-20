---
title: Runbook — <procedimiento>
tags:
  - runbook
  - operacion
---

# Runbook — <procedimiento>

- **Cuándo se ejecuta:** <señal, alerta o momento del calendario>
- **Quién puede ejecutarlo:** <rol>
- **Duración estimada:** <tiempo>
- **Reversible:** sí / no — si no, qué se pierde

## Antes de empezar

- [ ] Acceso necesario confirmado.
- [ ] Ambiente correcto verificado (el comando que lo demuestra, no la suposición).
- [ ] Respaldo o punto de reversión disponible.

## Pasos

1. **<Acción>**

   ```bash
   <comando exacto>
   ```

   Resultado esperado: <salida concreta que confirma el éxito>.

   Si no ocurre: <qué hacer, o a qué paso de diagnóstico saltar>.

2. …

## Verificación

Qué se comprueba al terminar y con qué comando. Un procedimiento sin verificación explícita
termina cuando alguien se cansa, no cuando funciona.

## Reversión

Los pasos para deshacer, en orden, y qué queda sin deshacer.

## Qué NO hacer

Acciones destructivas que alguien podría intentar bajo presión y que están prohibidas sin
aprobación explícita: `prisma migrate reset`, borrado de datos, tocar producción fuera de este
procedimiento.

## Escalado

A quién avisar, con qué información, y a partir de qué umbral de tiempo o impacto.
