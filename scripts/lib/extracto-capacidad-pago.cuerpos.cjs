/**
 * Los cuerpos de petición de `scripts/extracto-capacidad-pago.mjs`, sin red ni entorno.
 *
 * Están aparte del guion por una razón de prueba, no de estilo: son la parte que traduce la
 * definición (`extracto-capacidad-pago.definicion.json`) a lo que exigen `POST /v1/variables`,
 * `POST /v1/artifacts`, `PUT /v1/artifact-versions/:id/graph` y `POST …/test-suites`, y ahí es
 * donde un puerto se rompe: la LECTURA del grafo llama `required` / `code` a lo que la ESCRITURA
 * pide `isRequired` / `conditionCode`, y el servidor rechaza con 400 un campo que la respuesta
 * anterior sí traía. `test/extracto-capacidad-pago.spec.ts` importa este módulo y pasa cada
 * cuerpo por los DTO reales de la API (mismas reglas que `ValidationPipe` en `main.ts`) y el
 * grafo por `GraphValidatorService`; lo que ese test valida es lo que el guion envía, no una
 * copia escrita a mano.
 *
 * Todas son funciones puras: mismas entradas, mismos cuerpos. La única excepción declarada es
 * `casosDeLaSuite`, que depende de `hoy` porque los documentos de prueba caducan (ver
 * `extracto-pdf-sintetico.cjs`).
 *
 * Es CommonJS por lo que explica `extracto-pdf-sintetico.cjs`: el guion lo importa y Jest lo
 * `require`a, y un módulo ES sólo se podría cargar desde Jest con el `import()` dinámico que este
 * repositorio ya usa para `pdfjs-dist`, que no admite dos suites por proceso.
 */
'use strict';

const { construirExtractoSintetico } = require('./extracto-pdf-sintetico.cjs');

/** Alta del artefacto: sólo los campos que admite `CreateArtifactDto`; las notas van aparte. */
function cuerpoDeArtefacto(definicion) {
  const { authoringNotes: _notas, ...alta } = definicion.artifact;
  return alta;
}

/**
 * Alta de una variable de entrada o de salida.
 *
 * Tres detalles que un puerto «obvio» pierde:
 *
 * - `isSensitive` viaja de verdad. El PDF del extracto es la única entrada sensible: con la
 *   bandera puesta el motor guarda su HMAC y no su contenido, y la traza de cada nodo lo
 *   publica como nulo. Sin ella, cada ejecución guardaría el documento entero en base64 en
 *   `decision_execution_variable` y lo repetiría en el estado de variables de cada paso.
 * - `constraints` y `validationSchema` llevan lo mismo, como en la variable de origen: las
 *   restricciones de `cuota_solicitada_extracto` son el contrato que rechaza una cuota de cero.
 * - `freshnessSlaSeconds` vale 60 aunque la variable de DEV lo tenga en 0 en las salidas: la API
 *   exige al menos 1, y en una salida (`$.output`, `DECISION_ENGINE`) no se evalúa antes de
 *   ejecutar, así que el valor no cambia nada.
 */
function cuerpoDeVariable(definicion, variable, direccion) {
  const esEntrada = direccion === 'input';
  return {
    variableCode: variable.code,
    canonicalName: variable.name,
    businessDescription: variable.description,
    dataClassification: variable.dataClassification,
    ownerTeam: definicion.artifact.ownerTeam,
    isSensitive: variable.isSensitive,
    initialVersion: {
      dataType: variable.dataType,
      ...(variable.unitCode ? { unitCode: variable.unitCode } : {}),
      nullable: false,
      displayName: variable.name,
      description: variable.description,
      ...(variable.constraints
        ? { constraints: variable.constraints, validationSchema: variable.constraints }
        : {}),
      expectedOrigin: esEntrada ? 'REQUEST' : 'DERIVED',
      contractVersion: '1',
      sources: [
        {
          sourceSystemCode: esEntrada ? 'REQUEST_PAYLOAD' : 'DECISION_ENGINE',
          sourcePath: esEntrada ? '$.variables' : '$.output',
          sourceField: variable.code,
          freshnessSlaSeconds: 60,
          precedence: 1,
          isAuthoritative: true,
        },
      ],
      validationRules: [],
    },
  };
}

/**
 * El grafo completo, en la forma que exige `PUT /v1/artifact-versions/:id/graph`.
 *
 * `versiones` es `código → variableVersionId`. La definición ya está en forma de ESCRITURA
 * (aristas con `conditionCode`, nodos con `actions: [{ actionCode, order }]`); lo que se añade
 * aquí es lo que sólo el servidor conoce (ids de versión) y lo que es puro dibujo (`x`, `y`,
 * `order`, en una rejilla de cuatro columnas).
 */
function cuerpoDelGrafo(definicion, versiones) {
  return {
    dependencies: [
      ...definicion.inputs.map((variable) => ({
        variableVersionId: versiones.get(variable.code),
        usageType: 'INPUT',
        dependencyPath: `input.${variable.code}`,
        isRequired: true,
        fallbackPolicy: variable.fallbackPolicy,
      })),
      ...definicion.outputs.map((variable) => ({
        variableVersionId: versiones.get(variable.code),
        usageType: variable.usageType,
        dependencyPath: `output.${variable.code}`,
        isRequired: true,
        fallbackPolicy: variable.fallbackPolicy,
      })),
    ],
    conditions: definicion.conditions,
    actions: definicion.actions,
    nodes: definicion.nodes.map((node, index) => ({
      key: node.key,
      type: node.type,
      label: node.label,
      config: node.config,
      x: (index % 4) * 260,
      y: Math.floor(index / 4) * 160,
      order: index,
      terminal: node.terminal,
      conditions: [],
      actions: node.actions,
      calculatedFieldCalls: [],
    })),
    edges: definicion.edges,
    intermediates: definicion.intermediates.map((item) => ({
      ...item,
      nullable: false,
      updatePolicy: 'SINGLE_WRITE',
      sensitivityClass: 'INTERNAL',
      tracePolicy: 'FULL',
    })),
    outputContract: definicion.outputContract.map((campo) => ({
      ...campo,
      absenceReasons: [],
      reasonCodes: [],
      contractVersion: '1',
      semanticRole: 'NONE',
      tracePolicy: 'FULL',
      sensitivityClass: 'INTERNAL',
    })),
  };
}

/**
 * Los casos de la suite bloqueante, con sus documentos ya construidos.
 *
 * `hoy` es el día contra el que los documentos son vigentes. Un mismo documento se construye una
 * sola vez aunque lo usen varios casos (los casos de cobertura y de contrato de entrada comparten
 * el extracto de tres meses y sólo cambian la cuota): el PDF es determinista y repetirlo sólo engordaría la petición.
 *
 * Devuelve `{ caseCode, testName, input, expectedResult }`, que es lo que admite `TestCaseDto`.
 */
function casosDeLaSuite(definicion, { hoy = new Date() } = {}) {
  const documentos = new Map();
  const documento = (clave) => {
    if (documentos.has(clave)) return documentos.get(clave);
    const especificacion = definicion.documentos[clave];
    if (!especificacion) throw new Error(`El caso pide el documento «${clave}», que no está definido.`);
    const construido =
      especificacion.tipo === 'ilegible'
        ? // Una cabecera `%PDF-1.4` sin nada detrás: pasa la firma del contenedor y el lector de
          // PDF no consigue leer su estructura. Es «el PDF que el cliente subió y no se abre».
          { base64: especificacion.base64, fileName: 'extracto-ilegible.pdf' }
        : construirExtractoSintetico({
            hoy,
            ingresoMensual: especificacion.ingresoMensual,
            tipo: especificacion.tipo,
          });
    documentos.set(clave, construido);
    return construido;
  };

  return definicion.cases.map((caso) => {
    const { base64, fileName } = documento(caso.documento);
    return {
      caseCode: caso.caseCode,
      testName: caso.testName,
      input: {
        extracto_pdf_base64: base64,
        extracto_nombre_archivo: fileName,
        cuota_solicitada_extracto: caso.cuota,
      },
      expectedResult: caso.expectedResult,
    };
  });
}

module.exports = { cuerpoDeArtefacto, cuerpoDeVariable, cuerpoDelGrafo, casosDeLaSuite };
