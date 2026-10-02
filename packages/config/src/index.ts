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

const loggingFields = {
  LOG_SERVICE: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,39}$/)
      .optional(),
  ),
  LOG_APPLICATION: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,39}$/)
    .default('havefolio'),
  LOG_RELEASE: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/)
    .refine((value) => !value.startsWith('REPLACE_WITH_'), {
      message: 'Release requires a real bounded identifier',
    })
    .default('local'),
  LOG_PRETTY: z.preprocess(
    (v) => (v === undefined ? false : v),
    z.union([z.boolean(), z.enum(['true', 'false'])]).transform((v) => v === true || v === 'true'),
  ),
  SEQ_ENABLED: z.preprocess(
    (v) => (v === undefined ? false : v),
    z.union([z.boolean(), z.enum(['true', 'false'])]).transform((v) => v === true || v === 'true'),
  ),
  // Invalid destination values deliberately disable Seq, never application startup.
  SEQ_ENDPOINT: z.preprocess(
    (v) => (typeof v === 'string' && v.length <= 256 ? v : undefined),
    z.string().optional(),
  ),
  SEQ_API_KEY: z.preprocess(
    (v) =>
      typeof v === 'string' &&
      v.length <= 256 &&
      /^[A-Za-z0-9_-]+$/.test(v) &&
      !v.startsWith('REPLACE_WITH_')
        ? v
        : undefined,
    z.string().optional(),
  ),
};

export const apiEnvironmentSchema = z
  .object({
    NODE_ENV: nodeEnvironment,
    LOG_LEVEL: logLevel,
    ...loggingFields,
    API_HOST: z.string().min(1).default('0.0.0.0'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    API_TRUST_PROXY: z.preprocess(
      (v) =>
        v === undefined || v === ''
          ? []
          : typeof v === 'string'
            ? v.split(',').map((ip) => ip.trim())
            : v,
      z.array(z.union([z.ipv4(), z.ipv6()])).max(16),
    ),
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
    AUTH_REGISTRATION_ENABLED: z.preprocess(
      (v) => (v === undefined ? false : v),
      z
        .union([z.boolean(), z.enum(['true', 'false'])])
        .transform((v) => v === true || v === 'true'),
    ),
    AUTH_ARGON_MEMORY_KIB: z.coerce.number().int().min(19456).max(262144).default(65536),
    AUTH_ARGON_TIME_COST: z.coerce.number().int().min(2).max(10).default(3),
    AUTH_ARGON_PARALLELISM: z.coerce.number().int().min(1).max(4).default(1),
    AUTH_SESSION_IDLE_SECONDS: z.coerce.number().int().min(60).max(604800).default(86400),
    AUTH_SESSION_ABSOLUTE_SECONDS: z.coerce.number().int().min(60).max(2592000).default(604800),
    AUTH_SESSION_MAX_RETAINED: z.coerce.number().int().min(1).max(50).default(10),
    AUTH_RATE_WINDOW_SECONDS: z.coerce.number().int().min(1).max(300).default(300),
    AUTH_RATE_SOURCE_LIMIT: z.coerce.number().int().min(1).max(1000).default(30),
    AUTH_RATE_ACCOUNT_SOURCE_LIMIT: z.coerce.number().int().min(1).max(100).default(5),
    AUTH_RATE_KEY_SECRET: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().min(32).optional(),
    ),
    VALKEY_HOST: z.string().min(1).default('shared-redis'),
    VALKEY_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
    VALKEY_USERNAME: optionalEnvironmentString,
    VALKEY_PASSWORD: optionalEnvironmentString,
    VALKEY_DATABASE: z.coerce.number().int().min(0).max(0).default(0),
    VALKEY_PREFIX: z
      .string()
      .regex(/^havefolio:(dev|test|production)(:[A-Za-z0-9_-]+)*$/)
      .optional(),
  })
  .superRefine((config, context) => {
    const environment = config.NODE_ENV === 'development' ? 'dev' : config.NODE_ENV;
    if (config.AUTH_SESSION_IDLE_SECONDS > config.AUTH_SESSION_ABSOLUTE_SECONDS)
      context.addIssue({
        code: 'custom',
        path: ['AUTH_SESSION_IDLE_SECONDS'],
        message: 'Idle lifetime exceeds absolute lifetime',
      });
    if (
      config.VALKEY_PREFIX &&
      config.VALKEY_PREFIX !== `havefolio:${environment}` &&
      !config.VALKEY_PREFIX.startsWith(`havefolio:${environment}:`)
    )
      context.addIssue({
        code: 'custom',
        path: ['VALKEY_PREFIX'],
        message: 'Auth namespace must match environment',
      });
    if (config.VALKEY_USERNAME && config.VALKEY_USERNAME !== `havefolio_${environment}_api`)
      context.addIssue({
        code: 'custom',
        path: ['VALKEY_USERNAME'],
        message: 'API requires its dedicated ACL identity',
      });
    if (config.NODE_ENV === 'production') {
      for (const key of [
        'DATABASE_URL',
        'VALKEY_PASSWORD',
        'VALKEY_USERNAME',
        'AUTH_RATE_KEY_SECRET',
      ] as const)
        if (!config[key] || config[key].startsWith('REPLACE_WITH_'))
          context.addIssue({
            code: 'custom',
            path: [key],
            message: 'Production authentication requires protected configuration',
          });
      if (config.VALKEY_HOST !== 'shared-redis')
        context.addIssue({
          code: 'custom',
          path: ['VALKEY_HOST'],
          message: 'Production uses shared-service DNS',
        });
      if (!config.API_CORS_ORIGIN.startsWith('https://'))
        context.addIssue({
          code: 'custom',
          path: ['API_CORS_ORIGIN'],
          message: 'Production requires HTTPS origin',
        });
    }
    if (config.DATABASE_URL) {
      try {
        const url = new URL(config.DATABASE_URL);
        if (
          !['postgres:', 'postgresql:'].includes(url.protocol) ||
          !/_runtime$/.test(decodeURIComponent(url.username))
        )
          throw new Error();
      } catch {
        context.addIssue({
          code: 'custom',
          path: ['DATABASE_URL'],
          message: 'API requires a runtime PostgreSQL connection',
        });
      }
    }
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
          !/_runtime$/.test(decodeURIComponent(url.username))
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
    ...loggingFields,
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
