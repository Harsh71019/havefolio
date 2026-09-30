import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { validateApiEnvironment } from '@havefolio/config';
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
    AuthModule,
    OperationsModule,
    MediaModule,
  ],
})
export class AppModule {}
