/** Starts the lease-based relay that converts committed outbox rows into bus delivery. */
import { Module } from '@nestjs/common';
import { EventsModule } from '../../common/events/events.module';
import { OutboxRelayService } from './outbox-relay.service';

@Module({
  imports: [EventsModule],
  providers: [OutboxRelayService],
  exports: [OutboxRelayService],
})
export class OutboxRelayModule {}
