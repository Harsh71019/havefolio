import { Module } from '@nestjs/common';
import { DesiresModule } from '../desires/desires.module.js';
import { GoalsModule } from '../goals/goals.module.js';
import { ItemsModule } from '../items/items.module.js';
import { HomeController } from './home.controller.js';
import { HomeService } from './home.service.js';

@Module({
  imports: [ItemsModule, DesiresModule, GoalsModule],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
