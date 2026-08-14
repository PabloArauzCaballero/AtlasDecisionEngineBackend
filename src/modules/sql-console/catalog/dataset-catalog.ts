/**
 * El catálogo de la consola SQL: qué se puede consultar y cómo se llama.
 *
 * Este archivo es la ÚNICA verdad sobre la superficie de consulta, y lo es para tres
 * consumidores a la vez:
 *
 *  1. El explorador del portal lo pinta como árbol (dataset → tabla → columna).
 *  2. La guardia (`sql-guard.ts`) lo usa como lista blanca: una consulta que nombre algo
 *     que no esté aquí se rechaza ANTES de tocar la base.
 *  3. El autocompletado del editor se alimenta de él.
 *
 * Que sean los tres el mismo dato no es economía de código, es la propiedad que importa:
 * si el explorador enseña una tabla, la guardia la admite y el autocompletado la sugiere,
 * los tres por construcción. La alternativa —tres listas paralelas— produce el fallo más
 * confuso posible en una consola: una tabla que el árbol muestra y el motor dice que no
 * existe.
 *
 * El espejo del SQL está en `20260814090000_sql_console_governed_views`. La prueba
 * `dataset-catalog.integration.spec.ts` consulta `information_schema` y exige que ambos
 * coincidan columna a columna: describir aquí una columna que la vista no publica sería
 * documentar una mentira, y es el error que un catálogo escrito a mano comete solo.
 */

/** Tipo de dato tal y como se le presenta a quien consulta, no el tipo de Postgres. */
export type ColumnKind = 'texto' | 'numero' | 'entero' | 'booleano' | 'fecha' | 'identificador';

export interface CatalogColumn {
  readonly name: string;
  readonly kind: ColumnKind;
  readonly description: string;
}

export interface CatalogTable {
  readonly name: string;
  readonly description: string;
  /** Frase que explica qué es UNA fila. Sin esto, un `COUNT(*)` se interpreta mal. */
  readonly grain: string;
  readonly columns: readonly CatalogColumn[];
}

export interface CatalogDataset {
  readonly name: string;
  readonly description: string;
  readonly tables: readonly CatalogTable[];
}

const id = (name: string, description: string): CatalogColumn => ({
  name,
  kind: 'identificador',
  description,
});

const decisiones: CatalogDataset = {
  name: 'decisiones',
  description: 'Qué decidió el motor, cuándo, con qué versión y por qué.',
  tables: [
    {
      name: 'ejecuciones',
      description:
        'Una fila por decisión tomada. No lleva la entrada ni la salida en claro: para leer una ' +
        'ejecución concreta está /executions, que enmascara según el rol de quien mira.',
      grain: 'Una fila = una decisión ejecutada por el motor.',
      columns: [
        id('ejecucion_id', 'Identificador de la ejecución. Une con pasos, motivos y errores.'),
        { name: 'peticion', kind: 'texto', description: 'Identificador de la petición del integrador.' },
        { name: 'correlacion', kind: 'texto', description: 'Correlación entre sistemas, si el integrador la mandó.' },
        { name: 'artefacto', kind: 'texto', description: 'Código del artefacto que decidió.' },
        { name: 'artefacto_nombre', kind: 'texto', description: 'Nombre legible del artefacto.' },
        { name: 'dominio_de_riesgo', kind: 'texto', description: 'Dominio de riesgo del artefacto.' },
        { name: 'tipo_de_decision', kind: 'texto', description: 'ORIGINATION, LIMIT_CHANGE, COLLECTION…' },
        { name: 'version', kind: 'entero', description: 'Número de versión del artefacto.' },
        { name: 'version_semantica', kind: 'texto', description: 'Versión semántica publicada.' },
        { name: 'entorno', kind: 'texto', description: 'Código del entorno donde se ejecutó.' },
        { name: 'es_produccion', kind: 'booleano', description: 'Si ese entorno es productivo.' },
        { name: 'estado', kind: 'texto', description: 'APPROVED, REJECTED, MANUAL_REVIEW, ERROR…' },
        { name: 'desenlace_de_negocio', kind: 'texto', description: 'Desenlace declarado por el artefacto.' },
        { name: 'duracion_ms', kind: 'entero', description: 'Cuánto tardó la decisión, en milisegundos.' },
        {
          name: 'entradas_degradadas',
          kind: 'booleano',
          description:
            'Alguna variable entró más vieja que su SLA. La decisión vale; lo que no vale es ' +
            'confundirla con una tomada sobre datos frescos.',
        },
        id('sujeto_id', 'Solicitante en seudónimo. Nunca su referencia real.'),
        {
          name: 'motivo_sin_sujeto',
          kind: 'texto',
          description: 'Por qué no hay sujeto: WARN (no lo mandaron) o NOT_APPLICABLE (no aplica).',
        },
        { name: 'ejecutada_en', kind: 'fecha', description: 'Momento de la ejecución.' },
      ],
    },
    {
      name: 'pasos',
      description:
        'El recorrido por el grafo, nodo a nodo. El resultado evaluado de cada nodo no se ' +
        'publica: lleva dentro los valores con los que se evaluó.',
      grain: 'Una fila = un nodo atravesado por una ejecución.',
      columns: [
        id('ejecucion_id', 'Ejecución a la que pertenece el paso.'),
        { name: 'orden', kind: 'entero', description: 'Posición del paso dentro del recorrido.' },
        { name: 'nodo', kind: 'texto', description: 'Clave del nodo dentro del grafo.' },
        { name: 'tipo_de_nodo', kind: 'texto', description: 'CONDITION, RESULT, SUBGRAPH…' },
        { name: 'nodo_etiqueta', kind: 'texto', description: 'Etiqueta legible del nodo.' },
        { name: 'es_terminal', kind: 'booleano', description: 'Si el nodo cierra el recorrido.' },
        { name: 'rama_tomada', kind: 'texto', description: 'Rama por la que salió la evaluación.' },
        { name: 'duracion_us', kind: 'entero', description: 'Duración del paso, en microsegundos.' },
      ],
    },
    {
      name: 'motivos',
      description:
        'Por qué se decidió así. El mensaje ya interpolado no se publica —puede citar datos ' +
        'del solicitante—; el mensaje plantilla está en catalogo.motivos.',
      grain: 'Una fila = un motivo emitido por una ejecución.',
      columns: [
        id('ejecucion_id', 'Ejecución que emitió el motivo.'),
        { name: 'codigo', kind: 'texto', description: 'Código del motivo.' },
        { name: 'categoria', kind: 'texto', description: 'Categoría del motivo.' },
        { name: 'severidad', kind: 'texto', description: 'Severidad declarada en el catálogo.' },
        {
          name: 'es_accion_adversa',
          kind: 'booleano',
          description: 'Si el motivo es notificable como acción adversa al solicitante.',
        },
        { name: 'prioridad', kind: 'entero', description: 'Orden de presentación del motivo.' },
      ],
    },
    {
      name: 'errores',
      description:
        'Fallos ocurridos durante la ejecución. Sin el mensaje ni el detalle: los dos pueden ' +
        'citar el valor que provocó el fallo.',
      grain: 'Una fila = un error registrado en una ejecución.',
      columns: [
        id('ejecucion_id', 'Ejecución donde ocurrió el error.'),
        { name: 'codigo', kind: 'texto', description: 'Código del error.' },
        { name: 'tipo', kind: 'texto', description: 'Familia del error.' },
        { name: 'reintentable', kind: 'booleano', description: 'Si el motor lo considera transitorio.' },
      ],
    },
  ],
};

const catalogo: CatalogDataset = {
  name: 'catalogo',
  description: 'Las piezas con las que se decide: artefactos, versiones, variables y motivos.',
  tables: [
    {
      name: 'artefactos',
      description: 'Los algoritmos de decisión dados de alta.',
      grain: 'Una fila = un artefacto.',
      columns: [
        id('artefacto_id', 'Identificador del artefacto.'),
        { name: 'codigo', kind: 'texto', description: 'Código único del artefacto.' },
        { name: 'nombre', kind: 'texto', description: 'Nombre legible.' },
        { name: 'tipo', kind: 'texto', description: 'Tipo de artefacto.' },
        { name: 'tipo_de_decision', kind: 'texto', description: 'Qué clase de decisión toma.' },
        { name: 'dominio_de_riesgo', kind: 'texto', description: 'Dominio de riesgo.' },
        { name: 'equipo_responsable', kind: 'texto', description: 'Equipo dueño del artefacto.' },
        { name: 'activo', kind: 'booleano', description: 'Si sigue vigente en el catálogo.' },
        { name: 'creado_en', kind: 'fecha', description: 'Alta del artefacto.' },
        { name: 'actualizado_en', kind: 'fecha', description: 'Última modificación.' },
      ],
    },
    {
      name: 'versiones',
      description:
        'Ciclo de vida de cada versión. `revalidacion_vence_en` es la columna con la que se ' +
        'encuentra un modelo operando fuera de su licitud vigente.',
      grain: 'Una fila = una versión de un artefacto.',
      columns: [
        id('version_id', 'Identificador de la versión.'),
        { name: 'artefacto', kind: 'texto', description: 'Código del artefacto al que pertenece.' },
        { name: 'version', kind: 'entero', description: 'Número de versión.' },
        { name: 'version_semantica', kind: 'texto', description: 'Versión semántica.' },
        { name: 'estado', kind: 'texto', description: 'DRAFT, IN_REVIEW, APPROVED, RETIRED…' },
        { name: 'base_legal', kind: 'texto', description: 'Base legal declarada para el tratamiento.' },
        { name: 'validada_por', kind: 'texto', description: 'Quién validó el modelo.' },
        { name: 'validada_en', kind: 'fecha', description: 'Cuándo se validó.' },
        { name: 'revalidacion_vence_en', kind: 'fecha', description: 'Cuándo caduca esa validación.' },
        { name: 'creada_por', kind: 'texto', description: 'Autor de la versión.' },
        { name: 'creada_en', kind: 'fecha', description: 'Alta de la versión.' },
        { name: 'aprobada_en', kind: 'fecha', description: 'Momento de la aprobación.' },
        { name: 'retirada_en', kind: 'fecha', description: 'Momento del retiro.' },
      ],
    },
    {
      name: 'variables',
      description:
        'El catálogo de variables. `restriccion_de_uso` distingue la variable que no puede ' +
        'entrar en una decisión de la que sí.',
      grain: 'Una fila = una variable del catálogo.',
      columns: [
        id('variable_id', 'Identificador de la variable.'),
        { name: 'codigo', kind: 'texto', description: 'Código técnico estable.' },
        { name: 'nombre', kind: 'texto', description: 'Nombre canónico.' },
        { name: 'clasificacion', kind: 'texto', description: 'Clasificación del dato.' },
        { name: 'sensibilidad', kind: 'texto', description: 'PUBLIC, INTERNAL, CONFIDENTIAL, RESTRICTED.' },
        { name: 'ciclo_de_vida', kind: 'texto', description: 'ACTIVE, DEPRECATED, RETIRED.' },
        {
          name: 'restriccion_de_uso',
          kind: 'texto',
          description: 'Licitud de uso en una decisión: NONE, PROHIBITED, REQUIRES_JUSTIFICATION…',
        },
        { name: 'equipo_responsable', kind: 'texto', description: 'Equipo dueño de la variable.' },
        { name: 'es_sensible', kind: 'booleano', description: 'Bandera derivada de la sensibilidad.' },
        { name: 'activa', kind: 'booleano', description: 'Si sigue disponible para nuevos contratos.' },
      ],
    },
    {
      name: 'motivos',
      description:
        'Catálogo de códigos de motivo. Se publica el mensaje público —el que ve el ' +
        'solicitante— y no el interno.',
      grain: 'Una fila = un código de motivo.',
      columns: [
        id('motivo_id', 'Identificador del motivo.'),
        { name: 'codigo', kind: 'texto', description: 'Código del motivo.' },
        { name: 'categoria', kind: 'texto', description: 'Categoría.' },
        { name: 'severidad', kind: 'texto', description: 'Severidad.' },
        { name: 'es_accion_adversa', kind: 'booleano', description: 'Si es notificable como acción adversa.' },
        { name: 'activo', kind: 'booleano', description: 'Si sigue vigente.' },
        { name: 'mensaje_publico', kind: 'texto', description: 'Mensaje que se le comunica al solicitante.' },
      ],
    },
  ],
};

const desenlaces: CatalogDataset = {
  name: 'desenlaces',
  description: 'Qué pasó DESPUÉS de decidir: créditos, ventanas de observación y desenlaces.',
  tables: [
    {
      name: 'creditos',
      description:
        'Créditos originados. La referencia externa no se publica: es con la que el negocio ' +
        'identifica a la persona.',
      grain: 'Una fila = un crédito.',
      columns: [
        id('credito_id', 'Identificador del crédito.'),
        id('sujeto_id', 'Solicitante en seudónimo.'),
        id('ejecucion_de_originacion', 'Ejecución que originó el crédito, si la hubo.'),
        { name: 'principal', kind: 'numero', description: 'Monto principal.' },
        { name: 'moneda', kind: 'texto', description: 'Moneda ISO-4217.' },
        { name: 'plazo_meses', kind: 'entero', description: 'Plazo en meses.' },
        { name: 'tasa_anual', kind: 'numero', description: 'Tasa anual pactada.' },
        { name: 'desembolsado_en', kind: 'fecha', description: 'Fecha de desembolso.' },
        { name: 'cerrado_en', kind: 'fecha', description: 'Fecha de cierre.' },
        { name: 'creado_en', kind: 'fecha', description: 'Alta del registro.' },
      ],
    },
    {
      name: 'observaciones',
      description:
        'El desenlace observado de cada decisión. Es la tabla contra la que se mide si el ' +
        'modelo acierta.',
      grain: 'Una fila = un desenlace observado para una ejecución y una ventana.',
      columns: [
        id('observacion_id', 'Identificador de la observación.'),
        id('ejecucion_id', 'Ejecución observada.'),
        id('credito_id', 'Crédito asociado, si lo hay.'),
        { name: 'ventana_dias', kind: 'entero', description: 'Ventana de observación, en días.' },
        { name: 'desenlace', kind: 'texto', description: 'GOOD, BAD, INDETERMINATE.' },
        { name: 'monto', kind: 'numero', description: 'Monto asociado al desenlace.' },
        { name: 'origen', kind: 'texto', description: 'De dónde salió la observación.' },
        { name: 'metodo_de_inferencia', kind: 'texto', description: 'Cómo se infirió, si no se observó directamente.' },
        { name: 'observado_en', kind: 'fecha', description: 'Cuándo se observó.' },
        { name: 'registrado_por', kind: 'texto', description: 'Quién lo registró.' },
      ],
    },
    {
      name: 'ventanas',
      description:
        'Ventanas de observación. `vencida_sin_observar` es la cola de trabajo de ' +
        '/decision-quality, ya calculada.',
      grain: 'Una fila = una ventana de observación programada para una ejecución.',
      columns: [
        id('ventana_id', 'Identificador de la ventana.'),
        id('ejecucion_id', 'Ejecución a observar.'),
        id('credito_id', 'Crédito asociado, si lo hay.'),
        { name: 'ventana_dias', kind: 'entero', description: 'Ventana en días.' },
        { name: 'vence_en', kind: 'fecha', description: 'Cuándo debe estar observada.' },
        { name: 'observada_en', kind: 'fecha', description: 'Cuándo se observó. Nulo si sigue abierta.' },
        {
          name: 'vencida_sin_observar',
          kind: 'booleano',
          description: 'Ventana pasada de plazo y todavía sin desenlace.',
        },
      ],
    },
  ],
};

const riesgo: CatalogDataset = {
  name: 'riesgo',
  description: 'Bajo qué condiciones se deja operar: cartera, límites y degradación del modelo.',
  tables: [
    {
      name: 'evaluaciones',
      description:
        'Degradación del modelo medida contra su umbral. `tamano_muestra` va al lado del ' +
        'valor a propósito: un veredicto sobre 12 casos no es el mismo hecho que uno sobre 12.000.',
      grain: 'Una fila = una métrica evaluada para una versión en un momento.',
      columns: [
        id('evaluacion_id', 'Identificador de la evaluación.'),
        { name: 'artefacto', kind: 'texto', description: 'Código del artefacto evaluado.' },
        { name: 'version', kind: 'entero', description: 'Versión evaluada.' },
        { name: 'metrica', kind: 'texto', description: 'Código de la métrica.' },
        { name: 'alcance', kind: 'texto', description: 'Segmento o población evaluada.' },
        { name: 'valor', kind: 'numero', description: 'Valor medido.' },
        { name: 'umbral', kind: 'numero', description: 'Umbral contra el que se compara.' },
        { name: 'veredicto', kind: 'texto', description: 'PASS, WARN, FAIL.' },
        { name: 'tamano_muestra', kind: 'entero', description: 'Observaciones sobre las que se midió.' },
        { name: 'evaluada_en', kind: 'fecha', description: 'Momento de la evaluación.' },
      ],
    },
    {
      name: 'cartera',
      description: 'Estado de la cartera declarado periódicamente.',
      grain: 'Una fila = una métrica de cartera para un segmento en una fecha.',
      columns: [
        { name: 'al_dia', kind: 'fecha', description: 'Fecha de corte.' },
        { name: 'metrica', kind: 'texto', description: 'Código de la métrica.' },
        { name: 'segmento', kind: 'texto', description: 'Segmento. Nulo cuando es la cartera entera.' },
        { name: 'valor', kind: 'numero', description: 'Valor declarado.' },
        { name: 'registrado_por', kind: 'texto', description: 'Quién lo registró.' },
      ],
    },
    {
      name: 'limites',
      description:
        '`bloquea` distingue el límite que RECHAZA del que sólo mide. Verlos iguales hace creer ' +
        'que la cartera está protegida cuando lo único que hay es un número guardado.',
      grain: 'Una fila = un límite de exposición por segmento.',
      columns: [
        { name: 'codigo', kind: 'texto', description: 'Código del límite.' },
        { name: 'segmento', kind: 'texto', description: 'Segmento. Nulo cuando aplica a todo.' },
        { name: 'valor_maximo', kind: 'numero', description: 'Techo declarado.' },
        { name: 'moneda', kind: 'texto', description: 'Moneda ISO-4217.' },
        { name: 'bloquea', kind: 'booleano', description: 'Si el límite rechaza o sólo mide.' },
        { name: 'activo', kind: 'booleano', description: 'Si está vigente.' },
        { name: 'creado_por', kind: 'texto', description: 'Quién lo fijó.' },
        { name: 'creado_en', kind: 'fecha', description: 'Cuándo se fijó.' },
      ],
    },
  ],
};

const auditoria: CatalogDataset = {
  name: 'auditoria',
  description: 'Quién hizo qué: eventos firmados y despliegues.',
  tables: [
    {
      name: 'eventos',
      description:
        'La bitácora firmada, sin el contenido ni los hashes. Aquí se consulta QUÉ pasó y ' +
        'cuándo; verificar la cadena es /audit/chain/verify, que es donde esa comprobación ' +
        'significa algo.',
      grain: 'Una fila = un evento de auditoría.',
      columns: [
        id('evento_id', 'Identificador del evento.'),
        { name: 'tipo', kind: 'texto', description: 'Tipo de evento.' },
        { name: 'entidad_tipo', kind: 'texto', description: 'Clase de entidad afectada.' },
        { name: 'entidad_id', kind: 'texto', description: 'Identificador de la entidad afectada.' },
        { name: 'actor', kind: 'texto', description: 'Quién lo provocó.' },
        { name: 'peticion', kind: 'texto', description: 'Petición que lo originó.' },
        { name: 'ocurrido_en', kind: 'fecha', description: 'Momento del evento.' },
      ],
    },
    {
      name: 'despliegues',
      description: 'Qué versión está o estuvo operando en cada entorno, y quién la puso.',
      grain: 'Una fila = un despliegue.',
      columns: [
        id('despliegue_id', 'Identificador del despliegue.'),
        { name: 'artefacto', kind: 'texto', description: 'Código del artefacto desplegado.' },
        { name: 'version', kind: 'entero', description: 'Versión desplegada.' },
        { name: 'entorno', kind: 'texto', description: 'Entorno destino.' },
        { name: 'es_produccion', kind: 'booleano', description: 'Si el entorno es productivo.' },
        { name: 'modo', kind: 'texto', description: 'Modo de despliegue.' },
        { name: 'estado', kind: 'texto', description: 'Estado del despliegue.' },
        { name: 'activo', kind: 'booleano', description: 'Si es el despliegue vigente.' },
        { name: 'vigente_desde', kind: 'fecha', description: 'Inicio de vigencia.' },
        { name: 'vigente_hasta', kind: 'fecha', description: 'Fin de vigencia.' },
        { name: 'desplegado_por', kind: 'texto', description: 'Quién desplegó.' },
        { name: 'desplegado_en', kind: 'fecha', description: 'Cuándo se desplegó.' },
        { name: 'es_reversion', kind: 'booleano', description: 'Si el despliegue revierte a otro anterior.' },
      ],
    },
  ],
};

export const SQL_CONSOLE_CATALOG: readonly CatalogDataset[] = [
  decisiones,
  catalogo,
  desenlaces,
  riesgo,
  auditoria,
];

/** Nombres de esquema que la sesión puede resolver. Es también el `search_path`. */
export const DATASET_NAMES: readonly string[] = SQL_CONSOLE_CATALOG.map((d) => d.name);

/**
 * Toda relación consultable, en las dos formas en que se puede escribir.
 *
 * Se incluye el nombre suelto además del calificado porque el `search_path` de la sesión
 * cubre los cinco datasets: `FROM ejecuciones` es válido y tiene que serlo, o la consola
 * obligaría a calificar donde BigQuery no obliga. Que `motivos` exista en dos datasets no
 * es un problema para la guardia —sólo comprueba que el nombre sea consultable— y sí lo
 * resuelve Postgres por orden del `search_path`, igual que en cualquier esquema.
 */
export const QUALIFIED_RELATIONS: ReadonlySet<string> = new Set(
  SQL_CONSOLE_CATALOG.flatMap((dataset) =>
    dataset.tables.flatMap((table) => [`${dataset.name}.${table.name}`, table.name]),
  ),
);

export function findTable(dataset: string, table: string): CatalogTable | undefined {
  return SQL_CONSOLE_CATALOG.find((d) => d.name === dataset)?.tables.find((t) => t.name === table);
}
