export type LeadStatus = 'New' | 'Contacted' | 'Qualified' | 'Disqualified';
export type ContactStatus = LeadStatus;
export type ReadinessTier = 'Hot' | 'Warm' | 'Cold';

export interface LeadReadiness {
  score: number;
  tier: ReadinessTier;
}

export interface Contact {
  id: string;
  businessName: string;
  contactName: string;
  contactTitle: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  description: string;
  sourceUrl: string;
  placeId?: string;
  notes: string;
  callScript?: string;
  emailSubject?: string;
  emailBody?: string;
  enrichedAt?: string;
  status: LeadStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LeadList {
  id: string;
  name: string;
  criteria: string;
  createdAt: string;
  updatedAt: string;
  contacts: Contact[];
}

export interface LeadListSummary {
  id: string;
  name: string;
  criteria: string;
  contactCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SessionInfo {
  username: string;
  hasApiKey: boolean;
  mode: 'vertex-ai' | 'api-key';
  vertexProject?: string;
  vertexLocation?: string;
  model: string;
}
