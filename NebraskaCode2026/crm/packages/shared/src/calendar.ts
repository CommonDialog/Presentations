import { z } from 'zod';
import { emailAddressSchema } from './email.js';

/** What a calendar provider webhook (or the simulator) delivers for an event. */
export const calendarEventSchema = z
  .object({
    providerEventId: z.string().min(1).max(300),
    title: z.string().trim().min(1).max(300),
    description: z.string().max(20_000).optional(),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    location: z.string().trim().max(300).optional(),
    organizer: emailAddressSchema.optional(),
    attendees: z.array(emailAddressSchema).min(1).max(50),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: 'endsAt must be after startsAt',
  });
export type CalendarEventInput = z.infer<typeof calendarEventSchema>;

export const createEventSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().max(20_000).optional(),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    location: z.string().trim().max(300).optional(),
    attendeeEmails: z.array(z.email().toLowerCase()).min(1).max(50),
    accountId: z.uuid().optional(),
    dealId: z.uuid().optional(),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: 'endsAt must be after startsAt',
  });
export type CreateEventInput = z.infer<typeof createEventSchema>;

export interface CalendarIngestResult {
  activityId: string;
  duplicate: boolean;
  matchedContactIds: string[];
  matchedAccountIds: string[];
  unmatchedAttendees: string[];
}

export interface UpcomingMeetingDto {
  activityId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  attendees: { email: string; name?: string | undefined }[];
  accountIds: string[];
  contactIds: string[];
}

/** LLM output for meeting preparation. */
export const meetingPrepSchema = z.object({
  objectives: z.array(z.string()),
  talkingPoints: z.array(z.string()),
  openQuestions: z.array(z.string()),
  risks: z.array(z.string()),
  attendeeNotes: z.array(z.object({ name: z.string(), note: z.string() })),
});
export type MeetingPrep = z.infer<typeof meetingPrepSchema>;

export interface MeetingPrepDto {
  id: string;
  activityId: string;
  prep: MeetingPrep;
  createdAt: string;
}

export const summarizeMeetingSchema = z.object({
  transcript: z.string().min(10).max(200_000),
});
