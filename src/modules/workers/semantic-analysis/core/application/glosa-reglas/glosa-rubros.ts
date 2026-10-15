import type { Regla } from './glosa-regla';
import { RUBROS_EMPRESA_OBRA_Y_CAMPO } from './rubros-empresa-obra-y-campo';
import { RUBROS_INGRESOS_Y_FINANZAS } from './rubros-ingresos-y-finanzas';
import { RUBROS_OCIO_COMPRAS_PERSONAL } from './rubros-ocio-compras-personal';
import { RUBROS_TRANSPORTE_ALIMENTACION_SALUD } from './rubros-transporte-alimentacion-salud';
import { RUBROS_VIVIENDA_Y_ESTADO } from './rubros-vivienda-y-estado';

/**
 * Capa 1: RUBROS. Lo que la glosa nombra por su nombre.
 *
 * Están escritos con los proveedores, trámites y marcas que aparecen de verdad
 * en los extractos bolivianos. Un nombre propio no es ambiguo: `SAGUAPAC` es
 * agua en Santa Cruz y no puede ser otra cosa, y por eso estas reglas son las
 * únicas autorizadas a saltarse el modelo.
 *
 * El orden importa dentro de la lista: lo más específico primero.
 */
export const RUBROS: readonly Regla[] = [
  ...RUBROS_VIVIENDA_Y_ESTADO,
  ...RUBROS_TRANSPORTE_ALIMENTACION_SALUD,
  ...RUBROS_OCIO_COMPRAS_PERSONAL,
  ...RUBROS_INGRESOS_Y_FINANZAS,
  ...RUBROS_EMPRESA_OBRA_Y_CAMPO,
];
