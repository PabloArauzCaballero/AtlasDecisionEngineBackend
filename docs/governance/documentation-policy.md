# Política de documentación

## Regla

**La documentación es parte del producto, no un anexo.** Un cambio que la deja desactualizada
está incompleto, igual que uno sin pruebas.

## Qué se genera y qué se escribe

| Naturaleza | Ejemplos | Regla |
| --- | --- | --- |
| **Generado** | Endpoints, entidades, eventos, errores, variables de entorno, dependencias entre módulos | **No editar a mano**: se sobrescribe. Cambie el código |
| **Escrito** | Contexto de negocio, decisiones, amenazas, runbooks, guías | Se actualiza con el cambio que lo afecta |

Las páginas generadas llevan un aviso en su cabecera.

## Qué exige un cambio

| Si el cambio… | Actualice |
| --- | --- |
| Añade o modifica un endpoint | Nada a mano: regenere con `yarn docs:catalog`. Sí escriba su `@ApiOperation` |
| Añade una variable de entorno | Declárela en el esquema (o se ignorará en silencio) y comente **para qué** |
| Añade una tabla | Política RLS si tiene tenant; regenere el catálogo |
| Añade un evento | Añádalo a `DecisionEventType` y regenere |
| Cambia un comportamiento operativo | El runbook correspondiente |
| Toma una decisión estructural | Un ADR |
| Añade una integración saliente | Mapa de integraciones y modelo de amenazas |

## Reglas editoriales

- **Español técnico claro.** Frases directas.
- Un comentario o un párrafo explican **una restricción o un porqué no evidente**, nunca reescriben lo que el código ya dice.
- Nada de «esto», «aquello» o «el sistema» sin antecedente.
- Siglas explicadas en su primera aparición.
- Separar explícitamente **comportamiento actual**, **decisión** y **recomendación**.
- Tablas solo cuando mejoran la comparación.
- Diagramas con propósito; ninguno decorativo.
- **Cero relleno.** Una página que no reduce la incertidumbre de nadie no debería existir.

## Lo que no se documenta

- Lo que el código ya dice con claridad.
- Funcionalidad que no existe, redactada como si existiera.
- Procedimientos que nadie ha ejecutado nunca. Si no se ha probado, dígalo.

!!! danger "Prohibido documentar lo inexistente"
    Es peor que no documentar: un operador seguirá el procedimiento durante un incidente y
    descubrirá allí que no funciona.

## Deuda documental

Una brecha real se **registra** con su impacto y su acción concreta; no se disimula. Ver
[análisis de brechas](../reports/documentation-gap-analysis.md). Cuando la deuda se puede medir,
se pone un trinquete para que no crezca — es lo que se hizo con los esquemas de respuesta.

## Validación

```bash
yarn docs:validate   # contrato + catálogos + cobertura + enlaces
yarn docs:build      # portal en modo estricto
```

Ambos corren en CI. Ver [ADR-0023](../adr/ADR-0023-generated-documentation.md).
