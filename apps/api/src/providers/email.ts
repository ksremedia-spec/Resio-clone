export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Used for templated providers and audit. */
  template?: string;
  data?: Record<string, unknown>;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<{ id: string }>;
}

export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  constructor(private readonly log: (msg: string) => void = console.log) {}
  async send(message: EmailMessage) {
    this.log(`[email] to=${message.to} subject="${message.subject}"\n${message.text}`);
    return { id: `console-${Date.now()}` };
  }
}

/** Captures messages for tests. */
export class MemoryEmailProvider implements EmailProvider {
  readonly name = 'memory';
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.sent.push(message);
    return { id: `memory-${this.sent.length}` };
  }
  last(): EmailMessage | undefined { return this.sent[this.sent.length - 1]; }
}

/** SMTP adapter placeholder: wired when SMTP_URL is configured (nodemailer optional dependency). */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private transport: any;
  constructor(private readonly url: string, private readonly from: string) {}
  async send(message: EmailMessage) {
    if (!this.transport) {
      let nodemailer: any;
      try { nodemailer = await import(/* @vite-ignore */ 'nodemailer' as string); } catch { throw new Error('SMTP email requires the optional dependency nodemailer'); }
      this.transport = nodemailer.createTransport(this.url);
    }
    const info = await this.transport.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text, html: message.html });
    return { id: info.messageId as string };
  }
}
