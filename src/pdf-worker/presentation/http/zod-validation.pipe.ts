/**
 * Valida el cuerpo con Zod y devuelve el objeto YA tipado.
 *
 * El motor usa `ValidationPipe` con `class-validator`, pero el generador documental valida con
 * Zod de punta a punta —los contratos de los templates lo exigen— y tener dos validadores en
 * el mismo camino significa dos juegos de mensajes de error y dos formas de decir «campo
 * obligatorio». Este pipe hace que la frontera HTTP hable el mismo idioma que el contrato.
 *
 * El error sale con la MISMA forma que el de un payload inválido: campo, problema, esperado.
 * Quien integra no tiene que aprender dos formatos según qué parte de la petición falló.
 */
import { Injectable, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { TemplatePayloadValidationError } from '../../domain/errors/pdf-worker.errors';
import { toPayloadIssues } from '../../infrastructure/validation/payload-issues';

@Injectable()
export class ZodBodyPipe<TSchema extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data as z.output<TSchema>;
    // Se reutiliza el error de payload con `(petición)` como template: el consumidor recibe la
    // misma estructura y el código `TEMPLATE_PAYLOAD_INVALID` con la ruta del campo del sobre.
    throw new TemplatePayloadValidationError(
      '(petición)',
      '-',
      toPayloadIssues(result.error.issues, value),
    );
  }
}
