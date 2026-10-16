import type { AnalisisDePlantilla } from '../template-conformance';
import type { AnalisisSemantico } from '../identity-semantic.classifier';
import type { AnalisisDeManipulacion } from '../image-tamper.analyzer';
import { componer, decidir, escalar } from './helpers';
import { EvaluacionDeFraude, UmbralesDeFraude, VeredictoDeFraude } from './types';

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
  /*
   * Una plantilla que no se pudo LEER no es una plantilla incompleta.
   *
   * Es la corrección que más falsas escaladas ahorra. La cobertura mide qué
   * rótulos del catálogo aparecen en el texto reconocido, así que depende de
   * dos cosas a la vez: de que el documento los lleve impresos y de que la foto
   * tenga resolución para leerlos. Con una captura de 800 px de lado largo —que
   * es la MEDIANA de lo que la gente manda— ni una cédula perfecta llega al
   * umbral, y el expediente salía con «plantilla incompleta» sobre un documento
   * legítimo.
   *
   * Cuando no es evaluable, la prueba se declara AUSENTE en vez de fallada: en
   * modo estricto escala —que es lo que el corpus llama `RECAPTURE_OR_REVIEW`—
   * y en modo normal no acusa a nadie.
   */
  if (!plantilla.coberturaEvaluable) {
    pruebasAusentes.push('TEMPLATE:LOW_RESOLUTION');
    if (umbrales.estricto) {
      motivos.push('TEMPLATE_NOT_EVALUABLE_LOW_RESOLUTION');
      riesgos.push(0.3);
    }
  } else if (cobertura < umbrales.coberturaMinima) {
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
  if (plantilla.coberturaEvaluable && plantilla.mejor.obligatoriosAusentes.length > 0) {
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
    observaciones: [
      ...new Set([
        ...plantilla.observaciones.map((nota) => nota.codigo),
        ...(plantilla.coberturaEvaluable ? [] : ['TEMPLATE_COVERAGE_NOT_EVALUABLE']),
      ]),
    ],
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
