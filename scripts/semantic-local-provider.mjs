#!/usr/bin/env node
/**
 * Proveedor de modelo LOCAL y determinista para el worker semántico.
 *
 * El worker exige `SEMANTIC_ANALYSIS_PROVIDER` (openai | transformer) y sin él no se
 * registra siquiera. Eso deja la cadena completa —cola, lease, presupuesto,
 * clasificación, persistencia, portal— sin forma de ejercitarse en un puesto de
 * trabajo: OpenAI cuesta dinero y manda el texto a un tercero, y el clasificador de
 * transformers exige levantar un servidor de inferencia y descargar el modelo.
 *
 * Esto habla el mismo dialecto que el adaptador de OpenAI —`POST /v1/responses`
 * devolviendo `output_text` con la salida estructurada— pero **no es un modelo**:
 * puntúa por solapamiento de palabras entre el texto y cada categoría candidata.
 * Sirve para comprobar el cableado, no la calidad de la clasificación. Lo que
 * queda fuera de la prueba es exactamente una cosa: el juicio del modelo.
 *
 *   node scripts/semantic-local-provider.mjs            # escucha en 4310
 *   PORT=4310 node scripts/semantic-local-provider.mjs
 *
 * Y en el proceso del motor:
 *   SEMANTIC_ANALYSIS_PROVIDER=openai
 *   OPENAI_BASE_URL=http://host.docker.internal:4310/v1
 *   OPENAI_API_KEY=<cualquier valor no vacío; este servidor no lo mira>
 *
 * No se usa en producción ni en CI: es andamiaje de desarrollo. No lleva
 * autenticación —ignora el `Authorization` que recibe—, así que levántalo sólo
 * en una máquina de trabajo y bájalo al terminar.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 4310);

/** Palabras vacías: aparecen en todas las categorías y no distinguen ninguna. */
const VACIAS = new Set([
  'para',
  'como',
  'este',
  'esta',
  'esto',
  'sobre',
  'entre',
  'porque',
  'cuando',
  'donde',
  'entonces',
  'entrega',
  'cliente',
  'usuario',
  'solicita',
  'solicito',
  'quiero',
  'entidad',
]);

/** Normaliza a minúsculas sin diacríticos: el texto llega tal cual lo escribió alguien. */
function normalizar(texto) {
  return String(texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function palabras(texto) {
  return normalizar(texto)
    .split(/[^a-z0-9]+/)
    .filter((palabra) => palabra.length > 3 && !VACIAS.has(palabra));
}

/**
 * Puntúa una categoría por solapamiento de vocabulario con el texto.
 *
 * El código y el nombre pesan más que la descripción: son lo que un humano
 * reconocería como la etiqueta, y la descripción arrastra palabras genéricas.
 */
function puntuar(texto, categoria) {
  const enTexto = new Set(palabras(texto));
  const pesos = [
    [palabras(categoria.code?.replaceAll('_', ' ')), 3],
    [palabras(categoria.name), 3],
    [palabras(categoria.description), 1],
    [(categoria.positiveExamples ?? []).flatMap(palabras), 2],
  ];

  let puntos = 0;
  const evidencia = new Set();
  for (const [vocabulario, peso] of pesos) {
    for (const palabra of new Set(vocabulario)) {
      if (enTexto.has(palabra)) {
        puntos += peso;
        evidencia.add(palabra);
      }
    }
  }

  // Un contraejemplo presente resta: es la señal de que la categoría se parece
  // pero no es. Sin esto, todo lo que menciona «tarjeta» cae en todas.
  for (const palabra of new Set((categoria.counterExamples ?? []).flatMap(palabras))) {
    if (enTexto.has(palabra)) puntos -= 2;
  }

  return { puntos: Math.max(0, puntos), evidencia: [...evidencia].slice(0, 10) };
}

function clasificar(payload) {
  const texto = `${payload.originalText ?? ''} ${payload.normalizedText ?? ''}`;
  const candidatos = payload.candidates ?? [];
  const crudas = candidatos.map(({ category }) => ({ category, ...puntuar(texto, category) }));
  const maximo = Math.max(1, ...crudas.map((c) => c.puntos));

  return crudas.map(({ category, puntos, evidencia }) => {
    // Confianza relativa al mejor candidato y acotada: este servidor no puede
    // afirmar certeza, y un 1.0 haría pasar por seguro lo que es un recuento.
    const confidence = Number(Math.min(0.95, (puntos / maximo) * 0.95).toFixed(2));
    return {
      categoryCode: category.code,
      confidence,
      supported: confidence >= 0.5,
      contradicted: false,
      evidence: evidencia,
      rationale:
        evidencia.length > 0
          ? `Coincidencia de vocabulario con la categoría: ${evidencia.join(', ')}.`
          : 'Sin vocabulario en común con el texto.',
    };
  });
}

const server = createServer((request, response) => {
  if (request.method !== 'POST' || !request.url?.endsWith('/responses')) {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({ error: { code: 'not_found', message: 'Sólo POST /responses.' } }),
    );
    return;
  }

  let cuerpo = '';
  request.on('data', (trozo) => {
    cuerpo += trozo;
    // Tope defensivo: este servidor no tiene por qué aceptar cargas grandes.
    if (cuerpo.length > 2_000_000) request.destroy();
  });
  request.on('end', () => {
    try {
      const peticion = JSON.parse(cuerpo);
      const mensajeUsuario = (peticion.input ?? []).find((parte) => parte.role === 'user');
      const payload = JSON.parse(mensajeUsuario?.content ?? '{}');
      const assessments = clasificar(payload);

      const salida = {
        model: `local-lexico/${peticion.model ?? 'desconocido'}`,
        status: 'completed',
        output_text: JSON.stringify({ assessments }),
      };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(salida));
      console.log(
        `${new Date().toISOString()}  ${assessments.length} candidatos → ` +
          assessments.map((a) => `${a.categoryCode}=${a.confidence}`).join(' '),
      );
    } catch (error) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ error: { code: 'invalid_request', message: String(error.message) } }),
      );
    }
  });
});

// Escucha en todas las interfaces porque quien lo consulta es un contenedor:
// desde dentro de Docker el anfitrión es `host.docker.internal`, no `localhost`.
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Proveedor semántico local escuchando en http://0.0.0.0:${PORT}/v1/responses`);
  console.log('NO es un modelo: puntúa por solapamiento de vocabulario, de forma determinista.\n');
});
