import { Injectable, Logger } from '@nestjs/common';
import type { OpenRouterChatClient } from '../../../../../common/llm/openrouter-chat.client';
import type {
  IdentitySecondReaderPort,
  SecondReadingProposal,
  SecondReadingRequest,
} from '../ports/identity.ports';

/**
 * El segundo lector de campos del carnet, contra un modelo multimodal.
 *
 * **Sólo se le pregunta por lo que falta.** La petición lleva `missingFields` y
 * el prompt le pide exactamente esos: un modelo al que se le pide todo devuelve
 * todo, y cada campo de más es una ocasión de contradecir una lectura correcta
 * sin aportar nada. Además cuesta tokens en el camino caliente.
 *
 * **Nunca lanza.** Que el segundo lector no esté disponible no es un fallo del
 * caso: el caso ya estaba incompleto antes de preguntarle, y sin él vuelve
 * exactamente a donde estaba —la bandeja humana—. Un `throw` aquí convertiría
 * una mejora opcional en un punto único de fallo del worker de identidad, que
 * es la forma más cara de perder una función que se puede apagar.
 *
 * **Aquí SÍ viaja la imagen del documento**, a diferencia del árbitro de la
 * franja de duda. Es una decisión de tratamiento de datos, no un detalle: por
 * eso vive detrás de su propia bandera (`IDENTITY_SECOND_READER_ENABLED`,
 * apagada por omisión) y no se enciende al encender el arbitraje.
 */
@Injectable()
export class OpenRouterSecondReaderAdapter implements IdentitySecondReaderPort {
  private readonly logger = new Logger(OpenRouterSecondReaderAdapter.name);

  public constructor(private readonly client: OpenRouterChatClient) {}

  public get provider(): string {
    return `openrouter:${this.client.model}`;
  }

  public async read(request: SecondReadingRequest): Promise<SecondReadingProposal | null> {
    if (request.images.length === 0 || request.missingFields.length === 0) return null;

    try {
      const { output } = await this.client.complete({
        system: SYSTEM_PROMPT,
        user: `Devuelve únicamente estos campos: ${request.missingFields.join(', ')}.`,
        images: request.images,
        schemaName: 'identity_second_reading',
        schema: SECOND_READING_SCHEMA,
      });
      return proposalOf(output, request.missingFields);
    } catch (error: unknown) {
      const motivo = error instanceof Error ? error.message : 'fallo desconocido';
      this.logger.warn(
        `El segundo lector no pudo releer ${request.correlationId}: ${motivo}. ` +
          'El caso sigue con los campos que sacó el OCR.',
      );
      return null;
    }
  }

  public async health(): Promise<{ ready: boolean; detail?: string }> {
    const credits = await this.client.credits();
    return { ready: credits.ok, detail: `${this.client.model} · ${credits.detail}` };
  }
}

/**
 * Se lee lo pedido y nada más.
 *
 * Un modelo que devuelve un campo que no se le pidió está rellenando huecos por
 * su cuenta, que es justo lo que no queremos de él; descartarlo aquí es más
 * barato que descubrirlo en la reconciliación.
 */
function proposalOf(
  output: Record<string, unknown>,
  missingFields: readonly string[],
): SecondReadingProposal {
  const proposal: Record<string, string> = {};
  for (const clave of missingFields) {
    const valor = output[clave];
    if (typeof valor === 'string' && valor.trim().length > 0 && valor.trim() !== 'NO_LEGIBLE') {
      proposal[clave] = valor.trim();
    }
  }
  return proposal as SecondReadingProposal;
}

const SYSTEM_PROMPT = [
  'Transcribes campos de una cédula de identidad boliviana a partir de sus fotos.',
  'No interpretas, no completas y no corriges: copias lo que está impreso.',
  '',
  'Reglas:',
  '- Si un campo no se lee con certeza, responde exactamente NO_LEGIBLE. Adivinar un dígito es',
  '  peor que no contestar: hay un dígito de control que va a delatar la invención, y mientras',
  '  tanto le habrás puesto a una persona el número de otra.',
  '- Las fechas van en formato YYYY-MM-DD.',
  '- Una cédula que no caduca dice INDEFINIDO en su fecha de vencimiento. Si eso es lo que está',
  '  impreso, responde INDEFINIDO y no la fecha de emisión.',
  '- El número puede llevar complemento alfanumérico (por ejemplo 1234567-1A). Cópialo entero.',
  '- No confundas el número de la cédula con el número del domicilio.',
].join('\n');

const CAMPOS = ['documentNumber', 'firstNames', 'lastNames', 'dateOfBirth', 'expirationDate'];

const SECOND_READING_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  // `strict: true` de OpenAI exige que todo esté en `required`; el valor
  // ausente se expresa con NO_LEGIBLE, no omitiendo la clave.
  required: CAMPOS,
  properties: Object.fromEntries(
    CAMPOS.map((campo) => [campo, { type: 'string', maxLength: 120 }]),
  ),
};
