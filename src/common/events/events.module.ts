import { Module } from '@nestjs/common';
import { EventBus } from './event-bus';
import { OutboxPublisherService } from './outbox-publisher.service';

@Module({
  providers: [EventBus, OutboxPublisherService],
  exports: [EventBus, OutboxPublisherService],
})
export class EventsModule {}
