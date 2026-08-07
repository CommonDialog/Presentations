import { z } from 'zod';
import { taskPriorities } from './domain.js';

const pillar = z.object({
  present: z.boolean(),
  assessment: z.string(),
});

export const activeInsightSchema = z.object({
  meddic: z.object({
    metrics: pillar,
    economicBuyer: pillar,
    decisionCriteria: pillar,
    decisionProcess: pillar,
    identifyPain: pillar,
    champion: pillar,
  }),
  bant: z.object({
    budget: pillar,
    authority: pillar,
    need: pillar,
    timeline: pillar,
  }),
  buyingSignals: z.array(z.string()),
  risks: z.array(
    z.object({
      description: z.string(),
      severity: z.enum(['low', 'medium', 'high']),
    }),
  ),
  competitors: z.array(z.string()),
  decisionMakers: z.array(
    z.object({
      name: z.string(),
      role: z.string(),
      isChampion: z.boolean(),
    }),
  ),
  nextActions: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      dueInDays: z.number().int(),
      priority: z.enum(taskPriorities),
    }),
  ),
  health: z.enum(['healthy', 'at_risk', 'critical']),
  confidence: z.number().int(),
  reasoning: z.string(),
});
export type ActiveInsight = z.infer<typeof activeInsightSchema>;

export interface DealInsightDto {
  id: string;
  dealId: string;
  analysis: ActiveInsight;
  createdAt: string;
}
