import { z } from 'zod';

export const callDispositions = [
  'connected',
  'voicemail',
  'no_answer',
  'busy',
  'wrong_number',
] as const;
export type CallDisposition = (typeof callDispositions)[number];

export const initiateCallSchema = z.object({
  contactId: z.uuid(),
  dealId: z.uuid().optional(),
  accountId: z.uuid().optional(),
});
export type InitiateCallInput = z.infer<typeof initiateCallSchema>;

export const completeCallSchema = z.object({
  durationSeconds: z.number().int().min(0).max(86_400),
  disposition: z.enum(callDispositions).optional(),
  recordingUrl: z.url().max(1000).optional(),
  transcript: z.string().min(10).max(200_000).optional(),
});
export type CompleteCallInput = z.infer<typeof completeCallSchema>;

export const dispositionSchema = z.object({
  disposition: z.enum(callDispositions),
  notes: z.string().trim().max(2000).optional(),
});

export interface CallDto {
  activityId: string;
  providerCallId: string;
  status: 'in_progress' | 'completed';
  to: string;
  contactId: string;
  accountId: string | null;
  dealId: string | null;
}
