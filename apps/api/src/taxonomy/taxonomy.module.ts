import { Module } from '@nestjs/common';
import { TaxonomyController } from './taxonomy.controller.js';
import { TaxonomyRepository } from './taxonomy.repository.js';
import { TaxonomyService } from './taxonomy.service.js';

@Module({
  controllers: [TaxonomyController],
  providers: [TaxonomyRepository, TaxonomyService],
  exports: [TaxonomyService],
})
export class TaxonomyModule {}
