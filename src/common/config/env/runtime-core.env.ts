import { z } from 'zod';
import { WORKER_ROLES } from '../worker-role';
import { optionalUrl } from './helpers';

export const runtimeCoreEnv = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  BUILD_VERSION: z.string().max(80).default('2.0.0'),
  COMMIT_SHA: z.string().max(80).default('local'),
  // The published API contract version, deliberately separate from BUILD_VERSION: the build
  // changes on every release, the contract only on a breaking change. Consumers pin to this.
  API_VERSION: z
    .string()
    .regex(/^v[0-9]+$/)
    .default('v1'),

  // Reparto de responsabilidades entre procesos; ver common/config/worker-role.ts.
  // `ALL` conserva el comportamiento de un solo contenedor que sirve y procesa.
  WORKER_ROLE: z.enum(WORKER_ROLES).default('ALL'),
  // Puerto de sondas del proceso WORKER, que no sirve tráfico de negocio pero sí debe
  // poder declararse vivo y listo ante el orquestador. También sirve `/metrics`.
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),

  // URL pública desde la que los consumidores alcanzan esta API. Se publica en el
  // contrato OpenAPI; sin ella solo se declara el servidor relativo, que es preferible a
  // publicar la URL de otro ambiente y que un cliente generado apunte al sitio equivocado.
  API_PUBLIC_URL: optionalUrl,
};
