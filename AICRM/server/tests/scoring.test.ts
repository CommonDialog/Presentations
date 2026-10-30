import { describe, it, expect } from 'vitest';
import { computeLeadScore, getReadinessTier, getLeadReadiness, ScorableContact } from '../../client/src/scoring';

const baseContact: ScorableContact = {
  phone: '',
  email: '',
  contactName: '',
  website: '',
  address: '',
  description: '',
  notes: '',
  callScript: '',
  status: 'New',
};

describe('Lead Readiness Scoring (AC-1 & AC-2)', () => {
  it('AC-1: computes full score (100) when all fields populated and status is Qualified', () => {
    const full: ScorableContact = {
      phone: '555-0100',
      email: 'test@example.com',
      contactName: 'Jane Doe',
      website: 'https://example.com',
      address: '123 Main St',
      description: 'Desc',
      notes: 'Note',
      callScript: 'Hello',
      status: 'Qualified',
    };
    expect(computeLeadScore(full)).toBe(100);
  });

  it('AC-1: treats whitespace-only strings as empty and applies New status (+5)', () => {
    const whitespace: ScorableContact = {
      ...baseContact,
      phone: '   ',
      email: '\t\n',
      contactName: '  ',
      status: 'New',
    };
    expect(computeLeadScore(whitespace)).toBe(5);
  });

  it('AC-1: forces score to 0 when status is Disqualified regardless of populated fields', () => {
    const disqualified: ScorableContact = {
      phone: '555-0100',
      email: 'a@b.com',
      contactName: 'John',
      website: 'https://x.com',
      address: '1 St',
      description: 'Info',
      notes: 'Notes',
      callScript: 'Script',
      status: 'Disqualified',
    };
    expect(computeLeadScore(disqualified)).toBe(0);
  });

  it('AC-1: awards +10 once if either description or notes is populated (not +20)', () => {
    expect(computeLeadScore({ ...baseContact, description: 'A', notes: '', status: 'Contacted' })).toBe(20);
    expect(computeLeadScore({ ...baseContact, description: '', notes: 'B', status: 'Contacted' })).toBe(20);
    expect(computeLeadScore({ ...baseContact, description: 'A', notes: 'B', status: 'Contacted' })).toBe(20);
  });

  it('AC-2: maps boundary scores to Cold (<45), Warm (45-74), and Hot (>=75)', () => {
    expect(getReadinessTier(0)).toBe('Cold');
    expect(getReadinessTier(44)).toBe('Cold');
    expect(getReadinessTier(45)).toBe('Warm');
    expect(getReadinessTier(74)).toBe('Warm');
    expect(getReadinessTier(75)).toBe('Hot');
    expect(getReadinessTier(100)).toBe('Hot');
  });

  it('AC-1 & AC-2: getLeadReadiness returns combined score and tier', () => {
    const warmContact: ScorableContact = {
      ...baseContact,
      phone: '555-1234', // +20
      email: 'info@acme.com', // +20
      status: 'New', // +5 => 45
    };
    expect(getLeadReadiness(warmContact)).toEqual({ score: 45, tier: 'Warm' });
  });
});
