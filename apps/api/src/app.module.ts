import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { validateApiEnvironment } from '@havefolio/config';
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
    OperationsModule,
  ],
})
export class AppModule {}
