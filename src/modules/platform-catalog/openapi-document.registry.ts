import { Injectable } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

/**
 * El contrato OpenAPI que este proceso generó, guardado para que el manifiesto de bloque lo lea.
 *
 * El inventario de rutas se construye del router vivo (`RouteInventoryService`), que sabe el verbo,
 * la ruta y los roles pero no los CAMPOS que recibe cada endpoint: eso vive en los esquemas de
 * validación, y el único sitio donde ya están traducidos a una forma legible es el documento
 * OpenAPI. Sin ellos, ATLAS cataloga los 217 endpoints de este bloque sin un solo campo y su
 * laboratorio de QA no tiene de dónde derivar un payload de prueba.
 */
@Injectable()
export class OpenApiDocumentRegistry {
  private document: OpenAPIObject | null = null;

  set(document: OpenAPIObject): void {
    this.document = document;
  }

  /**
   * `null` cuando el proceso no lo generó — con `SWAGGER_ENABLED=false`, por ejemplo. El manifiesto
   * publica entonces los endpoints SIN contrato, que es lo que hacía siempre: se degrada a lo de
   * antes, no se inventa un contrato vacío ni se rompe la federación.
   */
  get(): OpenAPIObject | null {
    return this.document;
  }
}
