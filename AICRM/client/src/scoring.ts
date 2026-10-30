import { Contact, LeadReadiness, ReadinessTier } from './types';

export function hasText(v?: string): boolean {
  return Boolean(v && v.trim().length > 0);
}

export type ScorableContact = Pick<
  Contact,
  | 'phone'
  | 'email'
  | 'contactName'
  | 'website'
  | 'address'
  | 'description'
  | 'notes'
  | 'callScript'
  | 'status'
>;

export function computeLeadScore(contact: ScorableContact): number {
  if (contact.status === 'Disqualified') {
    return 0;
  }

  let score = 0;

  if (hasText(contact.phone)) score += 20;
  if (hasText(contact.email)) score += 20;
  if (hasText(contact.contactName)) score += 15;
  if (hasText(contact.website)) score += 10;
  if (hasText(contact.address)) score += 5;
  if (hasText(contact.description) || hasText(contact.notes)) score += 10;
  if (hasText(contact.callScript)) score += 5;

  if (contact.status === 'Qualified') {
    score += 15;
  } else if (contact.status === 'Contacted') {
    score += 10;
  } else if (contact.status === 'New') {
    score += 5;
  }

  return Math.max(0, Math.min(100, score));
}

export function getReadinessTier(score: number): ReadinessTier {
  if (score >= 75) return 'Hot';
  if (score >= 45) return 'Warm';
  return 'Cold';
}

export function getLeadReadiness(contact: ScorableContact): LeadReadiness {
  const score = computeLeadScore(contact);
  return {
    score,
    tier: getReadinessTier(score),
  };
}
