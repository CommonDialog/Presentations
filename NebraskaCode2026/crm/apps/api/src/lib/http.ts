/**
 * Outbound HTTP for integrations (Slack/Teams messages, webhook deliveries).
 * A provider interface so tests and offline demos inject a fake — same
 * pattern as MailProvider/CalendarProvider.
 */
export interface HttpPostResult {
  ok: boolean;
  status: number;
  error?: string | undefined;
}

export interface HttpPoster {
  readonly name: string;
  post(url: string, body: string, headers?: Record<string, string>): Promise<HttpPostResult>;
}

export class FetchHttpPoster implements HttpPoster {
  readonly name = 'fetch';

  constructor(private readonly timeoutMs = 5000) {}

  async post(url: string, body: string, headers: Record<string, string> = {}): Promise<HttpPostResult> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return { ok: res.ok, status: res.status };
    } catch (error) {
      return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export interface CapturedPost {
  url: string;
  body: string;
  headers: Record<string, string>;
}

export class FakeHttpPoster implements HttpPoster {
  readonly name = 'fake-http';
  readonly posts: CapturedPost[] = [];
  private failures = 0;

  /** Make the next n posts fail (exercise retry/delivery-log paths). */
  failNext(n: number): void {
    this.failures = n;
  }

  async post(url: string, body: string, headers: Record<string, string> = {}): Promise<HttpPostResult> {
    this.posts.push({ url, body, headers });
    if (this.failures > 0) {
      this.failures -= 1;
      return { ok: false, status: 500, error: 'fake failure' };
    }
    return { ok: true, status: 200 };
  }
}
