import { ConfigService } from '@nestjs/config';
import type { Express } from 'express';
import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';

export function configureApplication(app: INestApplication): void {
  const config = app.get(ConfigService);
  const server = app.getHttpAdapter().getInstance() as Express;
  server.set('trust proxy', config.get<string[]>('API_TRUST_PROXY', []));
  app.setGlobalPrefix('api');
  app.enableVersioning({
    defaultVersion: '1',
    type: VersioningType.URI,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
      whitelist: true,
      validationError: { target: false, value: false },
    }),
  );
  app.enableShutdownHooks();
}
