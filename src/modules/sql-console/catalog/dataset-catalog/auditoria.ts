import { CatalogDataset, id } from './types';

export const auditoria: CatalogDataset = {
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
        {
          name: 'es_reversion',
          kind: 'booleano',
          description: 'Si el despliegue revierte a otro anterior.',
        },
      ],
    },
  ],
};
