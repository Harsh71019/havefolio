import { EventLogger, effectiveId, logContext } from '@havefolio/logging';
import type { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import type { Express } from 'express';
import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';

export function configureApplication(app: INestApplication): void {
  const config = app.get(ConfigService);
  const server = app.getHttpAdapter().getInstance() as Express;
  server.set('trust proxy', config.get<string[]>('API_TRUST_PROXY', []));
  const logger = app.get(EventLogger);
  app.use((req: Request, res: Response, next: NextFunction): void => {
    const requestId = effectiveId(req.headers['x-request-id']);
    const correlationId = effectiveId(req.headers['x-correlation-id'] ?? requestId);
    res.setHeader('X-Request-ID', requestId);
    const started = performance.now();
    const context = Object.freeze({ requestId, correlationId });
    let logged = false;
    const complete = (): void => {
      if (logged) return;
      logged = true;
      // Express registered route paths are trusted templates; never use originalUrl/path.
      const route = (req.route as { path?: unknown } | undefined)?.path;
      const template = typeof route === 'string' ? route : '/unmatched';
      const status = res.writableFinished ? res.statusCode : 499;
      const health = /^\/api\/v1\/health(?:\/|$)/.test(template);
      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : health ? 'debug' : 'info';
      logContext.run(context, () =>
        logger.emit(level, {
          event: 'http_completed',
          component: 'http',
          method: req.method,
          ...(status >= 500 ? { error: res.locals.logError as unknown } : {}),
          code: res.locals.logCode as unknown,
          route: template,
          status,
          durationMs: Math.round((performance.now() - started) * 100) / 100,
          category:
            (res.locals.logCategory as unknown) ??
            (status >= 500
              ? 'unexpected_failure'
              : status >= 400
                ? 'controlled_failure'
                : 'success'),
        }),
      );
    };
    res.once('finish', complete);
    res.once('close', complete);
    logContext.run(context, next);
  });
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
