import { z } from 'zod';
import { AudioDomainError } from '../domain/errors';
import type { ResolveAudioRequest } from '../domain/audio.types';

/**
 * Validación del único borde público del paquete. Sin esto, valores libres
 * llegan hasta columnas acotadas y producen errores crudos de base de datos.
 */
export const resolveAudioRequestSchema = z
  .object({
    templateCode: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[a-z0-9][a-z0-9._-]*$/u, 'formato de código de plantilla inválido'),
    variables: z
      .record(
        z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-zA-Z0-9_.-]+$/u),
        z.string().max(200),
      )
      .refine((value) => Object.keys(value).length <= 16, 'máximo 16 variables')
      .optional(),
    actorId: z.string().min(1).max(160).optional(),
    language: z
      .string()
      .min(2)
      .max(20)
      .regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/u, 'etiqueta de idioma inválida')
      .optional(),
    correlationId: z.string().min(1).max(64).optional(),
  })
  .strict();

export function parseResolveRequest(request: unknown): ResolveAudioRequest {
  const parsed = resolveAudioRequestSchema.safeParse(request);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
      .join('; ');
    throw new AudioDomainError(`Solicitud de audio inválida: ${detail}`, 'AUDIO_REQUEST_INVALID');
  }
  return parsed.data;
}
