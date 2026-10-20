import { Module } from '@nestjs/common';
import { ItemsModule } from '../items/items.module.js';
import { EnrichmentService } from './enrichment.service.js';
import { EnrichmentController } from './enrichment.controller.js';
@Module({
  imports: [ItemsModule],
  controllers: [EnrichmentController],
  providers: [EnrichmentService],
})
export class EnrichmentModule {}
