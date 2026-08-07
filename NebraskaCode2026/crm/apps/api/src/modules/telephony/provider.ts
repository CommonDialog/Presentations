import { randomUUID } from 'node:crypto';

/**
 * Browser telephony transport abstraction. A Twilio (or similar) adapter
 * implements this same interface: initiate places the call, and the provider's
 * status/recording/transcription webhooks call the completion service. The
 * fake is the default — real interfaces, no telephony account required.
 */
export interface TelephonyProvider {
  readonly name: string;
  initiateCall(params: { to: string }): Promise<{ providerCallId: string; recordingUrl: string }>;
}

export class FakeTelephonyProvider implements TelephonyProvider {
  readonly name = 'fake-telephony';
  readonly calls: { to: string; providerCallId: string }[] = [];

  async initiateCall(params: { to: string }): Promise<{ providerCallId: string; recordingUrl: string }> {
    const providerCallId = `fake-call-${randomUUID()}`;
    this.calls.push({ to: params.to, providerCallId });
    return {
      providerCallId,
      recordingUrl: `https://recordings.local/fake/${providerCallId}.mp3`,
    };
  }
}
