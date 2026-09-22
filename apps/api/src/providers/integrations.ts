/**
 * Integration adapter interfaces. Business logic depends on these interfaces
 * only; concrete adapters are registered in providers/index.ts.
 */
import type { Cents } from '@buildline/core';

export interface PaymentIntent { id: string; clientSecret?: string; checkoutUrl?: string; status: 'requires_action' | 'processing' | 'succeeded' | 'failed'; }
export interface PaymentProvider {
  readonly name: string;
  createPaymentIntent(input: { organizationId: string; invoiceId: string; amountCents: Cents; currency: string; method: 'card' | 'ach'; payerEmail: string; }): Promise<PaymentIntent>;
  verifyWebhook(rawBody: Buffer, signature: string): Promise<{ type: string; paymentId: string; status: PaymentIntent['status']; amountCents: Cents; feeCents: Cents } | null>;
}

export interface AccountingProvider {
  readonly name: string;
  syncInvoice(invoice: { id: string; number: string; totalCents: Cents; clientName: string }): Promise<{ externalId: string }>;
  syncBill(bill: { id: string; number: string; totalCents: Cents; vendorName: string }): Promise<{ externalId: string }>;
  listAccounts(): Promise<Array<{ id: string; name: string }>>;
}

export interface CalendarProvider {
  readonly name: string;
  upsertEvent(event: { externalId?: string; title: string; start: string; end: string; description?: string }): Promise<{ externalId: string }>;
  deleteEvent(externalId: string): Promise<void>;
}

export interface SmsProvider {
  readonly name: string;
  send(to: string, body: string): Promise<{ id: string }>;
}

export interface WeatherProvider {
  readonly name: string;
  forDate(lat: number, lon: number, date: string): Promise<{ conditions: string; temperatureHighF: number; temperatureLowF: number; precipitationIn: number; windMph: number } | null>;
}

export interface PushProvider {
  readonly name: string;
  send(tokens: string[], payload: { title: string; body: string; data?: Record<string, string> }): Promise<void>;
}

/** No-op adapters used until a real integration is connected. */
export const nullPayments: PaymentProvider = {
  name: 'none',
  async createPaymentIntent() { throw new Error('No payment provider is connected.'); },
  async verifyWebhook() { return null; },
};
export const nullWeather: WeatherProvider = { name: 'none', async forDate() { return null; } };
export const nullPush: PushProvider = { name: 'none', async send() {} };
export const nullSms: SmsProvider = { name: 'none', async send() { throw new Error('No SMS provider is connected.'); } };

/** Demo payments: every intent succeeds immediately so the portal "Pay now" flow can be exercised end to end. */
export const demoPayments: PaymentProvider = {
  name: 'demo',
  async createPaymentIntent(input) { return { id: `demo_${input.invoiceId.slice(0, 8)}_${Date.now().toString(36)}`, status: 'succeeded' }; },
  async verifyWebhook() { return null; },
};
