import { CatalogDataset, id } from './types';

export const desenlaces: CatalogDataset = {
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
        {
          name: 'metodo_de_inferencia',
          kind: 'texto',
          description: 'Cómo se infirió, si no se observó directamente.',
        },
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
        {
          name: 'observada_en',
          kind: 'fecha',
          description: 'Cuándo se observó. Nulo si sigue abierta.',
        },
        {
          name: 'vencida_sin_observar',
          kind: 'booleano',
          description: 'Ventana pasada de plazo y todavía sin desenlace.',
        },
      ],
    },
  ],
};

export const riesgo: CatalogDataset = {
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
        {
          name: 'tamano_muestra',
          kind: 'entero',
          description: 'Observaciones sobre las que se midió.',
        },
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
        {
          name: 'segmento',
          kind: 'texto',
          description: 'Segmento. Nulo cuando es la cartera entera.',
        },
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
