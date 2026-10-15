import type { Regla } from './glosa-regla';

/**
 * Rubros de la capa 1 — Empresa, obra y campo.
 * Ver `glosa-rubros.ts` para el orden entre grupos, que importa.
 */
export const RUBROS_EMPRESA_OBRA_Y_CAMPO: readonly Regla[] = [
  // --- Empresa, obra y campo ----------------------------------------------
  {
    patron: /\b(?:PUBLICIDAD|MARKETING|FACEBOOK\s*ADS|GOOGLE\s*ADS|META\s+PLATFORMS|PAUTA)\b/u,
    salida: ['GASTOS.EMPRESARIALES.PUBLICIDAD'],
    entrada: [],
    porque: 'la glosa declara un gasto de publicidad',
    certeza: 'ALTA',
  },
  {
    patron:
      /\b(?:CEMENTO|FIERRO|LADRILLO|ARIDOS|CONSTRUCCION|MATERIALES\s+DE\s+OBRA|SOBOCE|FANCESA)\b/u,
    salida: ['GASTOS.CONSTRUCCION.MATERIALES'],
    entrada: [],
    porque: 'la glosa nombra materiales de construcción',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:CONTRATISTA|OBRA\s+CIVIL|SUPERVISION\s+DE\s+OBRA)\b/u,
    salida: ['GASTOS.CONSTRUCCION.CONTRATISTA'],
    entrada: [],
    porque: 'la glosa nombra a un contratista de obra',
    certeza: 'MEDIA',
  },
  {
    patron: /\b(?:FERTILIZANTE|AGROQUIMIC|SEMILLA|UREA|HERBICIDA|PLAGUICIDA|AGROPECUARI)/u,
    salida: ['GASTOS.AGRO.INSUMOS'],
    entrada: [],
    porque: 'la glosa nombra insumos agropecuarios',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:FLETE|TRANSPORTE\s+DE\s+CARGA|COURIER|DHL|FEDEX|LOGISTICA)\b/u,
    salida: ['GASTOS.EMPRESARIALES.LOGISTICA', 'GASTOS.COMEX.FLETE'],
    entrada: [],
    porque: 'la glosa declara un flete o envío de carga',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:HONORARIOS|CONSULTORIA|ASESORIA|ABOGADO|CONTADOR|NOTARIA|AUDITORIA)\b/u,
    salida: ['GASTOS.PROFESIONALES'],
    entrada: ['INGRESOS.INDEPENDIENTE'],
    porque: 'la glosa declara honorarios profesionales',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:PROVEEDOR|FACTURA\s+N|PAGO\s+A\s+PROVEEDORES|ORDEN\s+DE\s+COMPRA)\b/u,
    salida: ['GASTOS.PROVEEDORES'],
    entrada: [],
    porque: 'la glosa declara el pago a un proveedor',
    certeza: 'MEDIA',
  },
  {
    patron: /\b(?:REGALIA|REGALIAS\s+MINERAS|COMIBOL|SENARECOM)\b/u,
    salida: ['GASTOS.MINERIA.REGALIAS'],
    entrada: ['INGRESOS.REGALIAS'],
    porque: 'la glosa declara regalías mineras',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:EXPORTACION|EMBARQUE|BILL\s+OF\s+LADING|CARTA\s+DE\s+CREDITO)\b/u,
    salida: ['GASTOS.COMEX.DESPACHANTE'],
    entrada: ['INGRESOS.EXPORTACION'],
    porque: 'la glosa declara una operación de comercio exterior',
    certeza: 'MEDIA',
  },
  {
    patron: /\b(?:ALMACENAJE|DEPOSITO\s+ADUANERO|BODEGA\s+ALQUILER|WAREHOUSE)\b/u,
    salida: ['GASTOS.EMPRESARIALES.ALMACENAJE'],
    entrada: [],
    porque: 'la glosa declara almacenaje',
    certeza: 'MEDIA',
  },
];
