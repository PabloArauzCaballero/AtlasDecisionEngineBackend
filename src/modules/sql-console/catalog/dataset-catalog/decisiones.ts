import { CatalogDataset, id } from './types';

export const decisiones: CatalogDataset = {
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
        {
          name: 'peticion',
          kind: 'texto',
          description: 'Identificador de la petición del integrador.',
        },
        {
          name: 'correlacion',
          kind: 'texto',
          description: 'Correlación entre sistemas, si el integrador la mandó.',
        },
        { name: 'artefacto', kind: 'texto', description: 'Código del artefacto que decidió.' },
        { name: 'artefacto_nombre', kind: 'texto', description: 'Nombre legible del artefacto.' },
        {
          name: 'dominio_de_riesgo',
          kind: 'texto',
          description: 'Dominio de riesgo del artefacto.',
        },
        {
          name: 'tipo_de_decision',
          kind: 'texto',
          description: 'ORIGINATION, LIMIT_CHANGE, COLLECTION…',
        },
        { name: 'version', kind: 'entero', description: 'Número de versión del artefacto.' },
        { name: 'version_semantica', kind: 'texto', description: 'Versión semántica publicada.' },
        { name: 'entorno', kind: 'texto', description: 'Código del entorno donde se ejecutó.' },
        { name: 'es_produccion', kind: 'booleano', description: 'Si ese entorno es productivo.' },
        { name: 'estado', kind: 'texto', description: 'APPROVED, REJECTED, MANUAL_REVIEW, ERROR…' },
        {
          name: 'desenlace_de_negocio',
          kind: 'texto',
          description: 'Desenlace declarado por el artefacto.',
        },
        {
          name: 'duracion_ms',
          kind: 'entero',
          description: 'Cuánto tardó la decisión, en milisegundos.',
        },
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
        {
          name: 'duracion_us',
          kind: 'entero',
          description: 'Duración del paso, en microsegundos.',
        },
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
        {
          name: 'reintentable',
          kind: 'booleano',
          description: 'Si el motor lo considera transitorio.',
        },
      ],
    },
  ],
};
