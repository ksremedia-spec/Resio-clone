import type { Config } from '../config.js';
import { ConsoleEmailProvider, MemoryEmailProvider, SmtpEmailProvider, type EmailProvider } from './email.js';
import type { StorageProvider } from './storage.js';
import { LocalDiskStorage, S3Storage } from './storage.node.js';
import { nullPayments, nullPush, nullSms, nullWeather, type PaymentProvider, type PushProvider, type SmsProvider, type WeatherProvider } from './integrations.js';

export interface Providers {
  storage: StorageProvider;
  email: EmailProvider;
  payments: PaymentProvider;
  weather: WeatherProvider;
  push: PushProvider;
  sms: SmsProvider;
}

export function createProviders(cfg: Config, overrides: Partial<Providers> = {}): Providers {
  const storage: StorageProvider = cfg.STORAGE_DRIVER === 's3'
    ? new S3Storage({ bucket: cfg.S3_BUCKET!, region: cfg.S3_REGION, endpoint: cfg.S3_ENDPOINT, accessKeyId: cfg.S3_ACCESS_KEY_ID, secretAccessKey: cfg.S3_SECRET_ACCESS_KEY })
    : new LocalDiskStorage(cfg.STORAGE_LOCAL_PATH);
  const email: EmailProvider = cfg.EMAIL_DRIVER === 'smtp' && cfg.SMTP_URL
    ? new SmtpEmailProvider(cfg.SMTP_URL, cfg.EMAIL_FROM)
    : cfg.EMAIL_DRIVER === 'memory' ? new MemoryEmailProvider() : new ConsoleEmailProvider();
  return { storage, email, payments: nullPayments, weather: nullWeather, push: nullPush, sms: nullSms, ...overrides };
}
