/**
 * Datos ficticios de `blank-form@1.0.0`.
 *
 * Ejercita TODOS los `kind`, una sección con tabla de renglones que cruza de página, un campo
 * pre-impreso, un `select` corto con casillas y otro largo resuelto por anexo, y firmas. Es
 * también el `example` que publica `GET /pdf/templates/blank-form/schema`.
 */
import type { BlankFormPayload } from './schema';

const RUBROS = [
  ['RETAIL', 'Comercio minorista'],
  ['GASTRO', 'Restaurantes y comida'],
  ['SALUD', 'Farmacias y salud'],
  ['EDU', 'Educación y capacitación'],
  ['SERV', 'Servicios profesionales'],
  ['TRANS', 'Transporte y logística'],
  ['CONST', 'Construcción y ferretería'],
  ['TEXTIL', 'Ropa y calzado'],
  ['TECNO', 'Tecnología y electrónica'],
  ['HOGAR', 'Hogar y muebles'],
  ['AUTO', 'Automotriz y repuestos'],
  ['BELLEZA', 'Belleza y cuidado personal'],
  ['TURISMO', 'Turismo y hospedaje'],
  ['AGRO', 'Agropecuario'],
  ['OTRO', 'Otro (describa en observaciones)'],
] as const;

export const blankFormFixture = (): BlankFormPayload => ({
  formCode: 'ERP-PORTAL-EXPEDIENTE-ABRIR',
  formVersion: 'a91f3c2e',
  title: 'Solicitud de afiliación de comercio',
  subtitle: 'Portal del comercio · Abrir expediente',
  instructions: [
    'Rellene todos los campos marcados con asterisco.',
    'Escriba en mayúsculas, una letra por casilla donde las haya.',
    'Adjunte fotocopia del NIT y del carnet del representante legal.',
    'Entregue este formulario en la oficina comercial o al ejecutivo asignado.',
  ],
  context: [
    { label: 'Ejecutivo asignado', value: 'Rojas Mamani, Carla' },
    { label: 'Oficina', value: 'La Paz · Sopocachi' },
  ],
  sections: [
    {
      title: 'Datos de la empresa',
      fields: [
        { label: 'Razón social', kind: 'text', required: true, width: 2 },
        { label: 'NIT', kind: 'number', required: true, hint: 'Sin puntos ni guiones' },
        { label: 'Nombre comercial', kind: 'text', width: 2 },
        { label: 'Matrícula de comercio', kind: 'text' },
        {
          label: 'Rubro principal',
          kind: 'select',
          required: true,
          catalogRef: 'Rubros',
          width: 1,
        },
        {
          label: 'Tipo de cuenta',
          kind: 'select',
          required: true,
          options: [
            { code: 'MERCH', label: 'Comercio' },
            { code: 'PROV', label: 'Proveedor' },
            { code: 'ALIADO', label: 'Aliado' },
          ],
          width: 2,
        },
        { label: 'País y ciudad', kind: 'countryCity', required: true, width: 2 },
        { label: 'Fecha de fundación', kind: 'date' },
        { label: 'Casa matriz', kind: 'address', required: true, width: 3, lines: 2 },
        { label: 'Sitio web', kind: 'url', width: 2 },
        { label: '¿Factura electrónica?', kind: 'boolean' },
        { label: 'Etiquetas (palabras clave del negocio)', kind: 'chips', width: 3, lines: 3 },
        {
          label: 'Descripción del negocio',
          kind: 'textarea',
          width: 3,
          lines: 4,
          hint: 'Qué vende, a quién y desde cuándo',
        },
        {
          label: 'Medios de pago que acepta',
          kind: 'multiselect',
          width: 3,
          options: [
            { label: 'Efectivo' },
            { label: 'QR' },
            { label: 'Tarjeta' },
            { label: 'Transferencia' },
          ],
        },
      ],
    },
    {
      title: 'Persona de contacto',
      fields: [
        { label: 'Nombre completo', kind: 'text', required: true, width: 2 },
        { label: 'Cargo', kind: 'text' },
        { label: 'Correo electrónico', kind: 'email', required: true, width: 2 },
        { label: 'Teléfono / celular', kind: 'phone', required: true },
        { label: 'Mejor hora para llamar', kind: 'datetime', width: 2 },
        { label: 'Comercio registrado por', kind: 'text', prefilled: 'Oficina comercial La Paz' },
      ],
    },
    {
      title: 'Sucursales y cajas',
      description: 'Una línea por sucursal. Si tiene más de doce, use una hoja adicional.',
      table: {
        columns: [
          { label: 'Nombre de la sucursal', width: 3 },
          { label: 'Ciudad', width: 1 },
          { label: 'Dirección', width: 3 },
          { label: 'Cajas', width: 1, numeric: true },
        ],
        rows: 12,
        totalRow: true,
      },
    },
    {
      title: 'Documentos adjuntos',
      fields: [
        { label: 'Fotocopia del NIT', kind: 'file', required: true },
        { label: 'Carnet del representante legal', kind: 'file', required: true },
        { label: 'Poder notarial (si aplica)', kind: 'file' },
      ],
    },
  ],
  annexes: [{ title: 'Rubros', entries: RUBROS.map(([code, label]) => ({ code, label })) }],
  declarations: [
    'Declaro que los datos consignados son verdaderos y autorizo a ATLAS a verificarlos ante las entidades que corresponda.',
    'Entiendo que este formulario será transcrito al sistema por personal autorizado y que el número de serie impreso al pie identifica esta solicitud.',
  ],
  signatures: [
    { name: 'Firma del solicitante', role: 'Representante legal' },
    { name: 'Recibido por', role: 'Ejecutivo comercial' },
  ],
});
