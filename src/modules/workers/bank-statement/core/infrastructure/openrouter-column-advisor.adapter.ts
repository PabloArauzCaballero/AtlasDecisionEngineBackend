import { Logger } from '@nestjs/common';
import type { OpenRouterChatClient } from '../../../../../common/llm/openrouter-chat.client';
import type {
  ColumnAdvice,
  ColumnAdviceRequest,
  StatementColumnAdvisorPort,
} from '../engine/generic/column-advisor';
import type { CanonicalField } from '../engine/generic/header-lexicon';

/**
 * El consejero de columnas contra un modelo por OpenRouter.
 *
 * Le manda los RÓTULOS de la cabecera y nada más —ni una fila, ni un importe, ni
 * un nombre—, porque el mapeo se decide con el rótulo. Ver `column-advisor.ts`
 * para por qué su respuesta se verifica con el saldo corriente en vez de
 * creerse.
 *
 * **Nunca lanza.** Sin consejo, el documento se queda con la lectura que ya
 * tenía, que es exactamente donde estaba antes de que existiera este adaptador.
 */
export class OpenRouterColumnAdvisorAdapter implements StatementColumnAdvisorPort {
  private readonly logger = new Logger(OpenRouterColumnAdvisorAdapter.name);

  public constructor(private readonly client: OpenRouterChatClient) {}

  public get provider(): string {
    return `openrouter:${this.client.model}`;
  }

  public async advise(request: ColumnAdviceRequest): Promise<ColumnAdvice | null> {
    if (request.unknownLabels.length === 0) return null;

    try {
      const { output } = await this.client.complete({
        system: SYSTEM_PROMPT,
        user: JSON.stringify({
          rotulosDesconocidos: request.unknownLabels,
          rotulosYaReconocidos: request.knownLabels,
        }),
        schemaName: 'statement_column_advice',
        schema: buildSchema(request.unknownLabels),
      });
      return adviceOf(output, request.unknownLabels);
    } catch (error: unknown) {
      const motivo = error instanceof Error ? error.message : 'fallo desconocido';
      this.logger.warn(
        `No se pudo consultar el mapeo de columnas (${motivo}); ` +
          'el extracto se queda con la lectura del diccionario.',
      );
      return null;
    }
  }
}

const CAMPOS: readonly CanonicalField[] = [
  'transactionDate',
  'valueDate',
  'time',
  'description',
  'reference',
  'documentNumber',
  'debit',
  'credit',
  'amount',
  'balance',
  'currency',
  'channel',
  'branch',
  'movementType',
];

function adviceOf(output: Record<string, unknown>, unknownLabels: readonly string[]): ColumnAdvice {
  const advice = new Map<string, CanonicalField>();
  const asignaciones = output.asignaciones;
  if (!Array.isArray(asignaciones)) return advice;

  const permitidos = new Set<string>(unknownLabels);
  for (const entrada of asignaciones) {
    if (typeof entrada !== 'object' || entrada === null) continue;
    const { rotulo, campo } = entrada as { rotulo?: unknown; campo?: unknown };
    // Sólo se acepta lo que se preguntó y un papel del catálogo cerrado: un
    // rótulo inventado se convertiría en un alias que no casa con nada, y un
    // campo inventado en un `CanonicalField` que el resto del motor no conoce.
    if (typeof rotulo !== 'string' || !permitidos.has(rotulo)) continue;
    if (typeof campo !== 'string' || campo === 'desconocido') continue;
    if (!CAMPOS.includes(campo as CanonicalField)) continue;
    advice.set(rotulo, campo as CanonicalField);
  }
  return advice;
}

function buildSchema(unknownLabels: readonly string[]): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['asignaciones'],
    properties: {
      asignaciones: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['rotulo', 'campo'],
          properties: {
            rotulo: { type: 'string', enum: [...unknownLabels] },
            campo: { type: 'string', enum: [...CAMPOS, 'desconocido'] },
          },
        },
      },
    },
  };
}

const SYSTEM_PROMPT = [
  'Recibes los rótulos de la cabecera de la tabla de movimientos de un extracto bancario',
  'boliviano. Di qué papel juega cada uno de los rótulos desconocidos.',
  '',
  'No ves las filas y no las necesitas: el rótulo dice qué hay debajo.',
  '',
  'Distinciones que se confunden y aquí importan:',
  '- balance es el SALDO acumulado tras el movimiento; amount es el importe DEL movimiento.',
  '- debit y credit son dos columnas separadas de importe con signo implícito. Si sólo hay una',
  '  columna de importe, es amount, no debit.',
  '- valueDate es la fecha valor y transactionDate la del movimiento. Si sólo hay una, es',
  '  transactionDate.',
  '- reference y documentNumber son identificadores del asiento, no importes.',
  '',
  'Responde "desconocido" cuando no estés seguro. Un rótulo sin asignar deja el extracto como',
  'estaba; un rótulo mal asignado produce un extracto plausible y falso.',
].join('\n');
