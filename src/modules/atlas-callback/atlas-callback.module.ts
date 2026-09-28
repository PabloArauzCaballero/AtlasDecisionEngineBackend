/** El aviso de vuelta a AtlasBackend: encolado en el outbox y entregado con reintento. */
import { Module } from '@nestjs/common';
import { EventsModule } from '../../common/events/events.module';
import { AtlasCallbackDispatcher } from './atlas-callback.dispatcher';
import { AtlasCallbackService } from './atlas-callback.service';

@Module({
  imports: [EventsModule],
  providers: [AtlasCallbackService, AtlasCallbackDispatcher],
  exports: [AtlasCallbackService],
})
export class AtlasCallbackModule {}
