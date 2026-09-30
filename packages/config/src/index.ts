import { z } from 'zod';

const nodeEnvironment = z.enum(['development', 'test', 'production']).default('development');
const logLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info');

const booleanFromEnvironment = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }

  return value;
}, z.boolean());

const optionalEnvironmentString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

export const apiEnvironmentSchema = z
  .object({
    NODE_ENV: nodeEnvironment,
    LOG_LEVEL: logLevel,
    API_HOST: z.string().min(1).default('0.0.0.0'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    API_CORS_ORIGIN: z.string().url().default('http://localhost:3000'),
    API_DOCS_ENABLED: booleanFromEnvironment.default(true),
    MEDIA_STORAGE_ENABLED: z.preprocess(
      (value) => (value === undefined ? false : value),
      z
        .union([z.boolean(), z.enum(['true', 'false'])])
        .transform((value) => value === true || value === 'true'),
    ),
    CLOUDINARY_CLOUD_NAME: optionalEnvironmentString,
    CLOUDINARY_API_KEY: optionalEnvironmentString,
    CLOUDINARY_API_SECRET: optionalEnvironmentString,
    DATABASE_URL: optionalEnvironmentString,
  })
  .superRefine((config, context) => {
    if (!config.MEDIA_STORAGE_ENABLED) return;
    for (const key of [
      'CLOUDINARY_CLOUD_NAME',
      'CLOUDINARY_API_KEY',
      'CLOUDINARY_API_SECRET',
      'DATABASE_URL',
    ] as const) {
      if (!config[key] || config[key].startsWith('REPLACE_WITH_')) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Enabled media storage requires protected server configuration',
        });
      }
    }
    if (config.CLOUDINARY_CLOUD_NAME && !/^[a-z0-9_-]+$/.test(config.CLOUDINARY_CLOUD_NAME)) {
      context.addIssue({
        code: 'custom',
        path: ['CLOUDINARY_CLOUD_NAME'],
        message: 'Invalid cloud name',
      });
    }
    if (config.DATABASE_URL) {
      try {
        const url = new URL(config.DATABASE_URL);
        if (
          !['postgres:', 'postgresql:'].includes(url.protocol) ||
          /_migrate$/.test(decodeURIComponent(url.username))
        )
          throw new Error();
      } catch {
        context.addIssue({
          code: 'custom',
          path: ['DATABASE_URL'],
          message: 'Media requires a runtime PostgreSQL connection',
        });
      }
    }
  });

export const webEnvironmentSchema = z.object({
  NODE_ENV: nodeEnvironment,
  WEB_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default('http://localhost:3001/api/v1'),
});

export const workerEnvironmentSchema = z
  .object({
    NODE_ENV: nodeEnvironment,
    LOG_LEVEL: logLevel,
    WORKER_QUEUE_ENABLED: booleanFromEnvironment.default(false),
    VALKEY_HOST: z.literal('shared-redis').default('shared-redis'),
    VALKEY_PORT: z.coerce.number().int().min(1).max(65_535).default(6379),
    VALKEY_USERNAME: optionalEnvironmentString,
    VALKEY_PASSWORD: optionalEnvironmentString,
    VALKEY_DATABASE: z.coerce.number().int().min(0).default(0),
    VALKEY_PREFIX: z
      .string()
      .regex(/^havefolio:(dev|test|production)(:[A-Za-z0-9_-]+)*$/)
      .default('havefolio:dev'),
  })
  .superRefine((config, context) => {
    if (!config.WORKER_QUEUE_ENABLED) return;
    const environment = config.NODE_ENV === 'development' ? 'dev' : config.NODE_ENV;
    if (
      !config.VALKEY_PREFIX.startsWith(`havefolio:${environment}:`) &&
      config.VALKEY_PREFIX !== `havefolio:${environment}`
    ) {
      context.addIssue({
        code: 'custom',
        path: ['VALKEY_PREFIX'],
        message: 'Queue prefix must match NODE_ENV',
      });
    }
    if (config.VALKEY_USERNAME !== `havefolio_${environment}_worker` || !config.VALKEY_PASSWORD) {
      context.addIssue({
        code: 'custom',
        path: ['VALKEY_USERNAME'],
        message: 'Enabled queues require dedicated environment worker credentials',
      });
    }
    if (config.VALKEY_DATABASE !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['VALKEY_DATABASE'],
        message: 'Shared Valkey uses database zero and ACL prefix isolation',
      });
    }
  });

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;
export type WebEnvironment = z.infer<typeof webEnvironmentSchema>;
export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;

export function validateApiEnvironment(config: Record<string, unknown>): ApiEnvironment {
  return apiEnvironmentSchema.parse(config);
}

export function validateWebEnvironment(config: Record<string, unknown>): WebEnvironment {
  return webEnvironmentSchema.parse(config);
}

export function validateWorkerEnvironment(config: Record<string, unknown>): WorkerEnvironment {
  return workerEnvironmentSchema.parse(config);
}
