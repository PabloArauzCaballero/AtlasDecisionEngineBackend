/**
 * El puente entre el clasificador de identidad y el servidor de transformers.
 *
 * Reutiliza `TransformerEmbeddingProvider`, que es el MISMO adaptador que usa el
 * worker semántico. No se duplica por una razón concreta: el reintento ante un
 * 503 de arranque, el troceado en lotes que respeta el `max-client-batch-size`
 * del servidor y la normalización de los vectores están resueltos ahí y ya se
 * pagaron una vez en producción. Una segunda copia se separaría, y el día que se
 * separe una de las dos dejará de reintentar sin que nadie se entere.
 *
 * ## Lo que este archivo añade
 *
 * **La caché de las sondas.** El catálogo del carnet boliviano no cambia entre
 * verificaciones: son doce textos fijos. Sin caché, cada cédula que entra pide
 * trece vectores —el documento más las doce sondas— cuando sólo uno de los trece
 * es nuevo. Con la caché, el coste por verificación es un vector, y el servidor
 * de embeddings deja de ser el cuello de botella de un flujo que ya carga con
 * OCR y biometría.
 *
 * La caché se llena una sola vez y **no caduca**: las sondas son constantes de
 * código, así que la única forma de que cambien es un despliegue, y un
 * despliegue reinicia el proceso.
 *
 * ## Los prefijos de la familia e5
 *
 * `multilingual-e5-*` se entrenó con `query:` delante de lo que se busca y
 * `passage:` delante de lo que se indexa, y omitirlos degrada el coseno de forma
 * medible. Aquí el DOCUMENTO leído es la consulta y las SONDAS del catálogo son
 * los pasajes, que es la asimetría natural del problema: se pregunta a qué se
 * parece esta lectura. Con otra familia de modelos los prefijos deben quedar
 * vacíos — un prefijo que el modelo no vio en su entrenamiento es ruido añadido
 * a cada texto y desplaza todas las similitudes a la vez.
 */

import { Injectable, Logger } from '@nestjs/common';
import { TransformerEmbeddingProvider } from '../../../semantic-analysis/core/infrastructure/transformer/transformer-embedding.provider';
import { SONDAS_BOLIVIA_CI } from '../catalog/bolivia-ci.catalog';
import type { IdentityEmbedderPort } from '../forensics/identity-semantic.classifier';

export interface TransformerIdentityOptions {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly retryBackoffMs: number;
  readonly queryPrefix: string;
  readonly passagePrefix: string;
}

@Injectable()
export class TransformerIdentityEmbedderAdapter implements IdentityEmbedderPort {
  private readonly logger = new Logger(TransformerIdentityEmbedderAdapter.name);
  private readonly provider: TransformerEmbeddingProvider;
  /** Vectores de las sondas del catálogo, calculados una vez y conservados. */
  private sondasEnCache: readonly (readonly number[])[] | null = null;
  /** La promesa en vuelo, para que dos verificaciones simultáneas no la calculen dos veces. */
  private calculandoSondas: Promise<readonly (readonly number[])[]> | null = null;

  constructor(private readonly options: TransformerIdentityOptions) {
    this.provider = new TransformerEmbeddingProvider({
      baseUrl: options.baseUrl,
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      model: options.model,
      timeoutMs: options.timeoutMs,
      maxAttempts: options.maxAttempts,
      retryBackoffMs: options.retryBackoffMs,
      truncate: true,
    });
  }

  get model(): string {
    return this.options.model;
  }

  /**
   * Proyecta `[documento, ...sondas]` y devuelve los vectores en ese mismo orden.
   *
   * El contrato con el clasificador es POSICIONAL —el primero es el documento y
   * el resto son las sondas en el orden del catálogo— y por eso aquí se
   * reconstruye el orden aunque las sondas salgan de la caché y el documento de
   * la red. Devolver un vector en la posición equivocada compararía la cédula
   * con la sonda que no es, y el resultado seguiría pareciendo un número
   * perfectamente razonable.
   */
  async embed(
    texts: readonly string[],
    signal?: AbortSignal,
  ): Promise<readonly (readonly number[])[]> {
    const [documento, ...sondas] = texts;
    if (documento === undefined) return [];

    // La llamada sólo se reconoce como «documento + catálogo» si las sondas que
    // llegan son EXACTAMENTE las del catálogo. Cualquier otra cosa —una prueba
    // con sondas propias— se proyecta entera, sin caché.
    const esElCatalogo =
      sondas.length === SONDAS_BOLIVIA_CI.length &&
      sondas.every((texto, indice) => texto === SONDAS_BOLIVIA_CI[indice]?.texto);

    if (!esElCatalogo) {
      return this.provider.embed(
        texts.map((texto) => `${this.options.queryPrefix}${texto}`),
        signal,
      );
    }

    const [vectorDocumento, vectoresDeSondas] = await Promise.all([
      this.provider.embed([`${this.options.queryPrefix}${documento}`], signal),
      this.vectoresDeSondas(signal),
    ]);
    const primero = vectorDocumento[0];
    if (!primero) return [];
    return [primero, ...vectoresDeSondas];
  }

  private async vectoresDeSondas(signal?: AbortSignal): Promise<readonly (readonly number[])[]> {
    if (this.sondasEnCache) return this.sondasEnCache;
    if (this.calculandoSondas) return this.calculandoSondas;

    this.calculandoSondas = this.provider
      .embed(
        SONDAS_BOLIVIA_CI.map((sonda) => `${this.options.passagePrefix}${sonda.texto}`),
        signal,
      )
      .then((vectores) => {
        this.sondasEnCache = vectores;
        this.logger.log(
          `Catálogo del carnet boliviano proyectado: ${String(vectores.length)} sondas con ${this.options.model}.`,
        );
        return vectores;
      })
      .finally(() => {
        // Se suelta SIEMPRE, también en el camino feliz: mantenerla retendría la
        // promesa resuelta para siempre sin ninguna ventaja, y en el camino de
        // fallo impediría reintentar la proyección tras una caída del servidor.
        this.calculandoSondas = null;
      });

    return this.calculandoSondas;
  }
}
