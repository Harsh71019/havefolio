import { EnrichmentModule } from './enrichment/enrichment.module.js';
import { PrivacyModule } from './privacy/privacy.module.js';
import { GoalsModule } from './goals/goals.module.js';
import { HomeModule } from './home/home.module.js';
import { TelemetryModule } from '@havefolio/logging';
import { MerchantsModule } from './merchants/merchants.module.js';
import { ItemsModule } from './items/items.module.js';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { validateApiEnvironment } from '@havefolio/config';
import { TaxonomyModule } from './taxonomy/taxonomy.module.js';
import { AuthModule } from './auth/auth.module.js';
import { MediaModule } from './media/media.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';

import { DesiresModule } from './desires/desires.module.js';
import { SettingsModule } from './settings/settings.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: [
        resolve(process.cwd(), '../../.env.local'),
        resolve(process.cwd(), '.env.local'),
      ],
      isGlobal: true,
      validate: validateApiEnvironment,
    }),
    TelemetryModule.register('api'),
    AuthModule,
    TaxonomyModule,
    ItemsModule,
    GoalsModule,
    MerchantsModule,
    DesiresModule,
    HomeModule,
    NotificationsModule,
    OperationsModule,
    MediaModule,
    SettingsModule,
    PrivacyModule,
    EnrichmentModule,
  ],
})
export class AppModule {}
