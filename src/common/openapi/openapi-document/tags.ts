import type { OpenAPIObject } from '@nestjs/swagger';

/**
 * Redocly exige que toda etiqueta usada esté declarada globalmente, y con razón: sin la
 * declaración el visor no puede ordenar ni describir las secciones. Se derivan de las
 * etiquetas realmente usadas en vez de mantenerse a mano, para que una etiqueta nueva no
 * exija recordar un segundo sitio donde registrarla.
 */
/**
 * Qué hace cada sección de la API. Un visor sin esto muestra una lista de nombres sin
 * contexto, y el integrador tiene que abrir endpoints al azar para entender qué agrupa cada
 * uno. Una etiqueta nueva sin entrada aquí sale sin descripción y Redocly lo avisa.
 */
const TAG_DESCRIPTIONS: Record<string, string> = {
  Health: 'Sondas de vida y disponibilidad para el orquestador. Públicas y sin límite de tasa.',
  'Portal Session': 'Inicio y cierre de sesión del portal contra el proveedor de identidad.',
  'Variable Catalog':
    'Catálogo global de variables y sus versiones inmutables, con contrato, restricciones y ejemplos (§1).',
  'Approved Libraries':
    'Registro de librerías autorizadas. Una fila solo HABILITA un prelude ya revisado en el repositorio (§7).',
  'Calculated Fields':
    'Funciones pequeñas, gobernadas y reutilizables, con contrato de retorno obligatorio (§5–§8).',
  'Decision Artifacts':
    'Algoritmos de decisión, sus versiones y el grafo que las define. Solo un borrador es editable.',
  'Nested Decision Trees':
    'Referencias de un artefacto a otro, con presupuesto, reintentos y política de fallo (§9).',
  'Code to Flow Import':
    'Importación de código existente y su conversión asistida a un grafo (§5).',
  'Decision Testing': 'Suites de regresión, casos y corridas deterministas por versión.',
  'QA Lab': 'Generación masiva guiada por contrato y contraejemplos reproducibles (§10).',
  'Decision Governance':
    'Envío a revisión, aprobaciones y segregación de funciones sobre una versión.',
  'Decision Deployments': 'Ambientes, despliegues activos y reversión a una versión anterior.',
  'Decision Runtime': 'Ejecución en línea de una decisión, idempotente y con evidencia persistida.',
  'Decision Simulation':
    'Ejecución de prueba sin persistir nada, con comparación opcional contra PROD (§12).',
  'Live Execution': 'Vista paso a paso de una ejecución no productiva por SSE. Opt-in.',
  'Manual Review': 'Cola de casos derivados a revisión humana y su resolución.',
  Notifications: 'Bandeja persistente alimentada por el outbox transaccional.',
  'Audit and Observability':
    'Consulta de ejecuciones y de la cadena de auditoría append-only, y su verificación.',
  'Requirements Traceability': 'Objetivos de negocio y su cobertura por artefactos y pruebas.',
  'Security Review': 'Revisión de seguridad de una versión antes de su promoción.',
  'Read Model Views': 'Vistas de solo lectura que alimentan catálogos y selectores del portal.',
  Tutorials: 'Contenido guiado del portal.',
  Observability: 'Exposición de métricas Prometheus, protegida por token.',
  Workers:
    'Catálogo de los workers adicionales, con sus límites y su disponibilidad en este despliegue (ADR-0026).',
  'Workers · Análisis semántico':
    'Clasificación de texto libre contra el catálogo de categorías, con entidades y evidencia. Asíncrono: se encola y se consulta.',
  'Workers · Extractos bancarios':
    'Conversión de un extracto bancario en PDF a movimientos normalizados. Asíncrono; el documento no se conserva y la cuenta se publica enmascarada.',
};

export function declareGlobalTags(document: OpenAPIObject): void {
  const used = new Set<string>();
  for (const item of Object.values(document.paths ?? {})) {
    for (const operation of Object.values(item ?? {})) {
      if (operation && typeof operation === 'object' && 'tags' in operation) {
        for (const tag of (operation as { tags?: string[] }).tags ?? []) used.add(tag);
      }
    }
  }
  const declared = new Map((document.tags ?? []).map((tag) => [tag.name, tag]));
  document.tags = [...used]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const existing = declared.get(name);
      const description = TAG_DESCRIPTIONS[name];
      return description ? { name, description, ...existing } : (existing ?? { name });
    });
}
