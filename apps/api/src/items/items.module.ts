import { ItemDocumentsController } from '../media/item-documents.controller.js';
import { ItemDocumentsService } from '../media/item-documents.service.js';
import { DocumentProcessor } from '../media/document-processing.js';
import { PhotoRecoveryService } from '../media/photo-recovery.service.js';
import { ItemPhotosController } from '../media/item-photos.controller.js';
import { ItemPhotosService } from '../media/item-photos.service.js';
import { PhotoProcessor } from '../media/photo-processing.js';
import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { ItemRefundsController } from './item-refunds.controller.js';
import { ItemRefundsService } from './item-refunds.service.js';
import { ItemsController } from './items.controller.js';
import { ItemsRepository } from './items.repository.js';
import { InventoryQueryService } from './inventory-query.service.js';
import { ItemsService } from './items.service.js';
@Module({
  imports: [MediaModule],
  controllers: [
    ItemsController,
    ItemRefundsController,
    ItemPhotosController,
    ItemDocumentsController,
  ],
  providers: [
    ItemsRepository,
    ItemsService,
    ItemRefundsService,
    InventoryQueryService,
    ItemPhotosService,
    ItemDocumentsService,
    DocumentProcessor,
    PhotoProcessor,
    PhotoRecoveryService,
  ],
})
export class ItemsModule {}
