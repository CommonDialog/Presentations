import { eq, isNull, and, sql } from 'drizzle-orm';
import type { ImportEntityType, ImportResultDto } from '@crm/shared';
import type { Db } from '../../db/client.js';
import {
  accounts,
  contacts,
  deals,
  leads,
  pipelineStages,
  projects,
} from '../../db/schema/index.js';
import { parseCsv, toCsv } from '../../lib/csv.js';
import { ValidationError } from '../../lib/errors.js';
import { withOrg } from '../../lib/tenant.js';
import { insertAccount } from '../accounts/service.js';
import { insertContact } from '../contacts/service.js';
import { createLead } from '../leads/service.js';
import type { AuthContext } from '../auth/service.js';

// ---------- import ----------

function normalizeHeader(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Accepted column names (normalized) per entity; first column set is required. */
const COLUMNS: Record<ImportEntityType, Record<string, string>> = {
  account: {
    name: 'name',
    domain: 'domain',
    website: 'website',
    industry: 'industry',
    phone: 'phone',
    description: 'description',
  },
  contact: {
    firstname: 'firstName',
    lastname: 'lastName',
    email: 'email',
    phone: 'phone',
    title: 'title',
    account: 'accountName',
    accountname: 'accountName',
    company: 'accountName',
  },
  lead: {
    firstname: 'firstName',
    lastname: 'lastName',
    company: 'company',
    email: 'email',
    phone: 'phone',
    source: 'source',
  },
};

export async function importCsv(
  db: Db,
  ctx: AuthContext,
  entityType: ImportEntityType,
  csv: string,
): Promise<ImportResultDto> {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new ValidationError('CSV needs a header row and at least one data row');
  const mapping = COLUMNS[entityType];
  const header = rows[0]!.map((h) => mapping[normalizeHeader(h)] ?? null);
  if (header.every((h) => h === null)) {
    throw new ValidationError(
      `no recognized columns — expected some of: ${[...new Set(Object.values(mapping))].join(', ')}`,
    );
  }

  const result: ImportResultDto = { entityType, created: 0, skipped: [] };

  for (let r = 1; r < rows.length; r++) {
    const record: Record<string, string> = {};
    rows[r]!.forEach((cell, c) => {
      const key = header[c];
      if (key && cell.trim() !== '') record[key] = cell.trim();
    });
    try {
      await importRow(db, ctx, entityType, record);
      result.created += 1;
    } catch (error) {
      result.skipped.push({
        row: r + 1,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

async function importRow(
  db: Db,
  ctx: AuthContext,
  entityType: ImportEntityType,
  record: Record<string, string>,
): Promise<void> {
  if (entityType === 'account') {
    if (!record.name) throw new ValidationError('missing name');
    await withOrg(db, ctx.organizationId, async (tx) => {
      const [dup] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(sql`lower(${accounts.name})`, record.name!.toLowerCase()), isNull(accounts.deletedAt)))
        .limit(1);
      if (dup) throw new ValidationError(`account "${record.name}" already exists`);
      await insertAccount(tx, ctx, {
        name: record.name!,
        ...(record.domain ? { domain: record.domain } : {}),
        ...(record.website ? { website: record.website } : {}),
        ...(record.industry ? { industry: record.industry } : {}),
        ...(record.phone ? { phone: record.phone } : {}),
        ...(record.description ? { description: record.description } : {}),
      });
    });
    return;
  }

  if (entityType === 'contact') {
    if (!record.firstName || !record.lastName) throw new ValidationError('missing firstName/lastName');
    await withOrg(db, ctx.organizationId, async (tx) => {
      const email = record.email?.toLowerCase();
      if (email) {
        const [dup] = await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(sql`lower(${contacts.email})`, email), isNull(contacts.deletedAt)))
          .limit(1);
        if (dup) throw new ValidationError(`contact with email ${email} already exists`);
      }
      let accountId: string | undefined;
      if (record.accountName) {
        const [account] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(
            and(eq(sql`lower(${accounts.name})`, record.accountName.toLowerCase()), isNull(accounts.deletedAt)),
          )
          .limit(1);
        accountId = account?.id;
      }
      await insertContact(tx, ctx, {
        firstName: record.firstName!,
        lastName: record.lastName!,
        ...(email ? { email } : {}),
        ...(record.phone ? { phone: record.phone } : {}),
        ...(record.title ? { title: record.title } : {}),
        ...(accountId ? { accountId } : {}),
      });
    });
    return;
  }

  // lead
  if (!record.firstName && !record.lastName && !record.company) {
    throw new ValidationError('a lead needs a name or a company');
  }
  await createLead(db, ctx, {
    ...(record.firstName ? { firstName: record.firstName } : {}),
    ...(record.lastName ? { lastName: record.lastName } : {}),
    ...(record.company ? { company: record.company } : {}),
    ...(record.email ? { email: record.email } : {}),
    ...(record.phone ? { phone: record.phone } : {}),
    ...(record.source ? { source: record.source } : {}),
  });
}

// ---------- export ----------

export async function exportCsv(
  db: Db,
  ctx: AuthContext,
  entityType: 'account' | 'contact' | 'deal' | 'lead' | 'project',
): Promise<{ filename: string; csv: string }> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    switch (entityType) {
      case 'account': {
        const rows = await tx.select().from(accounts).where(isNull(accounts.deletedAt)).orderBy(accounts.name);
        return {
          filename: 'accounts.csv',
          csv: toCsv(
            ['name', 'domain', 'website', 'industry', 'phone', 'description', 'createdAt'],
            rows.map((r) => [r.name, r.domain, r.website, r.industry, r.phone, r.description, r.createdAt.toISOString()]),
          ),
        };
      }
      case 'contact': {
        const rows = await tx
          .select({ c: contacts, accountName: accounts.name })
          .from(contacts)
          .leftJoin(accounts, eq(accounts.id, contacts.accountId))
          .where(isNull(contacts.deletedAt))
          .orderBy(contacts.lastName);
        return {
          filename: 'contacts.csv',
          csv: toCsv(
            ['firstName', 'lastName', 'email', 'phone', 'title', 'account', 'createdAt'],
            rows.map((r) => [
              r.c.firstName,
              r.c.lastName,
              r.c.email,
              r.c.phone,
              r.c.title,
              r.accountName,
              r.c.createdAt.toISOString(),
            ]),
          ),
        };
      }
      case 'deal': {
        const rows = await tx
          .select({ d: deals, accountName: accounts.name, stageName: pipelineStages.name })
          .from(deals)
          .innerJoin(accounts, eq(accounts.id, deals.accountId))
          .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
          .where(isNull(deals.deletedAt))
          .orderBy(deals.name);
        return {
          filename: 'deals.csv',
          csv: toCsv(
            ['name', 'account', 'stage', 'status', 'amount', 'currency', 'expectedCloseDate', 'closedAt', 'createdAt'],
            rows.map((r) => [
              r.d.name,
              r.accountName,
              r.stageName,
              r.d.status,
              r.d.amount,
              r.d.currency,
              r.d.expectedCloseDate,
              r.d.closedAt?.toISOString() ?? null,
              r.d.createdAt.toISOString(),
            ]),
          ),
        };
      }
      case 'lead': {
        const rows = await tx.select().from(leads).where(isNull(leads.deletedAt)).orderBy(leads.createdAt);
        return {
          filename: 'leads.csv',
          csv: toCsv(
            ['firstName', 'lastName', 'company', 'email', 'phone', 'source', 'status', 'createdAt'],
            rows.map((r) => [r.firstName, r.lastName, r.company, r.email, r.phone, r.source, r.status, r.createdAt.toISOString()]),
          ),
        };
      }
      case 'project': {
        const rows = await tx
          .select({ p: projects, accountName: accounts.name })
          .from(projects)
          .innerJoin(accounts, eq(accounts.id, projects.accountId))
          .where(isNull(projects.deletedAt))
          .orderBy(projects.name);
        return {
          filename: 'projects.csv',
          csv: toCsv(
            ['name', 'account', 'status', 'startDate', 'dueDate', 'completedAt', 'createdAt'],
            rows.map((r) => [
              r.p.name,
              r.accountName,
              r.p.status,
              r.p.startDate,
              r.p.dueDate,
              r.p.completedAt?.toISOString() ?? null,
              r.p.createdAt.toISOString(),
            ]),
          ),
        };
      }
    }
  });
}
