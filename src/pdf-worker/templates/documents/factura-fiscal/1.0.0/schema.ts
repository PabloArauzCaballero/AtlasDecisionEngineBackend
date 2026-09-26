/**
 * Contrato de `factura-fiscal@1.0.0`: la representación gráfica de una factura de compra-venta
 * boliviana (SIN, modalidad en línea).
 *
 * El worker NO calcula nada fiscal. Los importes llegan como TEXTO decimal ya redondeado por el
 * ERP (`"1250.00"`), no como `number`: el importe impreso tiene que ser, carácter a carácter, el
 * que viaja en el XML firmado, y pasar por un `double` y un formateador de locale es la manera
 * de que un «1250.005» salga distinto en el papel que en el SIN. El PDF imprime lo que recibe.
 *
 * El QR también llega hecho, como data URI: el render no tiene red y las plantillas no admiten
 * interpolación sin escapar, así que la única forma de pintarlo es `<img src="{{qrDataUri}}">`
 * —como el membrete—. El prefijo se valida aquí para que un `javascript:` o una URL remota no
 * lleguen nunca al atributo.
 *
 * Tres estados, y cada uno cambia lo que el papel AFIRMA:
 *  - `VALIDA`: aceptada por el SIN; lleva la frase de «Representación Gráfica de un Documento
 *    Fiscal Digital».
 *  - `FUERA_DE_LINEA`: emitida en contingencia; exige `eventoContingencia` y lo imprime.
 *  - `REPRESENTACION_INTERNA`: no hay documento fiscal válido detrás. Lleva una marca grande y
 *    NO la frase de documento fiscal digital, porque sería falsa.
 */
import { z } from 'zod';

/** Importe monetario: punto decimal y exactamente dos decimales, sin separador de miles. */
const Monto = z
  .string()
  .regex(/^\d{1,14}\.\d{2}$/, 'Importe con punto decimal y dos decimales, p. ej. «1250.00».');

/** Cantidad o precio unitario: el SIN admite hasta cinco decimales. */
const Decimal = z
  .string()
  .regex(/^\d{1,14}(\.\d{1,5})?$/, 'Número decimal con punto y hasta cinco decimales.');

const Texto = (max: number) => z.string().trim().min(1).max(max);

export const FACTURA_ESTADOS = ['VALIDA', 'FUERA_DE_LINEA', 'REPRESENTACION_INTERNA'] as const;

/** Sólo imágenes embebidas, y sólo los dos formatos que produce el ERP. */
export const QR_DATA_URI = /^data:image\/(svg\+xml|png);base64,[A-Za-z0-9+/]+={0,2}$/;

const EmisorSchema = z.strictObject({
  nit: z.string().regex(/^\d{5,20}$/, 'NIT: sólo dígitos, de 5 a 20.'),
  razonSocial: Texto(200),
  municipio: Texto(120),
  direccion: Texto(300),
  telefono: z.string().trim().max(40).optional(),
  /** 0 = casa matriz. */
  sucursal: z.number().int().min(0).max(9_999),
  puntoVenta: z.number().int().min(0).max(9_999),
});

const ReceptorSchema = z.strictObject({
  nombreRazonSocial: Texto(300),
  /** Descripción del catálogo, p. ej. «CI - CÉDULA DE IDENTIDAD». */
  tipoDocumento: Texto(120),
  numeroDocumento: Texto(20),
  complemento: z.string().trim().max(5).optional(),
  codigoCliente: Texto(100),
});

const DetalleSchema = z.strictObject({
  codigoProducto: Texto(50),
  descripcion: Texto(500),
  cantidad: Decimal,
  /** Descripción del catálogo, p. ej. «UNIDAD (SERVICIOS)». */
  unidadMedida: Texto(120),
  precioUnitario: Decimal,
  descuento: Monto,
  subTotal: Monto,
});

const TotalesSchema = z.strictObject({
  subtotal: Monto,
  descuentoAdicional: Monto,
  montoTotal: Monto,
  montoGiftCard: Monto.optional(),
  montoAPagar: Monto,
  importeBaseCreditoFiscal: Monto,
  /** «Son: Mil doscientos cincuenta 00/100 Bolivianos». */
  montoLiteral: Texto(400),
});

export const FacturaFiscalSchema = z
  .strictObject({
    emisor: EmisorSchema,
    /** Número fiscal de la factura (el del SIN, no la referencia interna). */
    numeroFactura: z.number().int().positive().max(9_999_999_999),
    cuf: z.string().regex(/^[0-9A-Fa-f]{20,100}$/, 'CUF: hexadecimal de 20 a 100 caracteres.'),
    /** Ya formateada para imprimir, en hora de Bolivia: «26/09/2026 10:15». */
    fechaEmision: Texto(40),
    /** Referencia del ERP, p. ej. «FAC-CM-2026-000123». */
    referenciaInterna: Texto(60),
    receptor: ReceptorSchema,
    detalle: z.array(DetalleSchema).min(1).max(500),
    totales: TotalesSchema,
    /** «BOLIVIANO». */
    moneda: Texto(40),
    /** Leyenda del catálogo del SIN (Ley N° 453). */
    leyenda: Texto(600),
    qrDataUri: z
      .string()
      .max(400_000)
      .regex(
        QR_DATA_URI,
        'El QR debe ser un data URI «data:image/svg+xml;base64,…» o «data:image/png;base64,…».',
      ),
    estado: z.enum(FACTURA_ESTADOS),
    /** Código del evento significativo; obligatorio en `FUERA_DE_LINEA` y sólo ahí. */
    eventoContingencia: z.number().int().positive().max(9_999_999_999).optional(),
  })
  .superRefine((factura, ctx) => {
    if (factura.estado === 'FUERA_DE_LINEA' && factura.eventoContingencia === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Una factura FUERA_DE_LINEA exige «eventoContingencia».',
        path: ['eventoContingencia'],
      });
    }
    if (factura.estado !== 'FUERA_DE_LINEA' && factura.eventoContingencia !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: '«eventoContingencia» sólo corresponde a una factura FUERA_DE_LINEA.',
        path: ['eventoContingencia'],
      });
    }
  });

export type FacturaFiscalPayload = z.infer<typeof FacturaFiscalSchema>;
