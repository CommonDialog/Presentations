import { z } from 'zod';

export const emailAddressSchema = z.object({
  email: z.email().toLowerCase(),
  name: z.string().trim().max(200).optional(),
});
export type EmailAddress = z.infer<typeof emailAddressSchema>;

/** What a provider webhook (or the simulator) delivers for an inbound message. */
export const inboundEmailSchema = z.object({
  providerMessageId: z.string().min(1).max(300),
  from: emailAddressSchema,
  to: z.array(emailAddressSchema).min(1).max(20),
  cc: z.array(emailAddressSchema).max(20).optional(),
  subject: z.string().trim().min(1).max(300),
  body: z.string().max(200_000),
  inReplyTo: z.string().max(300).optional(),
  receivedAt: z.iso.datetime({ offset: true }).optional(),
});
export type InboundEmail = z.infer<typeof inboundEmailSchema>;

export const sendEmailSchema = z.object({
  to: z.array(z.email().toLowerCase()).min(1).max(20),
  cc: z.array(z.email().toLowerCase()).max(20).optional(),
  subject: z.string().trim().min(1).max(300),
  body: z.string().min(1).max(200_000),
  contactId: z.uuid().optional(),
  accountId: z.uuid().optional(),
  dealId: z.uuid().optional(),
  /** Reply: threads onto the same conversation as this email activity. */
  inReplyToActivityId: z.uuid().optional(),
});
export type SendEmailInput = z.infer<typeof sendEmailSchema>;

export interface EmailIngestResult {
  activityId: string;
  duplicate: boolean;
  threadKey: string;
  contactId: string | null;
  contactCreated: boolean;
  accountId: string | null;
}

export interface EmailThreadMessageDto {
  activityId: string;
  direction: 'inbound' | 'outbound';
  subject: string;
  body: string | null;
  from: string | null;
  to: string[];
  occurredAt: string;
  draft: boolean;
}
