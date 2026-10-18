import { AllocationsController } from './allocations.controller.js';
import { AllocationsService } from './allocations.service.js';
import { Module } from '@nestjs/common';
import { GoalsController } from './goals.controller.js';
import { GoalsRepository } from './goals.repository.js';
import { GoalsService } from './goals.service.js';
@Module({
  controllers: [GoalsController, AllocationsController],
  providers: [GoalsRepository, GoalsService, AllocationsService],
  exports: [GoalsService],
})
export class GoalsModule {}
