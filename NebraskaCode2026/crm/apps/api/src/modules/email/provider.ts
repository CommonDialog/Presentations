import { randomUUID } from 'node:crypto';

export interface OutboundMessage {
  to: string[];
  cc?: string[] | undefined;
  subject: string;
  body: string;
  /** Provider message id being replied to, when threading a reply. */
  inReplyTo?: string | undefined;
}

/**
 * Provider abstraction for email transport. The simulated implementation below
 * is the default; Gmail/Microsoft Graph adapters implement the same interface
 * when live sync is wired up (approved architecture: real interfaces, fake
 * providers, no OAuth apps required to run the product).
 */
export interface MailProvider {
  readonly name: string;
  send(message: OutboundMessage): Promise<{ providerMessageId: string }>;
}

export class FakeMailProvider implements MailProvider {
  readonly name = 'fake-mail';
  readonly sent: (OutboundMessage & { providerMessageId: string })[] = [];

  async send(message: OutboundMessage): Promise<{ providerMessageId: string }> {
    const providerMessageId = `fake-${randomUUID()}`;
    this.sent.push({ ...message, providerMessageId });
    return { providerMessageId };
  }
}
