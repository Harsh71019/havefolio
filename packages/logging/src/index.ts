import {
  Global,
  Injectable,
  Module,
  type DynamicModule,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule, PinoLogger } from 'nestjs-pino';
import pino, { type LoggerOptions, type DestinationStream } from 'pino';
import pretty from 'pino-pretty';
import { effectiveId, logContext } from './context.js';
import { redact, safeEvent } from './sanitize.js';
import { LogDestination } from './seq.js';
export * from './context.js';
export * from './sanitize.js';
export * from './seq.js';

export function loggerOptions(base: {
  application: string;
  service: string;
  environment: string;
  release: string;
  level: string;
}): LoggerOptions {
  return {
    level: base.level,
    base: {
      application: base.application,
      service: base.service,
      environment: base.environment,
      release: base.release,
    },
    // Child bindings produced by pino-http must never contain request objects.
    formatters: {
      bindings: () => ({
        application: base.application,
        service: base.service,
        environment: base.environment,
        release: base.release,
      }),
    },
    hooks: {
      logMethod(args, method): void {
        try {
          const event = redact(safeEvent(args[0])) as Record<string, unknown>;
          method.call(this, { ...event, ...logContext.getStore() });
        } catch {
          /* Instrumentation never changes application outcomes. */
        }
      },
    },
  };
}

@Injectable()
export class EventLogger {
  constructor(private readonly logger: PinoLogger) {}
  emit(level: 'debug' | 'info' | 'warn' | 'error', event: Record<string, unknown>): void {
    try {
      this.logger[level](event);
    } catch {
      /* Instrumentation must not cause request/job failure. */
    }
  }
}

@Injectable()
class LoggingLifecycle implements OnModuleDestroy {
  constructor(private readonly destination: LogDestination) {}
  onModuleDestroy(): void {
    this.destination.close();
  }
}

@Global()
@Module({})
export class TelemetryModule {
  static register(service: 'api' | 'worker'): DynamicModule {
    const transportModule: DynamicModule = {
      module: TransportModule,
      providers: [
        {
          provide: LogDestination,
          inject: [ConfigService],
          useFactory: (config: ConfigService): LogDestination => {
            const console: DestinationStream =
              config.get<string>('NODE_ENV') === 'development' && config.get<boolean>('LOG_PRETTY')
                ? pretty({ colorize: process.stdout.isTTY, sync: true })
                : process.stdout;
            return new LogDestination(
              {
                enabled: config.get<boolean>('SEQ_ENABLED', false),
                endpoint: config.get<string>('SEQ_ENDPOINT'),
                apiKey: config.get<string>('SEQ_API_KEY'),
              },
              console,
            );
          },
        },
        LoggingLifecycle,
      ],
      exports: [LogDestination],
    };
    return {
      module: TelemetryModule,
      imports: [
        transportModule,
        LoggerModule.forRootAsync({
          providers: [],
          imports: [transportModule],
          inject: [ConfigService, LogDestination],
          useFactory: (config: ConfigService, destination: LogDestination) => ({
            pinoHttp: {
              logger: pino(
                loggerOptions({
                  application: config.get<string>('LOG_APPLICATION', 'havefolio'),
                  service: config.get<string>('LOG_SERVICE', service),
                  environment: config.get<string>('NODE_ENV', 'development'),
                  release: config.get<string>('LOG_RELEASE', 'local'),
                  level: config.get<string>('LOG_LEVEL', 'info'),
                }),
                destination,
              ),
              genReqId: () => logContext.getStore()?.requestId ?? effectiveId(undefined),
              autoLogging: false,
              quietReqLogger: true,
              serializers: { req: () => undefined, res: () => undefined, err: () => undefined },
            },
          }),
        }),
      ],
      providers: [EventLogger],
      exports: [EventLogger, LoggerModule],
    };
  }
}
@Module({})
class TransportModule {}
