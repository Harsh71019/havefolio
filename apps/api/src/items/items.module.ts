import { PhotoRecoveryService } from '../media/photo-recovery.service.js';
import { ItemPhotosController } from '../media/item-photos.controller.js';
import { ItemPhotosService } from '../media/item-photos.service.js';
import { PhotoProcessor } from '../media/photo-processing.js';
import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { ItemsController } from './items.controller.js';
import { ItemsRepository } from './items.repository.js';
import { ItemsService } from './items.service.js';
@Module({
  imports: [MediaModule],
  controllers: [ItemsController, ItemPhotosController],
  providers: [
    ItemsRepository,
    ItemsService,
    ItemPhotosService,
    PhotoProcessor,
    PhotoRecoveryService,
  ],
})
export class ItemsModule {}
