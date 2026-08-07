import { z } from 'zod';

export const copilotIntents = [
  'answer_question',
  'summarize_account',
  'prepare_meeting',
  'draft_email',
  'recommend_next_actions',
  'predict_risks',
  'generate_report',
  'navigate',
] as const;
export type CopilotIntent = (typeof copilotIntents)[number];

export const copilotAskSchema = z.object({
  conversationId: z.uuid().optional(),
  message: z.string().trim().min(1).max(2000),
});
export type CopilotAskInput = z.infer<typeof copilotAskSchema>;

/** A CRM record the answer was grounded in — shown as a chip in the UI. */
export interface CopilotSourceDto {
  type: string;
  id: string;
  title: string;
  url: string | null;
}

export interface CopilotResponseDto {
  conversationId: string;
  intent: CopilotIntent;
  message: string;
  sources: CopilotSourceDto[];
  /** Set when the copilot resolved a place to go ("open the Acme account"). */
  navigation: { url: string; label: string } | null;
}

export interface CopilotConversationSummaryDto {
  id: string;
  title: string | null;
  updatedAt: string;
}

export interface CopilotMessageDto {
  role: string;
  content: string;
  createdAt: string;
}
