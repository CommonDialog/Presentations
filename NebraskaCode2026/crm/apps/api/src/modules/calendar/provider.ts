import { randomUUID } from 'node:crypto';
import type { CreateEventInput } from '@crm/shared';

/**
 * Calendar transport abstraction. Google Calendar / Microsoft Graph adapters
 * implement this same interface (create → provider API; inbound sync →
 * webhook calling the ingest service). The fake is the default: real
 * interfaces, no OAuth apps needed to run the product.
 */
export interface CalendarProvider {
  readonly name: string;
  createEvent(event: CreateEventInput): Promise<{ providerEventId: string }>;
}

export class FakeCalendarProvider implements CalendarProvider {
  readonly name = 'fake-calendar';
  readonly created: (CreateEventInput & { providerEventId: string })[] = [];

  async createEvent(event: CreateEventInput): Promise<{ providerEventId: string }> {
    const providerEventId = `fake-evt-${randomUUID()}`;
    this.created.push({ ...event, providerEventId });
    return { providerEventId };
  }
}
