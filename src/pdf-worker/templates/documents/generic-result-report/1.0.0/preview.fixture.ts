/**
 * Datos ficticios de `generic-result-report@1.0.0` (§21).
 *
 * No es un «hola mundo». Está escrito para que la vista previa EJERCITE lo que suele romperse:
 * una tabla con más filas de las que caben en una hoja —que obliga a repetir la cabecera y a
 * paginar—, acentos y eñes, un salto de página explícito, valores booleanos y nulos, y un
 * texto largo que fuerza el ajuste de línea. Una vista previa con tres campos cortos sale
 * perfecta siempre y no informa de nada.
 *
 * También es el `example` que devuelve `GET /pdf/templates/:id/schema`, así que envejecer sin
 * darse cuenta no es una opción: si deja de validar, la vista previa se rompe.
 */
import type { GenericResultReportPayload } from './schema';

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

/** 36 filas: suficientes para cruzar la primera página en A4 y comprobar la paginación. */
function movimientos(): Array<Record<string, string | number | boolean | null>> {
  return Array.from({ length: 36 }, (_, index) => ({
    periodo: `${MESES[index % 12]} ${2023 + Math.floor(index / 12)}`,
    ingresos: 4_820.5 + index * 137.25,
    egresos: 3_115.4 + index * 96.8,
    conciliado: index % 4 !== 0,
    observacion: index % 7 === 0 ? 'Diferencia por comisión bancaria no registrada' : null,
  }));
}

export const genericResultReportFixture = (): GenericResultReportPayload => ({
  title: 'Resultado del análisis de comportamiento financiero',
  subtitle: 'Evaluación automática · Núñez Peñaranda, María José · CI 7.845.219 LP',
  summary: [
    { label: 'Puntaje', value: 782, caption: 'sobre 1000' },
    { label: 'Decisión', value: 'APROBADO' },
    { label: 'Monto sugerido', value: 50000, caption: 'BOB' },
    { label: 'Vigencia', value: '90 días' },
  ],
  notices: [
    {
      level: 'caution',
      title: 'Revisión manual sugerida',
      text:
        'El ingreso declarado supera en más de un 40 % la mediana del sector económico ' +
        'registrado. La regla no bloquea la decisión, pero el expediente queda marcado para ' +
        'que un analista contraste el respaldo documental antes del desembolso.',
    },
  ],
  sections: [
    {
      title: 'Identificación del solicitante',
      description: 'Datos consolidados desde el padrón y el expediente de incorporación.',
      fields: [
        { label: 'Nombre completo', value: 'María José Núñez Peñaranda' },
        { label: 'Documento', value: '7845219 LP' },
        { label: 'Antigüedad laboral (meses)', value: 74 },
        { label: 'Ingreso mensual declarado', value: 12480.75 },
        { label: 'Cuenta activa', value: true },
        { label: 'Observaciones del gestor', value: null },
      ],
    },
    {
      title: 'Movimientos considerados',
      description:
        'Serie mensual utilizada por el modelo. La tabla cruza varias páginas a propósito: ' +
        'sirve para verificar que la cabecera se repite y que ninguna fila queda partida.',
      table: {
        columns: [
          { key: 'periodo', label: 'Periodo' },
          { key: 'ingresos', label: 'Ingresos (BOB)' },
          { key: 'egresos', label: 'Egresos (BOB)' },
          { key: 'conciliado', label: 'Conciliado' },
          { key: 'observacion', label: 'Observación' },
        ],
        rows: movimientos(),
      },
    },
    {
      title: 'Reglas evaluadas',
      pageBreakBefore: true,
      table: {
        columns: [
          { key: 'regla', label: 'Regla' },
          { key: 'umbral', label: 'Umbral' },
          { key: 'valor', label: 'Valor' },
          { key: 'resultado', label: 'Resultado' },
        ],
        rows: [
          { regla: 'Relación cuota/ingreso', umbral: 0.35, valor: 0.28, resultado: 'CUMPLE' },
          { regla: 'Mora histórica máxima', umbral: 30, valor: 0, resultado: 'CUMPLE' },
          { regla: 'Antigüedad mínima', umbral: 12, valor: 74, resultado: 'CUMPLE' },
          { regla: 'Consultas al buró (6 meses)', umbral: 4, valor: 6, resultado: 'REVISIÓN' },
        ],
      },
    },
  ],
  signatures: [
    { name: 'Motor de decisión ATLAS', role: 'Evaluación automática' },
    { name: 'Analista responsable', role: 'Visto bueno' },
  ],
});
