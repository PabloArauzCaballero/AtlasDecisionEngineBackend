/**
 * El fusor: de tres montones de señales a UN veredicto de fraude documental.
 *
 * ## Por qué hace falta un fusor y no basta con encadenar `if`
 *
 * Porque ninguna de las señales que llegan aquí es concluyente por su cuenta, y
 * encadenar condiciones convierte cada una en concluyente sin querer. Un muaré
 * es sospechoso y también lo produce una cédula plastificada bajo un
 * fluorescente. Un rótulo ausente es sospechoso y también lo produce un reflejo.
 * Una conformidad semántica baja es sospechosa y también la produce un OCR que
 * leyó media tarjeta. Cada una por separado NO justifica acusar a nadie de
 * falsificar un documento; tres a la vez, sí.
 *
 * Así que se suman con su peso y se cortan por dos umbrales, exactamente igual
 * que la puerta de documentos (`identity-triage.ts`): rechazar y preguntar no
 * son lo mismo, y hacen falta dos fronteras para poder distinguirlos.
 *
 * ## Las tres puertas
 *
 * - **`CLEAR`** — el documento se comporta como una cédula boliviana auténtica.
 * - **`REVIEW`** — hay algo, y lo que hay no basta. Va a una persona, con la
 *   lista de qué señales saltaron. Es el desenlace por omisión de todo lo que
 *   este archivo no sepa clasificar: la duda NUNCA se resuelve aprobando.
 * - **`FRAUD_SUSPECTED`** — la evidencia se acumuló por encima del umbral alto.
 *   Sigue sin ser una acusación firmada por una máquina: el artefacto decide qué
 *   hacer con ella, y hoy decide mandarla a revisión humana marcada. Lo que este
 *   veredicto garantiza es que **no puede terminar en aprobación automática**.
 *
 * ## La prueba que FALTA no es una prueba superada
 *
 * Es la regla que gobierna el modo estricto. Si el servidor de embeddings no
 * contestó, o si el análisis de píxeles no pudo correr, el documento no queda
 * «sin señales negativas»: queda SIN MEDIR. En un despliegue de producción eso
 * escala a revisión humana, porque la alternativa —aprobar lo que no se pudo
 * comprobar— convierte una caída de un servicio auxiliar en una puerta abierta,
 * y es justo el fallo que un flujo de identidad no puede permitirse.
 */

import type { AnalisisDePlantilla } from './template-conformance';
import type { AnalisisSemantico } from './identity-semantic.classifier';
import type { AnalisisDeManipulacion } from './image-tamper.analyzer';

export type VeredictoDeFraude = 'CLEAR' | 'REVIEW' | 'FRAUD_SUSPECTED';

export interface UmbralesDeFraude {
  /**
   * Cobertura mínima de la plantilla del catálogo por debajo de la cual el
   * documento ya no se comporta como una cédula completa.
   *
   * **Estaba en 0,55 y nunca se midió contra una cédula real.** El número salía
   * de los ejemplares sintéticos de `fixtures/identity-card.ts`, que están
   * dibujados con los rótulos del catálogo en una tipografía limpia y por
   * construcción puntúan cerca de 1: contra esa población, 0,55 parecía holgado.
   *
   * La primera medición sobre una cédula boliviana auténtica del DS 4924
   * fotografiada con un móvil, en su orientación correcta y perfectamente
   * enfocada, dice otra cosa —el techo de una cédula real es 0,66, no 1—:
   *
   *   lado del OCR   600     900     1200    1600
   *   cobertura      0,216   0,463   0,515   0,664
   *
   * Con el umbral en 0,55, esa cédula levantaba `TEMPLATE_COVERAGE_LOW` a las
   * cuatro resoluciones: un documento auténtico acusado de plantilla incompleta
   * por los rótulos que su propio emisor imprime en gris a 1,2 mm.
   *
   * 0,40 es el punto medido: por encima de lo que da la cédula real a la
   * resolución que el pipeline usa (0,515) con margen para una foto peor, y muy
   * por encima de los controles negativos —un extracto bancario da 0,195 y un
   * recibo de luz 0,182—. Y no es la única defensa contra un montaje: los
   * anclajes obligatorios ausentes, las incoherencias aritméticas entre los
   * datos y el análisis de píxeles se suman aparte.
   */
  readonly coberturaMinima: number;
  /** A partir de aquí el caso va a una persona. */
  readonly riesgoDeRevision: number;
  /** A partir de aquí el caso se marca como sospecha de fraude. */
  readonly riesgoDeSospecha: number;
  /**
   * En estricto, una prueba que no se pudo ejecutar escala el caso.
   *
   * Se enciende en producción y se apaga en desarrollo, donde no siempre hay un
   * servidor de embeddings levantado y donde mandar cada prueba a una cola
   * humana inexistente sólo impediría probar el flujo.
   */
  readonly estricto: boolean;
}

export const UMBRALES_DE_FRAUDE_POR_DEFECTO: UmbralesDeFraude = {
  coberturaMinima: 0.4,
  riesgoDeRevision: 0.3,
  riesgoDeSospecha: 0.6,
  estricto: false,
};

export interface EvaluacionDeFraude {
  readonly veredicto: VeredictoDeFraude;
  /** Riesgo acumulado en `[0, 1]`. */
  readonly riesgo: number;
  /** Códigos de motivo, en el mismo vocabulario que el resto del worker. */
  readonly motivos: readonly string[];
  /** Qué pruebas no se pudieron ejecutar. Vacío es lo normal. */
  readonly pruebasAusentes: readonly string[];
  readonly desglose: {
    readonly conformidadDePlantilla: number;
    readonly generacion: string;
    readonly conformidadSemantica: number | null;
    readonly riesgoDeIncoherencias: number;
    readonly riesgoDeManipulacion: number;
  };
}

/**
 * Junta las tres familias de señales y corta por los dos umbrales.
 *
 * El riesgo se compone por **complemento del producto** —`1 − Π(1 − rᵢ)`— y no
 * por suma. La suma satura en cuanto hay tres señales medianas y no distingue ya
 * «tres dudas» de «una certeza»; el complemento del producto trata cada señal
 * como una probabilidad independiente de que haya algo, que es lo que
 * conceptualmente son, y conserva la diferencia entre acumular dudas pequeñas y
 * encontrar una grande.
 */
export function evaluarFraude(input: {
  readonly plantilla: AnalisisDePlantilla;
  readonly semantica: AnalisisSemantico;
  readonly manipulacion: AnalisisDeManipulacion;
  readonly umbrales: UmbralesDeFraude;
  /** `true` cuando las imágenes las fabricó el catálogo de escenarios. */
  readonly entradaGenerada?: boolean;
}): EvaluacionDeFraude {
  const { plantilla, semantica, manipulacion, umbrales } = input;
  const motivos: string[] = [];
  const riesgos: number[] = [];
  const pruebasAusentes: string[] = [];

  // --- 1. La plantilla del catálogo ---------------------------------------
  const cobertura = plantilla.mejor.cobertura;
  if (cobertura < umbrales.coberturaMinima) {
    motivos.push('TEMPLATE_COVERAGE_LOW');
    /*
     * El riesgo crece con la DISTANCIA al umbral y no de golpe. Una cobertura de
     * 0,54 con el umbral en 0,55 es un rótulo perdido por un reflejo; una de 0,20
     * es que ahí no había una cédula. Un escalón único los trataría igual y
     * llenaría la cola de humanos con la primera clase de caso.
     */
    riesgos.push(
      escalar(
        (umbrales.coberturaMinima - cobertura) / Math.max(0.05, umbrales.coberturaMinima),
        0.55,
      ),
    );
  }
  if (plantilla.mejor.obligatoriosAusentes.length > 0) {
    motivos.push('TEMPLATE_REQUIRED_FIELDS_MISSING');
    riesgos.push(escalar(plantilla.mejor.obligatoriosAusentes.length / 4, 0.4));
  }

  // --- 2. Las incoherencias entre datos del propio documento ---------------
  const riesgoDeIncoherencias = componer(plantilla.incoherencias.map((fallo) => fallo.peso));
  if (plantilla.incoherencias.length > 0) {
    motivos.push(...plantilla.incoherencias.map((fallo) => fallo.codigo));
    riesgos.push(riesgoDeIncoherencias);
  }

  /*
   * Las marcas literales de falsificación son de otra categoría.
   *
   * «SPECIMEN» impreso en la tarjeta no es una señal que sume con otras: es el
   * propio documento declarando que no es un documento. Se le da un peso que por
   * sí solo cruza el umbral alto, porque cualquier otra cosa sería fingir que
   * queda algo por decidir.
   */
  if (plantilla.marcasDeFalsificacion.length > 0) {
    motivos.push(...plantilla.marcasDeFalsificacion);
    riesgos.push(0.85);
  }

  // --- 3. El clasificador por transformers ---------------------------------
  if (!semantica.disponible) {
    pruebasAusentes.push(`SEMANTIC:${semantica.indisponibilidad ?? 'UNKNOWN'}`);
    if (umbrales.estricto) {
      motivos.push('SEMANTIC_CHECK_UNAVAILABLE');
      riesgos.push(0.35);
    }
  } else {
    if (semantica.contradicho) {
      /*
       * Contradicho significa que alguna sonda NEGATIVA le ganó a todas las
       * positivas: el texto se parece más a otro documento —o a una plantilla de
       * internet— que a una cédula boliviana. Es la señal más fuerte que produce
       * el codificador y la única que puede cruzar el umbral alto ella sola.
       */
      motivos.push('SEMANTIC_CONTRADICTED');
      riesgos.push(0.6);
    } else if ((semantica.conformidad ?? 0) < 0.2) {
      motivos.push('SEMANTIC_CONFORMITY_LOW');
      riesgos.push(escalar(1 - (semantica.conformidad ?? 0) / 0.2, 0.4));
    }
  }

  // --- 4. Los píxeles -------------------------------------------------------
  if (!manipulacion.disponible) {
    pruebasAusentes.push(`FORENSICS:${manipulacion.indisponibilidad ?? 'UNKNOWN'}`);
    if (umbrales.estricto) {
      motivos.push('IMAGE_FORENSICS_UNAVAILABLE');
      riesgos.push(0.25);
    }
  } else if (manipulacion.senales.length > 0) {
    motivos.push(...manipulacion.senales.map((senal) => senal.codigo));
    riesgos.push(componer(manipulacion.senales.map((senal) => senal.peso)));
  }
  const riesgoDeManipulacion = componer(manipulacion.senales.map((senal) => senal.peso));

  const riesgo = Number(componer(riesgos).toFixed(3));

  /*
   * Las imágenes fabricadas por el catálogo de escenarios no acusan a nadie.
   *
   * Un rostro dibujado y una tarjeta compuesta por nosotros disparan por
   * construcción las señales de píxeles —no las tomó ningún sensor, así que no
   * tienen grano de sensor— y eso convertiría cada prueba del catálogo en una
   * sospecha de fraude, hasta enseñar a quien la lea que el color rojo no
   * significa nada. La marca la pone el SERVIDOR a partir de que la ejecución
   * naciera del catálogo, nunca quien sube un archivo, y los escenarios están
   * apagados en producción.
   *
   * Se conserva el riesgo calculado y sus motivos —para poder mirarlos— y lo que
   * se topa es el VEREDICTO: nunca sospecha, como mucho revisión.
   */
  const tope: VeredictoDeFraude = input.entradaGenerada ? 'REVIEW' : 'FRAUD_SUSPECTED';

  const veredicto = decidir(riesgo, umbrales, tope);

  return {
    veredicto,
    riesgo,
    motivos: [...new Set(motivos)],
    pruebasAusentes,
    desglose: {
      conformidadDePlantilla: cobertura,
      generacion: plantilla.mejor.generacion,
      conformidadSemantica: semantica.conformidad,
      riesgoDeIncoherencias: Number(riesgoDeIncoherencias.toFixed(3)),
      riesgoDeManipulacion: Number(riesgoDeManipulacion.toFixed(3)),
    },
  };
}

function decidir(
  riesgo: number,
  umbrales: UmbralesDeFraude,
  tope: VeredictoDeFraude,
): VeredictoDeFraude {
  if (riesgo >= umbrales.riesgoDeSospecha) {
    return tope === 'REVIEW' ? 'REVIEW' : 'FRAUD_SUSPECTED';
  }
  if (riesgo >= umbrales.riesgoDeRevision) return 'REVIEW';
  return 'CLEAR';
}

/**
 * `1 − Π(1 − rᵢ)`, con cada `rᵢ` recortado a `[0, 0.95]`.
 *
 * El recorte superior importa: sin él una sola señal en 1 haría el producto cero
 * y el riesgo 1 exacto, y ninguna de estas heurísticas merece la palabra
 * «certeza». Con 0,95 siempre queda margen para que una segunda señal mueva el
 * número, que es lo que permite distinguir un caso de dos.
 */
function componer(riesgos: readonly number[]): number {
  if (riesgos.length === 0) return 0;
  const restante = riesgos.reduce(
    (producto, riesgo) => producto * (1 - Math.max(0, Math.min(0.95, riesgo))),
    1,
  );
  return 1 - restante;
}

/** Una proporción a un riesgo con techo, sin que pueda pasarse de su tope. */
function escalar(proporcion: number, techo: number): number {
  return Math.max(0, Math.min(techo, proporcion * techo));
}
