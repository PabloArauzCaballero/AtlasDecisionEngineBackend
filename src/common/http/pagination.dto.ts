import { applyDecorators, type Type as NestType } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';

/**
 * Declara una respuesta `200` cuyo cuerpo está **genuinamente vacío**: el controlador
 * devuelve `void` y Nest cierra la respuesta sin `Content-Type` ni cuerpo.
 *
 * `content: {}` (a diferencia de omitir `content`) es la forma que exige OpenAPI para decir
 * «esta respuesta no tiene representación», en vez de dejarlo sin especificar. Ponerle un
 * `schema: { type: 'object' }` sería describir un cuerpo `{}` que la respuesta real nunca
 * envía — exactamente el tipo de esquema que miente que este contrato evita a propósito.
 */
export function ApiEmptyOkResponse(description: string) {
  return applyDecorators(ApiResponse({ status: 200, description, content: {} }));
}

/**
 * Envoltorio de una página por desplazamiento, tal como lo produce `pageResult`.
 *
 * Se declara como clase para que el contrato lo describa una sola vez y todo endpoint
 * paginado lo comparta. Antes, ninguna operación de listado decía qué forma tenía su
 * respuesta y el integrador tenía que deducir la paginación probando.
 */
export class PageMetaDto {
  @ApiProperty({ example: 1, description: 'Página devuelta, empezando en 1.' })
  page!: number;

  @ApiProperty({ example: 25, description: 'Tamaño efectivo, acotado por `MAX_PAGE_SIZE`.' })
  pageSize!: number;

  @ApiProperty({ example: 1280, description: 'Total de elementos que cumplen el filtro.' })
  total!: number;

  @ApiProperty({ example: 52, description: 'Páginas totales; 0 cuando no hay elementos.' })
  totalPages!: number;

  @ApiProperty({ example: true, description: 'Si existe una página siguiente.' })
  hasNextPage!: boolean;
}

/**
 * Envoltorio de una página por cursor (`keysetPage`).
 *
 * No lleva `total` ni `totalPages` **a propósito**: recorrer por cursor evita contar, que es
 * justo lo que lo hace barato sobre un feed que crece sin cota. Declararlos aquí sugeriría
 * una capacidad que este esquema no ofrece.
 */
export class KeysetMetaDto {
  @ApiProperty({ example: 25 })
  pageSize!: number;

  @ApiProperty({
    example: 'MTIzNDU2',
    nullable: true,
    description: 'Cursor opaco de la página siguiente; `null` cuando la lista se agotó.',
  })
  nextCursor!: string | null;

  @ApiProperty({ example: true })
  hasNextPage!: boolean;
}

/**
 * Declara la respuesta de un listado paginado por desplazamiento.
 *
 * `item` es opcional: cuando el módulo aún no tiene un DTO de elemento, se describe el
 * envoltorio con elementos genéricos. Es información incompleta, no falsa — el consumidor
 * obtiene el contrato de paginación completo, que es lo que necesita para recorrer la lista,
 * y el detalle del elemento queda pendiente en vez de inventado.
 */
export function ApiPagedResponse(description: string, item?: NestType<unknown>) {
  const itemSchema = item
    ? { $ref: getSchemaPath(item) }
    : { type: 'object' as const, description: 'Elemento del listado; ver la página del módulo.' };
  return applyDecorators(
    ...(item ? [ApiExtraModels(item)] : []),
    ApiExtraModels(PageMetaDto),
    ApiOkResponse({
      description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(PageMetaDto) },
          {
            type: 'object',
            required: ['items'],
            properties: { items: { type: 'array', items: itemSchema } },
          },
        ],
      },
    }),
  );
}

/** Declara la respuesta de un listado paginado por cursor. */
export function ApiKeysetResponse(description: string, item?: NestType<unknown>) {
  const itemSchema = item
    ? { $ref: getSchemaPath(item) }
    : { type: 'object' as const, description: 'Elemento del listado; ver la página del módulo.' };
  return applyDecorators(
    ...(item ? [ApiExtraModels(item)] : []),
    ApiExtraModels(KeysetMetaDto),
    ApiOkResponse({
      description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(KeysetMetaDto) },
          {
            type: 'object',
            required: ['items'],
            properties: { items: { type: 'array', items: itemSchema } },
          },
        ],
      },
    }),
  );
}

/**
 * Declara una respuesta que es un **array desnudo**, sin envoltorio.
 *
 * Existe porque algunos endpoints devuelven el array directamente, y describirlos con el
 * envoltorio `{ items: [...] }` haría que el contrato mintiera sobre la forma exacta. La
 * distinción no es estética: un cliente generado a partir del envoltorio buscaría `.items`
 * en una respuesta que no lo tiene.
 */
export function ApiArrayResponse(description: string, item?: NestType<unknown>) {
  const itemSchema = item
    ? { $ref: getSchemaPath(item) }
    : { type: 'object' as const, description: 'Elemento del array.' };
  return applyDecorators(
    ...(item ? [ApiExtraModels(item)] : []),
    ApiOkResponse({ description, schema: { type: 'array', items: itemSchema } }),
  );
}

/**
 * Declara una respuesta de listado NO paginado: un catálogo cerrado que cabe entero.
 * Se distingue del paginado a propósito, para que el consumidor no busque un `nextCursor`
 * que nunca va a llegar.
 */
export function ApiItemsResponse(description: string, item?: NestType<unknown>) {
  const itemSchema = item
    ? { $ref: getSchemaPath(item) }
    : { type: 'object' as const, description: 'Elemento del catálogo.' };
  return applyDecorators(
    ...(item ? [ApiExtraModels(item)] : []),
    ApiOkResponse({
      description,
      schema: {
        type: 'object',
        required: ['items'],
        properties: { items: { type: 'array', items: itemSchema } },
      },
    }),
  );
}
