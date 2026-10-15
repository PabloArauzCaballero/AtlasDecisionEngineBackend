import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../../common/errors/domain-exception';
import type { WorkerServiceOutcome } from '../../graph/graph.types';
import { AudioTtsRuntimeFactory } from '../audio-tts/audio-tts.runtime';
import { buildAudioOutcome } from '../audio-tts/audio-tts.result';
import {
  assertAvailable,
  MAX_CALL_TIMEOUT_MS,
  stringArgument,
  timeoutFor,
  toDomainException,
  variablesArgument,
  withTimeout,
  type WorkerServiceCall,
  type WorkerServiceHandler,
} from './worker-call';

/**
 * Locuta una plantilla del catálogo del tenant.
 *
 * A diferencia de los otros dos servicios, esta llamada **normalmente no calcula nada**:
 * si la frase ya se dijo con esta misma voz, devuelve el audio que había. Por eso es
 * aceptable dentro de una decisión, donde los milisegundos cuentan; y por eso la
 * generación, cuando toca, se hace aquí mismo en vez de encolarse — una decisión necesita
 * la respuesta en el instante en que la pide.
 *
 * Lo que la decisión recibe es la IDENTIDAD del audio, no sus bytes: un algoritmo enruta
 * por «hay locución o no la hay», y meter un MP3 en una variable intermedia lo metería
 * también en la traza de la ejecución.
 */
@Injectable()
export class AudioSpeakCallHandler implements WorkerServiceHandler {
  readonly key = 'audio-tts.speak';

  constructor(
    private readonly config: ConfigService,
    private readonly audio: AudioTtsRuntimeFactory,
  ) {}

  async handle({
    tenantId,
    principal,
    request,
    started,
  }: WorkerServiceCall): Promise<WorkerServiceOutcome> {
    assertAvailable(
      'audio-tts',
      (this.config.get<boolean>('AUDIO_TTS_WORKER_ENABLED') ?? false) &&
        (this.config.get<string>('AUDIO_TTS_PROVIDER') ?? 'disabled') !== 'disabled',
      request.nodeKey,
    );

    const templateCode = stringArgument(request, 'templateCode');
    if (!templateCode) {
      throw new DomainException(
        'WORKER_ARGUMENT_MISSING',
        `El nodo ${request.nodeKey} llama a audio-tts.speak sin el argumento templateCode`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const runtime = this.audio.forTenant(tenantId);
    try {
      const resolved = await withTimeout(
        runtime.resolver.resolve({
          templateCode,
          variables: variablesArgument(request),
          // El actor es quien pidió la decisión: el techo diario de generaciones se aplica
          // sobre él, igual que cuando locuta desde el portal. Un algoritmo no es una vía
          // para saltarse el presupuesto de nadie.
          actorId: principal.id,
          ...(stringArgument(request, 'language')
            ? { language: stringArgument(request, 'language') as string }
            : {}),
          correlationId: principal.requestId,
        }),
        timeoutFor(request, MAX_CALL_TIMEOUT_MS),
        request,
      );
      if (resolved.status === 'QUEUED') {
        await withTimeout(
          runtime.processor.process(resolved.assetId, principal.requestId),
          timeoutFor(request, MAX_CALL_TIMEOUT_MS),
          request,
        );
      }
      const outcome = await buildAudioOutcome(runtime, resolved);
      return {
        // Quedarse sin audio NO es un fallo —el contrato del worker es que la falta de
        // audio nunca rompe a quien lo pide—, pero tampoco es un éxito limpio: el
        // algoritmo tiene que poder distinguirlo y desviarse, y `call.status` es donde
        // lo ve. Lo mismo vale para el respaldo, que suena pero no dice lo que se pidió.
        status: outcome.warnings.length ? 'SUCCEEDED_WITH_WARNINGS' : 'SUCCEEDED',
        result: outcome.result as unknown as Record<string, unknown>,
        warnings: outcome.warnings,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      throw toDomainException(error, request);
    }
  }
}
