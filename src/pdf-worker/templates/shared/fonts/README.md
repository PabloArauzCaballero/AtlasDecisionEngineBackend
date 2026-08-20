# Fuentes del generador documental

**Esta carpeta está vacía a propósito.** Una tipografía es un artefacto con licencia: meterla
en el árbol de código convierte cada clon del repositorio en una redistribución, y eso no es
una decisión que pueda tomar quien programa el generador.

## Qué pasa mientras esté vacía

El documento se maqueta con la pila de respaldo que declara `tokens.css`:

```
'Liberation Sans', 'DejaVu Sans', Arial, Helvetica, sans-serif
'Liberation Mono', 'DejaVu Sans Mono', 'Courier New', monospace
```

El `Dockerfile` instala `fonts-liberation` y `fonts-dejavu-core`, así que **dentro de la imagen
el resultado es idéntico en desarrollo, CI y producción**. Fuera de ella —ejecutando el worker
directamente sobre Windows o macOS— el navegador usará lo que encuentre el sistema, y el
documento puede paginar distinto.

Eso no se supone: se PUBLICA. `GET /pdf/health` incluye

```json
{ "name": "fonts", "ok": false, "detail": "ninguna fuente embebida; se depende de la pila de respaldo del sistema" }
```

y el registro de arranque lleva `fontsEmbedded: []`. El estado `ok: false` de esta comprobación
NO degrada el informe global: sin fuente propia el worker sigue produciendo documentos
correctos, sólo deja de ser reproducible fuera de la imagen.

## Cómo incorporar una

Copie los archivos aquí siguiendo la convención de nombres:

```
<familia>-<peso>[-italic].woff2
```

Ejemplos:

```
atlas-sans-400.woff2
atlas-sans-700.woff2
atlas-sans-400-italic.woff2
atlas-mono-400.woff2
```

`FontRegistryAdapter` deriva el nombre de la familia del archivo (`atlas-sans` → `Atlas Sans`),
genera las reglas `@font-face` con la fuente **embebida en `data:` URI** y las inyecta tanto en
el cuerpo del documento como en el membrete y el pie —que el navegador pinta en un documento
aparte y no ven la hoja de estilos de la página—.

No hay que tocar código. La marca por defecto ya pide `Atlas Sans` y `Atlas Mono`
(`infrastructure/config/default-brand.ts`); en cuanto los archivos existan, pasan a usarse y
`/pdf/health` lo refleja.

Formatos admitidos: `.woff2` (recomendado), `.woff`, `.ttf`. Máximo 900 KiB por archivo — una
`woff2` con el subconjunto latino ronda los 30–60 KiB. Un archivo mayor se **omite** en vez de
abortar el arranque: una fuente enorme degrada el documento, no lo impide.

## Por qué embebidas y no por URL

`font-src` sale de la página. Cargar una fuente por `https://` haría tres cosas a la vez:
volvería el render dependiente de la red (adiós al §25), añadiría latencia impredecible a cada
documento y abriría la vía por la que el navegador visita direcciones que alguien elige. El
adaptador de renderizado **aborta toda petición que no sea `data:`**, así que una fuente remota
no llegaría de todos modos: el texto saldría con el respaldo y nadie se enteraría hasta abrir
el PDF.
