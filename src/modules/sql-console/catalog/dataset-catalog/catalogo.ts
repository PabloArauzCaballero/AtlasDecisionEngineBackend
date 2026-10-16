import { CatalogDataset, id } from './types';

export const catalogo: CatalogDataset = {
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
        {
          name: 'base_legal',
          kind: 'texto',
          description: 'Base legal declarada para el tratamiento.',
        },
        { name: 'validada_por', kind: 'texto', description: 'Quién validó el modelo.' },
        { name: 'validada_en', kind: 'fecha', description: 'Cuándo se validó.' },
        {
          name: 'revalidacion_vence_en',
          kind: 'fecha',
          description: 'Cuándo caduca esa validación.',
        },
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
        {
          name: 'sensibilidad',
          kind: 'texto',
          description: 'PUBLIC, INTERNAL, CONFIDENTIAL, RESTRICTED.',
        },
        { name: 'ciclo_de_vida', kind: 'texto', description: 'ACTIVE, DEPRECATED, RETIRED.' },
        {
          name: 'restriccion_de_uso',
          kind: 'texto',
          description: 'Licitud de uso en una decisión: NONE, PROHIBITED, REQUIRES_JUSTIFICATION…',
        },
        { name: 'equipo_responsable', kind: 'texto', description: 'Equipo dueño de la variable.' },
        {
          name: 'es_sensible',
          kind: 'booleano',
          description: 'Bandera derivada de la sensibilidad.',
        },
        {
          name: 'activa',
          kind: 'booleano',
          description: 'Si sigue disponible para nuevos contratos.',
        },
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
        {
          name: 'es_accion_adversa',
          kind: 'booleano',
          description: 'Si es notificable como acción adversa.',
        },
        { name: 'activo', kind: 'booleano', description: 'Si sigue vigente.' },
        {
          name: 'mensaje_publico',
          kind: 'texto',
          description: 'Mensaje que se le comunica al solicitante.',
        },
      ],
    },
  ],
};
