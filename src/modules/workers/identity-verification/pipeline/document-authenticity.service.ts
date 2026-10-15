import { Inject, Injectable } from '@nestjs/common';
import type { ExtractedIdentityData } from '../core/domain/extracted-identity.types';
import { analizarManipulacion } from '../core/forensics/image-tamper.analyzer';
import { evaluarFraude, type EvaluacionDeFraude } from '../core/forensics/identity-fraud.scorer';
import {
  clasificarSemanticamente,
  type IdentityEmbedderPort,
} from '../core/forensics/identity-semantic.classifier';
import { analizarPlantilla } from '../core/forensics/template-conformance';
import {
  IDENTITY_EMBEDDER_PORT,
  IDENTITY_OPTIONS,
  type IdentityOptions,
} from '../core/identity-options';
import { parseMrzTd1 } from '../core/parsers/mrz-td1';

/** Lo que las pruebas de autenticidad miran del documento ya leído. */
export interface EntradaDeAutenticidad {
  textoAnverso: string;
  textoReverso: string;
  campos: ExtractedIdentityData;
  rawText: string;
  documento: Buffer;
  entradaGenerada: boolean;
  /** Lado largo de la captura del documento, en píxeles. */
  ladoLargoPx: number | null;
}

@Injectable()
export class DocumentAuthenticityService {
  constructor(
    @Inject(IDENTITY_OPTIONS) private readonly options: IdentityOptions,
    /*
     * El codificador es OPCIONAL, y ese `null` es parte del contrato: un
     * despliegue sin servidor de embeddings tiene que seguir verificando
     * identidades, sabiendo que le falta una prueba. Lo que no puede es aprobar
     * como si la hubiera hecho — de eso se encarga el modo estricto del fusor.
     */
    @Inject(IDENTITY_EMBEDDER_PORT)
    private readonly embedder: IdentityEmbedderPort | null,
  ) {}

  /**
   * Las tres pruebas de autenticidad, en paralelo, y su fusión.
   *
   * Devuelve `null` cuando la detección está apagada por configuración: es un
   * ausente EXPLÍCITO, distinto de un análisis que salió limpio. El resultado no
   * lleva el bloque `fraud` y quien lo lea sabe que no se preguntó, en vez de
   * leer un «sin señales» que nadie midió.
   *
   * Ninguna de las tres puede tumbar la verificación. `analizarManipulacion` y
   * `clasificarSemanticamente` capturan sus propios fallos y los devuelven como
   * prueba ausente; el `catch` de aquí cubre lo que quede —un `parseMrzTd1` sobre
   * un texto degenerado, un fallo de memoria— porque tirar una verificación ya
   * calculada por un defecto del análisis forense castigaría al solicitante por
   * un problema nuestro.
   */
  async analizarFraude(entrada: EntradaDeAutenticidad): Promise<EvaluacionDeFraude | null> {
    if (!this.options.fraudDetectionEnabled) return null;

    try {
      const plantilla = analizarPlantilla({
        textoAnverso: entrada.textoAnverso,
        textoReverso: entrada.textoReverso,
        campos: entrada.campos,
        mrz: parseMrzTd1(entrada.rawText),
        ahora: new Date(),
        // Con el tamaño de la captura, la cobertura baja de una foto pequeña se
        // declara NO EVALUABLE en vez de contarse como plantilla incompleta.
        ladoLargoPx: entrada.ladoLargoPx,
      });

      /*
       * Sobre una imagen FABRICADA no se analizan los píxeles.
       *
       * No es una excepción de comodidad: es que la pregunta no aplica. Todas
       * las señales de `analizarManipulacion` miden la física de una captura
       * —el grano del sensor, la huella de la compresión, la rejilla de una
       * pantalla— y una tarjeta que dibujamos nosotros no pasó por ningún
       * sensor. Correrlas sobre ella no mide manipulación: mide que la imagen
       * es sintética, cosa que ya sabemos, y convertiría cada escenario del
       * catálogo en una sospecha de fraude hasta enseñar a quien lo lea que el
       * color rojo no significa nada.
       *
       * Se declara NO APLICABLE en vez de ausente, y la diferencia importa: una
       * prueba ausente escala el caso en modo estricto, y ésta no debe, porque
       * no falta —no procede—.
       */
      const forense = entrada.entradaGenerada
        ? Promise.resolve({
            disponible: true,
            senales: [],
            medidas: {
              periodicidad: null,
              residuoMaximoRelativo: null,
              bloquesAtipicos: null,
              variacionDelRuido: null,
              marcoUniforme: null,
            },
            indisponibilidad: 'NOT_APPLICABLE_GENERATED_INPUT',
          } as const)
        : analizarManipulacion(entrada.documento);

      const [semantica, manipulacion] = await Promise.all([
        clasificarSemanticamente({
          embedder: this.embedder,
          texto: `${entrada.textoAnverso}\n${entrada.textoReverso}`,
          umbrales: {
            sueloDeParecido: this.options.fraudSemanticFloor,
            margenMinimo: this.options.fraudSemanticMargin,
          },
        }),
        forense,
      ]);

      return evaluarFraude({
        plantilla,
        semantica,
        manipulacion,
        entradaGenerada: entrada.entradaGenerada,
        umbrales: {
          coberturaMinima: this.options.fraudTemplateCoverageMin,
          riesgoDeRevision: this.options.fraudReviewRisk,
          riesgoDeSospecha: this.options.fraudSuspicionRisk,
          estricto: this.options.fraudStrictMode,
        },
      });
    } catch {
      /*
       * El análisis se cayó entero. Eso NO es un documento limpio.
       *
       * Se devuelve una evaluación que dice exactamente lo que pasó y que, en
       * modo estricto, escala: la regla de este módulo es que una prueba que
       * falta no es una prueba superada, y vale igual cuando la que falta es
       * todo el análisis.
       */
      return {
        veredicto: this.options.fraudStrictMode ? 'REVIEW' : 'CLEAR',
        riesgo: this.options.fraudStrictMode ? this.options.fraudReviewRisk : 0,
        motivos: ['FRAUD_ANALYSIS_FAILED'],
        observaciones: [],
        pruebasAusentes: ['ALL:ANALYSIS_THREW'],
        desglose: {
          conformidadDePlantilla: 0,
          generacion: 'UNKNOWN',
          conformidadSemantica: null,
          riesgoDeIncoherencias: 0,
          riesgoDeManipulacion: 0,
        },
      };
    }
  }
}
