import { ReviewsService } from './reviews.service.js';
import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { PhotoProcessor } from '../media/photo-processing.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { DesiresController } from './desires.controller.js';
import { DesiresRepository } from './desires.repository.js';
import { DesiresService } from './desires.service.js';

@Module({
  imports: [MediaModule, NotificationsModule],
  controllers: [DesiresController],
  providers: [ReviewsService, DesiresRepository, DesiresService, PhotoProcessor],
  exports: [DesiresService, DesiresRepository],
})
export class DesiresModule {}
