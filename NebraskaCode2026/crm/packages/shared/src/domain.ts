// Domain vocabulary and state machines. This file is the executable form of
// docs/03-domain-model.md: persistence-free, shared by API services and web UI.

export const leadStatuses = ['new', 'working', 'qualified', 'disqualified', 'converted'] as const;
export type LeadStatus = (typeof leadStatuses)[number];

export const dealStatuses = ['open', 'won', 'lost'] as const;
export type DealStatus = (typeof dealStatuses)[number];

export const activityTypes = ['email', 'call', 'meeting', 'note'] as const;
export type ActivityType = (typeof activityTypes)[number];

export const activityDirections = ['inbound', 'outbound'] as const;
export type ActivityDirection = (typeof activityDirections)[number];

export const taskStatuses = ['open', 'in_progress', 'completed', 'canceled'] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export const taskPriorities = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = (typeof taskPriorities)[number];

export const projectStatuses = ['planned', 'active', 'on_hold', 'completed', 'canceled'] as const;
export type ProjectStatus = (typeof projectStatuses)[number];

export const milestoneStatuses = ['pending', 'in_progress', 'completed'] as const;
export type MilestoneStatus = (typeof milestoneStatuses)[number];

export const aiArtifactKinds = ['summary', 'insight', 'proposal', 'conversation'] as const;
export type AiArtifactKind = (typeof aiArtifactKinds)[number];

export const aiArtifactStatuses = ['pending', 'approved', 'rejected', 'applied'] as const;
export type AiArtifactStatus = (typeof aiArtifactStatuses)[number];

export const customFieldTypes = [
  'text',
  'number',
  'date',
  'boolean',
  'select',
  'multiselect',
  'url',
  'email',
] as const;
export type CustomFieldType = (typeof customFieldTypes)[number];

export const customFieldEntityTypes = ['account', 'contact', 'deal', 'lead', 'project'] as const;
export type CustomFieldEntityType = (typeof customFieldEntityTypes)[number];

type TransitionMap<S extends string> = Readonly<Record<S, readonly S[]>>;

export const leadTransitions: TransitionMap<LeadStatus> = {
  new: ['working', 'qualified', 'disqualified'],
  working: ['qualified', 'disqualified'],
  qualified: ['converted', 'disqualified'],
  disqualified: ['working'], // re-engage
  converted: [], // terminal; conversion is one-way
};

export const dealStatusTransitions: TransitionMap<DealStatus> = {
  open: ['won', 'lost'],
  won: ['open'], // reopen to correct a mistake; clears closed fields
  lost: ['open'],
};

export const taskTransitions: TransitionMap<TaskStatus> = {
  open: ['in_progress', 'completed', 'canceled'],
  in_progress: ['open', 'completed', 'canceled'],
  completed: ['open'], // reopen
  canceled: ['open'],
};

export const projectTransitions: TransitionMap<ProjectStatus> = {
  planned: ['active', 'canceled'],
  active: ['on_hold', 'completed', 'canceled'],
  on_hold: ['active', 'canceled'],
  completed: ['active'], // reopen
  canceled: ['planned'],
};

export const milestoneTransitions: TransitionMap<MilestoneStatus> = {
  pending: ['in_progress', 'completed'],
  in_progress: ['pending', 'completed'],
  completed: ['in_progress'],
};

// Proposals require review; other artifact kinds are born approved and never move.
export const aiProposalTransitions: TransitionMap<AiArtifactStatus> = {
  pending: ['approved', 'rejected'],
  approved: ['applied'],
  rejected: [],
  applied: [],
};

export function canTransition<S extends string>(
  map: TransitionMap<S>,
  from: S,
  to: S,
): boolean {
  return map[from].includes(to);
}
