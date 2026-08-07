import { describe, expect, it } from 'vitest';
import {
  aiProposalTransitions,
  canTransition,
  dealStatusTransitions,
  leadStatuses,
  leadTransitions,
  milestoneTransitions,
  projectTransitions,
  taskTransitions,
} from '../src/domain.js';

describe('lead state machine', () => {
  it('converted is terminal', () => {
    expect(leadTransitions.converted).toHaveLength(0);
  });

  it('only qualified leads convert', () => {
    for (const status of leadStatuses) {
      expect(canTransition(leadTransitions, status, 'converted')).toBe(status === 'qualified');
    }
  });

  it('disqualified leads can be re-worked', () => {
    expect(canTransition(leadTransitions, 'disqualified', 'working')).toBe(true);
  });
});

describe('deal status machine', () => {
  it('open closes to won or lost; closed reopens only to open', () => {
    expect(canTransition(dealStatusTransitions, 'open', 'won')).toBe(true);
    expect(canTransition(dealStatusTransitions, 'open', 'lost')).toBe(true);
    expect(canTransition(dealStatusTransitions, 'won', 'lost')).toBe(false);
    expect(canTransition(dealStatusTransitions, 'lost', 'won')).toBe(false);
    expect(canTransition(dealStatusTransitions, 'won', 'open')).toBe(true);
  });
});

describe('ai proposal machine', () => {
  it('never applies without approval', () => {
    expect(canTransition(aiProposalTransitions, 'pending', 'applied')).toBe(false);
    expect(canTransition(aiProposalTransitions, 'approved', 'applied')).toBe(true);
  });

  it('rejected and applied are terminal', () => {
    expect(aiProposalTransitions.rejected).toHaveLength(0);
    expect(aiProposalTransitions.applied).toHaveLength(0);
  });
});

describe('task/project/milestone machines', () => {
  it('all closed states are reopenable', () => {
    expect(canTransition(taskTransitions, 'completed', 'open')).toBe(true);
    expect(canTransition(taskTransitions, 'canceled', 'open')).toBe(true);
    expect(canTransition(projectTransitions, 'completed', 'active')).toBe(true);
    expect(canTransition(milestoneTransitions, 'completed', 'in_progress')).toBe(true);
  });

  it('no state transitions to itself', () => {
    for (const map of [taskTransitions, projectTransitions, milestoneTransitions]) {
      for (const [from, targets] of Object.entries(map)) {
        expect(targets).not.toContain(from);
      }
    }
  });
});
