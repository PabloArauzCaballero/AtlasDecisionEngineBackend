import { ConfigService } from '@nestjs/config';
import { OpenRouterChatClient } from '../../../common/llm/openrouter-chat.client';
import type { StatementColumnAdvisorPort } from './core/engine/generic/column-advisor';
import type { SimilarityMode } from './core/engine/similarity/similarity-scorer';
import { OpenRouterColumnAdvisorAdapter } from './core/infrastructure/openrouter-column-advisor.adapter';
import type { createStatementEngine } from './core/statement-engine';
import type { InstitutionCatalogService } from './institutions/institution-catalog.service';

type StatementEngineOptions = Parameters<typeof createStatementEngine>[0];

/**
 * El modelo por omisión del consejero de columnas.
 *
 * La tarea es corta y de vocabulario —mapear diez rótulos a un catálogo
 * cerrado—, y su respuesta la verifica la aritmética. No hace falta un modelo
 * caro y, sobre todo, no lo compensaría: uno mejor acertaría más veces la
 * asignación que el saldo ya iba a confirmar de todos modos.
 */
const DEFAULT_COLUMN_ADVISOR_MODEL = 'openai/gpt-4.1-mini';

/**
 * La configuración del motor de extractos que sale del entorno, para UN tenant.
 *
 * La comparten el worker de fondo y el nodo `WORKER` del grafo: son dos caminos hacia el mismo
 * núcleo y las perillas de las compuertas no pueden diverger entre ellos. Cada uno conserva su
 * propia caché de motores (uno por tenant: el padrón de entidades es tenant-scoped).
 */
export function statementEngineOptions(
  config: ConfigService,
  institutions: InstitutionCatalogService,
  tenantId: bigint,
): StatementEngineOptions {
  return {
    limits: {
      maxFileSizeBytes: config.get<number>('BANK_STATEMENT_MAX_UPLOAD_BYTES') ?? 10_485_760,
      maxPageCount: 60,
      processingTimeoutMs: config.get<number>('BANK_STATEMENT_TIMEOUT_MS') ?? 60_000,
    },
    // Las fronteras del triage se leen del entorno y no se compilan: son lo
    // primero que hay que recalibrar cuando entren documentos reales.
    triage: {
      accept: config.get<number>('BANK_STATEMENT_DOCUMENT_ACCEPT_CONFIDENCE'),
      review: config.get<number>('BANK_STATEMENT_DOCUMENT_REVIEW_CONFIDENCE'),
    },
    // El padrón administrable del tenant, resuelto en cada documento: revocar
    // una licencia desde el portal no puede exigir reiniciar el worker.
    institutions: institutions.registryFor(tenantId),
    issuerGate: {
      requireLicensedIssuer: config.get<boolean>('BANK_STATEMENT_REQUIRE_LICENSED_ISSUER') ?? true,
    },
    /*
     * La compuerta del contenedor también sale del entorno. Era la única de las
     * cuatro sin perillas, y es la que más documentos legítimos detenía: un PDF
     * reabierto en Vista Previa de macOS declara `Quartz PDFContext` y puntúa 85
     * —rechazo— sin que su contenido tenga nada de malo.
     */
    authenticityGate: {
      enforce: config.get<boolean>('BANK_STATEMENT_AUTHENTICITY_ENFORCE') ?? true,
      rejectScore: config.get<number>('BANK_STATEMENT_AUTHENTICITY_REJECT_SCORE') ?? 70,
      reviewScore: config.get<number>('BANK_STATEMENT_AUTHENTICITY_REVIEW_SCORE') ?? 30,
    },
    affordability: {
      enforceMinimumMonths: config.get<boolean>('BANK_STATEMENT_ENFORCE_MINIMUM_MONTHS') ?? false,
    },
    recencyGate: {
      enforce: config.get<boolean>('BANK_STATEMENT_RECENCY_ENFORCE') ?? true,
      toleranceDays: config.get<number>('BANK_STATEMENT_RECENCY_TOLERANCE_DAYS') ?? 3,
      futureToleranceDays: config.get<number>('BANK_STATEMENT_RECENCY_FUTURE_TOLERANCE_DAYS') ?? 3,
    },
    similarityMode: config.get<SimilarityMode>('BANK_STATEMENT_SIMILARITY_MODE') ?? 'CORROBORATE',
    similarity: {
      matchScore: config.get<number>('BANK_STATEMENT_SIMILARITY_MATCH_SCORE') ?? 70,
      partialScore: config.get<number>('BANK_STATEMENT_SIMILARITY_PARTIAL_SCORE') ?? 35,
      minimumSampleSize: config.get<number>('BANK_STATEMENT_SIMILARITY_MIN_SAMPLE') ?? 3,
    },
  };
}

/**
 * El consejero de columnas del motor generalista, si el despliegue lo encendió.
 *
 * Apagado por omisión, y con su propia bandera aunque comparta credencial con
 * el resto: lo que sale de aquí son RÓTULOS de cabecera, no filas ni importes,
 * pero sigue siendo un extracto de una persona el que se está leyendo y esa
 * decisión la toma quien despliega, no quien programa.
 *
 * Sin credencial se queda apagado en silencio: sin consejo, el documento se
 * lee exactamente como se leía antes.
 */
export function columnAdvisorOption(config: ConfigService): {
  columnAdvisor?: StatementColumnAdvisorPort;
} {
  if (config.get<boolean>('BANK_STATEMENT_COLUMN_ADVISOR_ENABLED') !== true) return {};
  const apiKey = config.get<string>('OPENROUTER_API_KEY') ?? '';
  if (apiKey === '') return {};

  const baseUrl = config.get<string>('OPENROUTER_BASE_URL');
  const timeoutMs = config.get<number>('OPENROUTER_TIMEOUT_MS');
  return {
    columnAdvisor: new OpenRouterColumnAdvisorAdapter(
      new OpenRouterChatClient({
        apiKey,
        model:
          config.get<string>('BANK_STATEMENT_COLUMN_ADVISOR_MODEL') ?? DEFAULT_COLUMN_ADVISOR_MODEL,
        ...(baseUrl === undefined ? {} : { baseUrl }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      }),
    ),
  };
}
