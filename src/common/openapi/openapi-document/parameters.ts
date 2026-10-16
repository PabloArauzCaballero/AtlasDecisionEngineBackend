import type { OpenAPIObject } from '@nestjs/swagger';

/**
 * Descripción de los parámetros que se repiten por toda la API.
 *
 * `versionId` aparece en 23 operaciones, `search` en 7, `status` en 7. Documentarlos endpoint
 * a endpoint significaba más de cincuenta decoradores que dirían lo mismo y que el siguiente
 * endpoint volvería a olvidar. Aquí se declaran una vez, se aplican por nombre y un parámetro
 * nuevo lo hereda sin que nadie se acuerde.
 *
 * NO pisa una descripción existente: si un endpoint documentó su parámetro con algo más
 * preciso —porque en su contexto significa algo distinto— ese texto gana. Y un nombre que no
 * esté aquí sigue saliendo como aviso de Redocly, que es la presión que mantiene la lista viva.
 */
const COMMON_PARAMETER_DESCRIPTIONS: Record<string, string> = {
  // --- Identificadores de ruta ---
  versionId: 'Identificador de la versión del artefacto.',
  artifactId: 'Identificador del artefacto de decisión.',
  artifactCode: 'Código único del artefacto en el tenant (p. ej. `BNPL_CREDIT_DECISION`).',
  definitionId: 'Identificador de la definición de variable del catálogo.',
  fieldId: 'Identificador del campo calculado.',
  suiteId: 'Identificador de la suite de pruebas.',
  runId: 'Identificador de la corrida.',
  caseId: 'Identificador del caso de revisión manual.',
  policyId: 'Identificador del requisito de política.',
  objectiveId: 'Identificador del objetivo de negocio.',
  executionId: 'Identificador de la ejecución de decisión.',
  deploymentId: 'Identificador del despliegue.',
  requestId:
    'Identificador de correlación de la petición; el mismo que viaja en la cabecera `x-request-id`.',
  referenceId: 'Identificador de la referencia a otro artefacto.',
  counterexampleId: 'Identificador del contraejemplo archivado.',
  tutorialId: 'Identificador del tutorial.',
  leftVersionId: 'Versión que se toma como lado izquierdo de la comparación.',
  rightVersionId: 'Versión que se toma como lado derecho de la comparación.',
  id: 'Identificador del recurso.',

  // --- Filtros de consulta ---
  page: 'Página solicitada, empezando en 1.',
  pageSize: 'Elementos por página; se acota por `MAX_PAGE_SIZE`.',
  cursor:
    'Cursor opaco devuelto como `nextCursor` por la página anterior. Ausente en la primera página.',
  search: 'Coincidencia parcial sobre el código o el nombre del recurso.',
  status: 'Filtra por estado exacto del recurso.',
  category: 'Filtra por categoría del catálogo.',
  environmentCode: 'Ambiente de decisión (`DEV`, `STAGING`, `TEST`, `PROD`).',
  eventType: 'Filtra por tipo de evento.',
  from: 'Límite inferior del rango temporal, inclusive (ISO 8601).',
  to: 'Límite superior del rango temporal, inclusive (ISO 8601).',
  usage: 'Sentido en que los algoritmos usan la variable: `INPUT` u `OUTPUT`.',
  language: 'Filtra por lenguaje de implementación.',
  environment: 'Filtra por ambiente en el que el recurso está habilitado.',
  unreadOnly: 'Devuelve solo las notificaciones sin leer.',
  artifactVersionId: 'Acota el resultado a una versión concreta.',
  actorId: 'Filtra por el principal que provocó el hecho.',
  aggregateType: 'Filtra por el tipo de agregado al que pertenece el evento.',
  outcome: 'Filtra por el resultado de negocio de la decisión.',
  subjectReference:
    'Referencia del sujeto de la decisión. Se compara contra su HMAC: el valor en claro no se persiste.',
  queueCode: 'Cola de revisión manual a la que pertenece el caso.',
  assignedTo: 'Filtra por el analista al que está asignado el caso.',
  implementationKind: 'Modalidad de implementación: `OPERATION`, `JAVASCRIPT` o `PYTHON`.',
  stepId: 'Identificador del paso de la traza de ejecución.',
  group: 'Grupo de opciones del catálogo que se quiere resolver.',
  q: 'Término de búsqueda libre.',
  limit: 'Máximo de elementos devueltos.',
};

export function describeCommonParameters(document: OpenAPIObject): void {
  for (const item of Object.values(document.paths ?? {})) {
    for (const operation of Object.values(item ?? {})) {
      if (!operation || typeof operation !== 'object' || !('parameters' in operation)) continue;
      for (const parameter of (operation as { parameters?: unknown[] }).parameters ?? []) {
        if (!parameter || typeof parameter !== 'object') continue;
        const target = parameter as { name?: string; description?: string };
        if (target.description || !target.name) continue;
        const description = COMMON_PARAMETER_DESCRIPTIONS[target.name];
        if (description) target.description = description;
      }
    }
  }
}
