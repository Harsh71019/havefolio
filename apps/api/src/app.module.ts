import { TelemetryModule } from '@havefolio/logging';
import { ItemsModule } from './items/items.module.js';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { validateApiEnvironment } from '@havefolio/config';
import { TaxonomyModule } from './taxonomy/taxonomy.module.js';
import { AuthModule } from './auth/auth.module.js';
import { MediaModule } from './media/media.module.js';
import { OperationsModule } from './operations/operations.module.js';

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
    OperationsModule,
    MediaModule,
  ],
})
export class AppModule {}
