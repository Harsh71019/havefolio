import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsRepository } from './notifications.repository.js';
import { NotificationsService } from './notifications.service.js';
import { ReminderQueueService } from './reminder-queue.service.js';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsRepository, NotificationsService, ReminderQueueService],
  exports: [ReminderQueueService],
})
export class NotificationsModule {}
