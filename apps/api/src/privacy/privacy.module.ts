import { NotificationsModule } from '../notifications/notifications.module.js';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MediaModule } from '../media/media.module.js';
import { PrivacyController } from './privacy.controller.js';
import { PrivacyRepository } from './privacy.repository.js';
import { PrivacyService } from './privacy.service.js';
@Module({
  imports: [AuthModule, MediaModule, NotificationsModule],
  controllers: [PrivacyController],
  providers: [PrivacyRepository, PrivacyService],
})
export class PrivacyModule {}
