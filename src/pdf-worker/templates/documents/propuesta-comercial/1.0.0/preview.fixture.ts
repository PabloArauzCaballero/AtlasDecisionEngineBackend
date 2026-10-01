/**
 * Datos ficticios de `propuesta-comercial@1.0.0`. «Comercio de Ejemplo» lo declara: nadie debe
 * poder confundir esta vista previa con una propuesta real.
 */
import type { PropuestaComercialPayload } from './schema';

export function propuestaComercialFixture(): PropuestaComercialPayload {
  return {
    propuesta: {
      numero: 'PROP-2026-000000',
      validaHasta: '30 de octubre de 2026',
      fecha: '30 de septiembre de 2026',
    },
    comercio: {
      nombre: 'Comercio de Ejemplo',
      razonSocial: 'Comercio de Ejemplo S.R.L.',
      nit: '1234567',
      ciudad: 'Santa Cruz',
    },
    saludo: 'Señores de Comercio de Ejemplo:',
    introduccion: [
      'Gracias por el tiempo que nos dedicaron. Les presentamos la propuesta para que Comercio de Ejemplo ofrezca a sus clientes la opción de comprar en cuotas con ATLAS.',
      'En estas páginas encontrarán qué gana su comercio, las condiciones económicas, cómo funciona en el día a día y los pasos para empezar.',
    ],
    nota: {
      autor: 'Ana Pérez',
      texto: 'Como conversamos el martes, les dejo la propuesta con la comisión que acordamos.',
    },
    beneficios: [
      {
        titulo: 'Más ventas',
        texto: 'Sus clientes se llevan hoy lo que necesitan y lo pagan en cuotas.',
      },
      {
        titulo: 'Crédito a cargo de ATLAS',
        texto:
          'ATLAS evalúa al cliente, le otorga el crédito y se encarga de cobrarle. Si el cliente final no paga, paga ATLAS: sus cuentas por cobrar tienen riesgo cero.',
      },
      {
        titulo: 'Cobro con QR, directo a su negocio',
        texto:
          'El cobro con QR es directo con su negocio: ningún dinero pasa por las cuentas de ATLAS.',
      },
      {
        titulo: 'Simplicidad',
        texto:
          'No le pedimos subir ningún catálogo. El cliente escanea el QR que identifica a su negocio y a su POS en el punto de venta, y con eso se carga su QR bancario real.',
      },
    ],
    condiciones: [
      {
        concepto: 'Comisión por venta',
        detalle: 'Sobre cada venta en cuotas',
        condicion: '2,5 %',
        cobro: 'Por cada venta',
      },
      { concepto: 'Mínimo mensual', condicion: 'Bs 300,00', cobro: 'Mensual' },
    ],
    condicionesNota: 'Estas son todas las condiciones de la propuesta; no hay cargos adicionales.',
    pasos: [
      { titulo: 'Elige', texto: 'El cliente elige su compra y pide pagarla en cuotas.' },
      { titulo: 'Escanea', texto: 'Escanea el QR de cobro del comercio con la app de ATLAS.' },
      { titulo: 'Aprueba', texto: 'ATLAS aprueba el crédito y el cliente confirma sus cuotas.' },
      { titulo: 'Cobra', texto: 'Su comercio recibe el pago de la venta según esta propuesta.' },
    ],
    proximosPasos: [
      { titulo: 'Aceptación', texto: 'Respondan al correo con el que recibieron esta propuesta.' },
      {
        titulo: 'Contrato',
        texto: 'Preparamos el contrato de afiliación con estas mismas condiciones.',
      },
      {
        titulo: 'Puesta en marcha',
        texto: 'Les entregamos el QR de cobro y capacitamos a su equipo.',
      },
    ],
    cierre:
      'Quedamos atentos a sus comentarios. Si prefieren revisarla juntos, con gusto coordinamos una llamada.',
    firma: {
      nombre: 'Ana Pérez',
      cargo: 'Ejecutiva comercial · ATLAS',
      correo: 'ana.perez@example.com',
    },
  };
}
