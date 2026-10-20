import { PublicFetcher } from '@havefolio/enrichment';
import { MediaModule } from '../media/media.module.js';
import { Module } from '@nestjs/common';
import { ItemsModule } from '../items/items.module.js';
import { EnrichmentService } from './enrichment.service.js';
import { EnrichmentController } from './enrichment.controller.js';
@Module({
  imports: [ItemsModule, MediaModule],
  controllers: [EnrichmentController],
  providers: [
    EnrichmentService,
    { provide: 'ENRICHMENT_FETCHER', useFactory: () => new PublicFetcher() },
  ],
})
export class EnrichmentModule {}
