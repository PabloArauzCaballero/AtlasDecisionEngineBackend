# Recursos del generador documental

Logotipos, sellos, iconos y firmas escaneadas. Se referencian **siempre** como

```
asset:<nombre-del-archivo>
```

nunca como URL ni como ruta. `FilesystemAssetResolverAdapter` los lee de esta carpeta, los
convierte en `data:` URI y los cachea.

## Por qué no se admite una URL

Porque «pon el logotipo por URL» es la forma más razonable de aspecto y más directa de hecho de
convertir el generador en un cliente HTTP que visita lo que le digan **desde dentro de la red
del motor**. `http://169.254.169.254/latest/meta-data` es la dirección de metadatos de la mayoría
de las nubes y devuelve credenciales.

Hay dos barreras y las dos tienen prueba:

1. El resolutor rechaza cualquier referencia que no empiece por `asset:`, y cualquier nombre
   con `/`, `\` o `..`.
2. El adaptador de renderizado **aborta toda petición de red de la página**: sólo pasan `data:`,
   `about:` y `blob:`.

## Formatos y límites

`.svg` · `.png` · `.jpg` · `.jpeg` · `.webp` · `.gif` · `.woff2` · `.woff` · `.ttf`

Máximo **2 MiB** por archivo. Un recurso se convierte en base64 —un 33 % más grande— dentro del
HTML de *cada* documento que lo use; un logotipo institucional razonable pesa menos de 100 KiB.

Prefiera **SVG** para el logotipo: escala sin pixelarse a cualquier tamaño de impresión y suele
pesar menos que un PNG a 300 ppp.

## Cómo se usa

```bash
# .env
PDF_ORG_LOGO=asset:logo-cooperativa.svg
```

Un template puede declarar los suyos para que se precarguen y se validen al arrancar:

```ts
export const MiTemplate = defineTemplate({
  // …
  assets: ['asset:sello-aprobado.png'],
});
```

`PdfWorkerLifecycle` los resuelve en el `onModuleInit`. Un recurso declarado que falta se avisa
**en el arranque**, con el nombre y el directorio donde se buscó, en vez de romper el primer
informe del trimestre.
