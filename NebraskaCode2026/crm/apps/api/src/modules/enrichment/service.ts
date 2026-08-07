import { and, eq, isNull } from 'drizzle-orm';
import type { AccountEnrichmentDto, ContactEnrichmentDto } from '@crm/shared';
import type { Db } from '../../db/client.js';
import { accounts, contacts } from '../../db/schema/index.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { withOrg } from '../../lib/tenant.js';
import { recordAudit } from '../audit/service.js';
import type { AuthContext } from '../auth/service.js';
import type { EnrichmentProvider } from './provider.js';

// Enrichment fills EMPTY fields only — it never overwrites data a human
// entered. Everything the provider returned comes back as `suggestions`
// so the UI can show what else is known (e.g. the LinkedIn URL).

export async function enrichAccount(
  db: Db,
  provider: EnrichmentProvider,
  ctx: AuthContext,
  accountId: string,
): Promise<AccountEnrichmentDto> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [account] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), isNull(accounts.deletedAt)))
      .limit(1);
    if (!account) throw new NotFoundError('account not found');

    const domain =
      account.domain ??
      (account.website ? new URL(account.website).hostname.replace(/^www\./, '') : null);
    if (!domain) throw new ValidationError('account needs a domain or website to enrich');

    const data = await provider.enrichCompany(domain);
    if (!data) return { provider: provider.name, applied: [], suggestions: {} };

    const patch: Partial<typeof accounts.$inferInsert> = {};
    const applied: string[] = [];
    if (!account.industry && data.industry) {
      patch.industry = data.industry;
      applied.push('industry');
    }
    if (!account.description && data.description) {
      patch.description = data.description;
      applied.push('description');
    }
    if (!account.website && data.website) {
      patch.website = data.website;
      applied.push('website');
    }

    if (applied.length > 0) {
      await tx
        .update(accounts)
        .set({ ...patch, updatedBy: ctx.userId })
        .where(eq(accounts.id, accountId));
      await recordAudit(tx, {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        action: 'enrich',
        entityType: 'account',
        entityId: accountId,
        changes: { provider: provider.name, applied },
      });
    }

    return { provider: provider.name, applied, suggestions: data };
  });
}

export async function enrichContact(
  db: Db,
  provider: EnrichmentProvider,
  ctx: AuthContext,
  contactId: string,
): Promise<ContactEnrichmentDto> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [contact] = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, contactId), isNull(contacts.deletedAt)))
      .limit(1);
    if (!contact) throw new NotFoundError('contact not found');
    if (!contact.email) throw new ValidationError('contact needs an email to enrich');

    const data = await provider.enrichPerson(
      contact.email,
      `${contact.firstName} ${contact.lastName}`.trim(),
    );
    if (!data) return { provider: provider.name, applied: [], suggestions: {} };

    const applied: string[] = [];
    if (!contact.title && data.title) {
      await tx
        .update(contacts)
        .set({ title: data.title, updatedBy: ctx.userId })
        .where(eq(contacts.id, contactId));
      applied.push('title');
      await recordAudit(tx, {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        action: 'enrich',
        entityType: 'contact',
        entityId: contactId,
        changes: { provider: provider.name, applied },
      });
    }

    return { provider: provider.name, applied, suggestions: data };
  });
}
