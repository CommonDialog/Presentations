import { createHash } from 'node:crypto';

export interface CompanyEnrichment {
  industry?: string | undefined;
  description?: string | undefined;
  website?: string | undefined;
  employeeCount?: number | undefined;
  linkedinUrl?: string | undefined;
}

export interface PersonEnrichment {
  title?: string | undefined;
  location?: string | undefined;
  linkedinUrl?: string | undefined;
}

/**
 * Data-enrichment provider abstraction. The simulated LinkedIn provider below
 * is the default; Clearbit/Apollo/People Data Labs adapters implement the same
 * interface when a real key is configured (real interfaces, fake providers —
 * the product runs end-to-end without external accounts).
 */
export interface EnrichmentProvider {
  readonly name: string;
  enrichCompany(domain: string): Promise<CompanyEnrichment | null>;
  enrichPerson(email: string, name?: string): Promise<PersonEnrichment | null>;
}

const INDUSTRIES = [
  'Software',
  'Manufacturing',
  'Financial Services',
  'Healthcare',
  'Retail',
  'Logistics',
  'Education',
  'Media',
];

const TITLES = [
  'VP of Operations',
  'Director of Engineering',
  'Head of Procurement',
  'Chief Revenue Officer',
  'Product Manager',
  'IT Manager',
];

const CITIES = ['Omaha, NE', 'Chicago, IL', 'Austin, TX', 'Denver, CO', 'Minneapolis, MN'];

function pick<T>(list: T[], seed: string): T {
  const hash = createHash('sha256').update(seed).digest();
  return list[hash[0]! % list.length]!;
}

/** Deterministic simulated LinkedIn enrichment: same input, same answer. */
export class FakeLinkedInProvider implements EnrichmentProvider {
  readonly name = 'linkedin (simulated)';

  async enrichCompany(domain: string): Promise<CompanyEnrichment | null> {
    if (!domain.includes('.')) return null;
    const slug = domain.split('.')[0]!;
    const hash = createHash('sha256').update(domain).digest();
    return {
      industry: pick(INDUSTRIES, domain),
      description: `${slug.charAt(0).toUpperCase()}${slug.slice(1)} is a ${pick(INDUSTRIES, domain).toLowerCase()} company (enriched via ${this.name}).`,
      website: `https://${domain}`,
      employeeCount: 10 + (hash.readUInt16BE(1) % 4990),
      linkedinUrl: `https://www.linkedin.com/company/${slug}`,
    };
  }

  async enrichPerson(email: string, name?: string): Promise<PersonEnrichment | null> {
    if (!email.includes('@')) return null;
    const local = email.split('@')[0]!;
    const slug = (name ?? local).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return {
      title: pick(TITLES, email),
      location: pick(CITIES, email),
      linkedinUrl: `https://www.linkedin.com/in/${slug || local}`,
    };
  }
}
