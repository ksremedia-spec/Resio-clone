import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('0.0.0.0'),
  /** postgres://… for a server, or pglite://./data/buildline for the zero-install embedded database. */
  DATABASE_URL: z.string().default('postgres://postgres@localhost:5432/buildline'),
  /** Public URL of the API (used in signed file URLs). */
  API_URL: z.string().default('http://localhost:4000'),
  /** Public URL of the iPad/web client (used in emails: invitations, resets, portal links). */
  APP_URL: z.string().default('http://localhost:5173'),
  /** Secret for signing download URLs and portal tokens. Must be set in production. */
  APP_SECRET: z.string().min(16).default('dev-secret-change-me-please-0000'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./storage'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  EMAIL_DRIVER: z.enum(['console', 'smtp', 'memory']).default('console'),
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default('Buildline <no-reply@buildline.local>'),
  /** 'demo' settles card/ACH payments instantly (development, demos, tests); 'none' disables online payment. */
  PAYMENTS_DRIVER: z.enum(['none', 'demo']).default('demo'),
  /** AI assistant: with an Anthropic key the assistant uses the model; without one a rule-based helper answers from the same tools. */
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-sonnet-5'),
  AI_PROVIDER: z.enum(['auto', 'anthropic', 'rules']).default('auto'),
  RATE_LIMIT_MAX: z.coerce.number().int().default(300),
  MAX_UPLOAD_MB: z.coerce.number().int().default(200),
  LOG_LEVEL: z.string().default('info'),
  /** When set, the API also serves the built iPad/web client from this folder (single-process demo/self-host). */
  SERVE_CLIENT_DIR: z.string().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:5173,capacitor://localhost,ionic://localhost,http://localhost'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production' && cfg.APP_SECRET === 'dev-secret-change-me-please-0000') {
    throw new Error('APP_SECRET must be set in production');
  }
  return cfg;
}

export const config = loadConfig();
