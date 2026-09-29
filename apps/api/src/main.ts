import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { configureApplication } from './app.setup.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
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
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const host = config.getOrThrow<string>('API_HOST');
  const port = config.getOrThrow<number>('API_PORT');
  await app.listen(port, host);
}

void bootstrap();
