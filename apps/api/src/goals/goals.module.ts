import { Module } from '@nestjs/common';
import { GoalsController } from './goals.controller.js';
import { GoalsRepository } from './goals.repository.js';
import { GoalsService } from './goals.service.js';
@Module({ controllers: [GoalsController], providers: [GoalsRepository, GoalsService] })
export class GoalsModule {}
