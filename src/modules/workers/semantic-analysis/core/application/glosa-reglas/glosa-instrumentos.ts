import type { Regla } from './glosa-regla';

/**
 * Capa 2: INSTRUMENTOS. Cómo se movió el dinero cuando la glosa no dice más.
 *
 * El orden importa: `RETIRO DE EFECTIVO` tiene que ganar a `EFECTIVO` a secas, y
 * `COMPRA EN COMERCIO ELECTRONICO` a `COMPRA`. Se recorre en orden y gana la
 * primera que case.
 */
export const INSTRUMENTOS: readonly Regla[] = [
  {
    patron:
      /\bRETIRO\b.*\b(?:EFECTIVO|FONDOS)\b|\bRETIRO\s+(?:ATM|CAJERO)\b|\bATM\b|\bCAJERO\s+AUTOMATICO\b/u,
    salida: ['GASTOS.EFECTIVO'],
    entrada: [],
    porque: 'la glosa declara un retiro de efectivo',
    certeza: 'MEDIA',
  },
  {
    patron: /\bDEPOSITO\b.*\bEFECTIVO\b|\bEFECTIVO\b.*\bDEPOSITO\b/u,
    salida: ['GASTOS.EFECTIVO'],
    entrada: ['INGRESOS.EFECTIVO'],
    porque: 'la glosa declara un movimiento de efectivo por ventanilla o cajero',
    certeza: 'MEDIA',
  },
  {
    patron: /\bVENTANILLA\b|\bCAJA\s+\d+\b|\bATENCION\s+EN\s+CAJA\b/u,
    salida: ['GASTOS.VENTANILLA', 'GASTOS.EFECTIVO'],
    entrada: ['INGRESOS.VENTANILLA', 'INGRESOS.EFECTIVO'],
    porque: 'la glosa declara una operación por ventanilla',
    certeza: 'MEDIA',
  },
  {
    patron: /\bCHEQUE\b|\bN\/?\s*CHEQUE\b|\bCAMARA\s+DE\s+COMPENSACION\b/u,
    salida: ['GASTOS.TRANSFERENCIAS'],
    entrada: ['INGRESOS.CHEQUE'],
    porque: 'la glosa declara un movimiento por cheque',
    certeza: 'MEDIA',
  },
  {
    patron:
      /\bCOMERCIO\s+ELECTRONIC|\bECOMMERCE\b|\bCOMPRA\s+WEB\b|\bCOMPRA\s+ONLINE\b|\bINTERNET\s+PURCHASE\b/u,
    salida: ['GASTOS.COMPRAS.TARJETA'],
    entrada: ['INGRESOS.REVERSO'],
    porque: 'la glosa declara una compra en comercio electrónico',
    certeza: 'MEDIA',
  },
  {
    patron: /\bTIGO\s*MONEY\b|\bBILLETERA\s+MOVIL\b|\bMONEDERO\s+ELECTRONICO\b|\bE-?WALLET\b/u,
    salida: ['GASTOS.TRANSFERENCIAS'],
    entrada: ['INGRESOS.BILLETERA', 'INGRESOS.TRANSFERENCIA'],
    porque: 'la glosa declara un movimiento por billetera móvil',
    certeza: 'MEDIA',
  },
  {
    patron:
      /\bTRASPASO\b|\bTRANSFERENCIA\b|\bTRASP\.?CTAS\b|\bP2P\b|\bACH\b(?!\s*QR)|\bPAGO\s+INMEDIATO\b|\bLIP\b|\bGIRO\s+INTERBANCARIO\b/u,
    salida: ['GASTOS.TRANSFERENCIAS'],
    entrada: ['INGRESOS.TRANSFERENCIA'],
    porque: 'la glosa declara una transferencia entre cuentas',
    certeza: 'MEDIA',
  },
  {
    patron: /\bQR\b/u,
    salida: ['GASTOS.COMPRAS.QR'],
    entrada: ['INGRESOS.QR', 'INGRESOS.TRANSFERENCIA'],
    porque: 'la glosa declara un cobro o pago por QR',
    certeza: 'MEDIA',
  },
  {
    patron:
      /\bDEBITO\s+AUTOMATICO\b|\bPAGO\s+AUTOMATICO\b|\bSERVICIO\s+DE\s+COBRANZA\b|\bRECAUDACION\b/u,
    salida: ['GASTOS.VIVIENDA.SERVICIOS'],
    entrada: [],
    porque: 'la glosa declara un débito automático de servicios',
    certeza: 'MEDIA',
  },
  {
    patron: /\bPOS\b|\bCOMPRA\b|\bCONSUMO\b|\bTARJETA\s+DE\s+(?:DEBITO|CREDITO)\b/u,
    salida: ['GASTOS.COMPRAS.TARJETA'],
    entrada: ['INGRESOS.REVERSO'],
    porque: 'la glosa declara una compra con tarjeta',
    certeza: 'MEDIA',
  },
  {
    patron: /\bCOMISION\b|\bMANTENIMIENTO\b|\bIMPUESTO\b|\bCARGO\s+POR\b|\bPORTES\b|\bEXTRACTO\b/u,
    salida: ['GASTOS.FINANCIEROS.COMISIONES'],
    entrada: ['INGRESOS.REVERSO'],
    porque: 'la glosa declara un cargo del propio banco',
    certeza: 'MEDIA',
  },
  {
    patron: /\bINTERES\b|\bRENDIMIENTO\b|\bCAPITALIZACION\b/u,
    salida: ['GASTOS.FINANCIEROS.PRESTAMOS'],
    entrada: ['INGRESOS.FINANCIERO'],
    porque: 'la glosa declara intereses',
    certeza: 'MEDIA',
  },
  {
    patron: /\bREVERSO\b|\bREVERSION\b|\bANULACION\b|\bDEVOLUCION\b|\bEXTORNO\b/u,
    salida: ['GASTOS.OTROS'],
    entrada: ['INGRESOS.REVERSO'],
    porque: 'la glosa declara la reversión de un movimiento anterior',
    certeza: 'MEDIA',
  },
];
