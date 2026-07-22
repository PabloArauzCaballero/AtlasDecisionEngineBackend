import { Module } from '@nestjs/common';
import { EventsModule } from '../../common/events/events.module';
import { NotificationController } from './notification.controller';
import { NotificationProjectorService } from './notification-projector.service';
import { NotificationService } from './notification.service';

@Module({
  imports: [EventsModule],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationProjectorService],
  exports: [NotificationService],
})
export class NotificationsModule {}
