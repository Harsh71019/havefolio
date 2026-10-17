import { DesireMatchesController } from './desire-matches.controller.js';
import { DesireMatchesService } from './desire-matches.service.js';
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
  controllers: [DesiresController, DesireMatchesController],
  providers: [
    ReviewsService,
    DesiresRepository,
    DesiresService,
    DesireMatchesService,
    PhotoProcessor,
  ],
  exports: [DesiresService, DesireMatchesService, DesiresRepository],
})
export class DesiresModule {}
