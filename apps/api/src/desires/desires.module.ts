import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { PhotoProcessor } from '../media/photo-processing.js';
import { DesiresController } from './desires.controller.js';
import { DesiresRepository } from './desires.repository.js';
import { DesiresService } from './desires.service.js';

@Module({
  imports: [MediaModule],
  controllers: [DesiresController],
  providers: [DesiresRepository, DesiresService, PhotoProcessor],
  exports: [DesiresService, DesiresRepository],
})
export class DesiresModule {}
