import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { configureApplication } from './app.setup.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.useBodyParser('json', { limit: '16kb' });
  configureApplication(app);

  const config = app.get(ConfigService);
  const corsOrigin = config.getOrThrow<string>('API_CORS_ORIGIN');
  app.enableCors({
    credentials: true,
    origin: corsOrigin,
  });

  if (config.getOrThrow<boolean>('API_DOCS_ENABLED')) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Havefolio API')
      .setDescription('Private household inventory and intentional-purchase API.')
      .setVersion('1.0.0')
      .addCookieAuth(
        config.get<string>('NODE_ENV') === 'production'
          ? '__Host-havefolio_session'
          : 'havefolio_session',
        { type: 'apiKey', in: 'cookie' },
        'ownerSession',
      )
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const host = config.getOrThrow<string>('API_HOST');
  const port = config.getOrThrow<number>('API_PORT');
  await app.listen(port, host);
}

void bootstrap();
