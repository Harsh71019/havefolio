import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { MediaModule } from '../media/media.module.js';

@Module({
  imports: [MediaModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class OperationsModule {}
