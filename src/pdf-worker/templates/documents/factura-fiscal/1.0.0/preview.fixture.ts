/**
 * Datos ficticios de `factura-fiscal@1.0.0`.
 *
 * El NIT es el 1003579028 de los ejemplos oficiales del SIN y la razón social lo declara: nadie
 * debe poder confundir esta vista previa con una factura. El CUF es hexadecimal inventado.
 *
 * El QR es un DIBUJO con la forma de un QR (tres marcas de posición y módulos pseudoaleatorios
 * deterministas), no un código legible: el worker no genera QR —lo recibe del ERP— y aquí sólo
 * hace falta algo del tamaño y la densidad de uno para ver la maquetación. Determinista porque
 * la regresión visual compara la huella del HTML.
 */
import type { FacturaFiscalPayload } from './schema';

const MODULOS = 25;

function esMarcaDePosicion(x: number, y: number): boolean {
  const enEsquina = (cx: number, cy: number) => x >= cx && x < cx + 7 && y >= cy && y < cy + 7;
  return enEsquina(0, 0) || enEsquina(MODULOS - 7, 0) || enEsquina(0, MODULOS - 7);
}

function marcaDePosicion(cx: number, cy: number): string {
  return (
    `<rect x="${cx}" y="${cy}" width="7" height="7"/>` +
    `<rect x="${cx + 1}" y="${cy + 1}" width="5" height="5" fill="#fff"/>` +
    `<rect x="${cx + 2}" y="${cy + 2}" width="3" height="3"/>`
  );
}

/** SVG de 25×25 módulos con el aspecto de un QR. No codifica nada. */
export function qrFicticioDataUri(): string {
  let semilla = 1003579028;
  const modulos: string[] = [];
  for (let y = 0; y < MODULOS; y += 1) {
    for (let x = 0; x < MODULOS; x += 1) {
      // Generador congruencial lineal: el mismo dibujo en cada ejecución.
      semilla = (semilla * 1_103_515_245 + 12_345) % 2_147_483_648;
      if (!esMarcaDePosicion(x, y) && semilla % 2 === 0) {
        modulos.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
      }
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${MODULOS + 4} ${MODULOS + 4}" ` +
    `shape-rendering="crispEdges"><rect x="-2" y="-2" width="${MODULOS + 4}" ` +
    `height="${MODULOS + 4}" fill="#fff"/><g fill="#000">` +
    marcaDePosicion(0, 0) +
    marcaDePosicion(MODULOS - 7, 0) +
    marcaDePosicion(0, MODULOS - 7) +
    modulos.join('') +
    '</g></svg>';
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

export const facturaFiscalFixture = (): FacturaFiscalPayload => ({
  emisor: {
    nit: '1003579028',
    razonSocial: 'EMPRESA DE PRUEBA ATLAS S.R.L. (DATOS FICTICIOS)',
    municipio: 'La Paz',
    direccion: 'Av. de Ejemplo N° 123, Zona Ficticia',
    telefono: '2-0000000',
    sucursal: 0,
    puntoVenta: 1,
  },
  numeroFactura: 123,
  cuf: '46A1B2C3D4E5F60718293A4B5C6D7E8F9012345ABCDEF0123456789A',
  fechaEmision: '26/09/2026 10:15',
  referenciaInterna: 'FAC-CM-2026-000123',
  receptor: {
    nombreRazonSocial: 'COMERCIO DE PRUEBA Ñandú & Peñaranda',
    tipoDocumento: 'NIT - NÚMERO DE IDENTIFICACIÓN TRIBUTARIA',
    numeroDocumento: '1234567019',
    codigoCliente: 'CM-000045',
  },
  detalle: [
    {
      codigoProducto: 'SRV-MDR-001',
      descripcion: 'Comisión por procesamiento de pagos QR — septiembre 2026',
      cantidad: '1',
      unidadMedida: 'UNIDAD (SERVICIOS)',
      precioUnitario: '1100.00',
      descuento: '0.00',
      subTotal: '1100.00',
    },
    {
      codigoProducto: 'SRV-POS-002',
      descripcion: 'Alquiler de terminal POS',
      cantidad: '2',
      unidadMedida: 'UNIDAD (SERVICIOS)',
      precioUnitario: '75.00',
      descuento: '0.00',
      subTotal: '150.00',
    },
  ],
  totales: {
    subtotal: '1250.00',
    descuentoAdicional: '0.00',
    montoTotal: '1250.00',
    montoAPagar: '1250.00',
    importeBaseCreditoFiscal: '1250.00',
    montoLiteral: 'Son: Mil doscientos cincuenta 00/100 Bolivianos',
  },
  moneda: 'BOLIVIANO',
  leyenda:
    'Ley N° 453: El proveedor de servicios debe habilitar medios e instrumentos para efectuar ' +
    'consultas y reclamaciones.',
  qrDataUri: qrFicticioDataUri(),
  estado: 'VALIDA',
});
