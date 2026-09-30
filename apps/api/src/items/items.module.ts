import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { ItemsController } from './items.controller.js';
import { ItemsRepository } from './items.repository.js';
import { ItemsService } from './items.service.js';
@Module({
  imports: [MediaModule],
  controllers: [ItemsController],
  providers: [ItemsRepository, ItemsService],
})
export class ItemsModule {}
