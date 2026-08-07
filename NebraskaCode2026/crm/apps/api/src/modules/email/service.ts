import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type {
  EmailIngestResult,
  EmailThreadMessageDto,
  InboundEmail,
  SendEmailInput,
} from '@crm/shared';
import type { Db } from '../../db/client.js';
import { accounts, activities, contacts } from '../../db/schema/index.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { withOrg, type Tx } from '../../lib/tenant.js';
import type { AiService } from '../../ai/service.js';
import { createActivity } from '../activities/service.js';
import { insertContact } from '../contacts/service.js';
import { analyzeCapture } from '../knowledge/service.js';
import type { AuthContext } from '../auth/service.js';
import type { MailProvider } from './provider.js';
import type { JobRunner } from '../../lib/jobs.js';
import { CAPTURE_JOB, type CaptureJobData } from '../knowledge/routes.js';

// Personal-mail domains never map to a company account.
const FREE_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
]);

const AI_SUMMARY_MIN_BODY = 200;

export function normalizeSubject(subject: string): string {
  let s = subject.trim();
  for (;;) {
    const stripped = s.replace(/^(re|fw|fwd|aw):\s*/i, '');
    if (stripped === s) break;
    s = stripped;
  }
  return s.toLowerCase();
}

function parseName(address: { email: string; name?: string | undefined }): {
  firstName: string;
  lastName: string;
} {
  if (address.name?.trim()) {
    const parts = address.name.trim().split(/\s+/);
    return { firstName: parts[0]!, lastName: parts.slice(1).join(' ') || '' };
  }
  const local = address.email.split('@')[0]!;
  const parts = local.split(/[._-]+/).filter(Boolean);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return { firstName: cap(parts[0] ?? local), lastName: parts.slice(1).map(cap).join(' ') };
}

function meta(row: typeof activities.$inferSelect): Record<string, unknown> {
  return (row.metadata ?? {}) as Record<string, unknown>;
}

async function findEmailByMeta(tx: Tx, key: string, value: string) {
  const [row] = await tx
    .select()
    .from(activities)
    .where(
      and(
        eq(activities.type, 'email'),
        isNull(activities.deletedAt),
        sql`${activities.metadata}->>${key} = ${value}`,
      ),
    )
    .orderBy(desc(activities.occurredAt))
    .limit(1);
  return row;
}

/** inReplyTo → provider id match; else recent same-subject same-counterpart; else new thread. */
async function resolveThreadKey(
  tx: Tx,
  params: { inReplyTo?: string | undefined; normalizedSubject: string; counterpartEmail: string },
): Promise<string> {
  if (params.inReplyTo) {
    const parent = await findEmailByMeta(tx, 'providerMessageId', params.inReplyTo);
    const key = parent ? meta(parent).threadKey : null;
    if (typeof key === 'string') return key;
  }
  const [bySubject] = await tx
    .select()
    .from(activities)
    .where(
      and(
        eq(activities.type, 'email'),
        isNull(activities.deletedAt),
        sql`${activities.metadata}->>'normalizedSubject' = ${params.normalizedSubject}`,
        sql`${activities.metadata}->>'counterpartEmail' = ${params.counterpartEmail}`,
      ),
    )
    .orderBy(desc(activities.occurredAt))
    .limit(1);
  const key = bySubject ? meta(bySubject).threadKey : null;
  if (typeof key === 'string') return key;
  return randomUUID();
}

async function scheduleSummarization(
  db: Db,
  ai: AiService,
  jobs: JobRunner | null,
  ctx: AuthContext,
  params: { activityId: string; content: string; links: CaptureJobData['links'] },
): Promise<void> {
  if (jobs) {
    await jobs.enqueue(CAPTURE_JOB, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      activityId: params.activityId,
      sourceType: 'email',
      content: params.content,
      links: params.links,
    } satisfies CaptureJobData);
    return;
  }
  await analyzeCapture(db, ai, ctx, {
    activityId: params.activityId,
    sourceType: 'email',
    content: params.content,
    links: params.links,
  });
}

/**
 * Inbound ingestion: dedup by provider message id, match-or-create the sender
 * contact, match the company by domain, thread, record the activity, and
 * schedule AI summarization for substantive bodies.
 */
export async function ingestInboundEmail(
  db: Db,
  ai: AiService,
  jobs: JobRunner | null,
  ctx: AuthContext,
  email: InboundEmail,
): Promise<EmailIngestResult> {
  const senderEmail = email.from.email;
  const senderDomain = senderEmail.split('@')[1]!;

  const prepared = await withOrg(db, ctx.organizationId, async (tx) => {
    // 1. duplicate detection (provider redeliveries, overlapping syncs)
    const existing = await findEmailByMeta(tx, 'providerMessageId', email.providerMessageId);
    if (existing) {
      return {
        duplicate: {
          activityId: existing.id,
          duplicate: true,
          threadKey: String(meta(existing).threadKey ?? ''),
          contactId: null,
          contactCreated: false,
          accountId: null,
        } satisfies EmailIngestResult,
      };
    }

    // 2. company matching by sender domain (never for personal-mail domains)
    let accountId: string | null = null;
    if (!FREE_MAIL_DOMAINS.has(senderDomain)) {
      const [account] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.domain, senderDomain), isNull(accounts.deletedAt)))
        .limit(1);
      accountId = account?.id ?? null;
    }

    // 3. contact match by email; auto-create when unknown
    let contactCreated = false;
    let [contact] = await tx
      .select({ id: contacts.id, accountId: contacts.accountId })
      .from(contacts)
      .where(and(eq(sql`lower(${contacts.email})`, senderEmail), isNull(contacts.deletedAt)))
      .limit(1);
    if (!contact) {
      const name = parseName(email.from);
      const created = await insertContact(tx, ctx, {
        firstName: name.firstName,
        lastName: name.lastName,
        email: senderEmail,
        ...(accountId ? { accountId } : {}),
      });
      contact = { id: created.id, accountId: created.accountId };
      contactCreated = true;
    } else if (!accountId && contact.accountId) {
      accountId = contact.accountId; // known contact carries its company
    }

    // 4. threading
    const normalizedSubject = normalizeSubject(email.subject);
    const threadKey = await resolveThreadKey(tx, {
      inReplyTo: email.inReplyTo,
      normalizedSubject,
      counterpartEmail: senderEmail,
    });

    return { data: { accountId, contact, contactCreated, threadKey, normalizedSubject } };
  });

  if ('duplicate' in prepared) return prepared.duplicate;
  const { accountId, contact, contactCreated, threadKey, normalizedSubject } = prepared.data;

  // 5. the email is a fact → activity + timeline on every linked record
  const activity = await createActivity(db, ctx, {
    type: 'email',
    direction: 'inbound',
    subject: email.subject,
    body: email.body,
    ...(email.receivedAt ? { occurredAt: email.receivedAt } : {}),
    metadata: {
      providerMessageId: email.providerMessageId,
      from: senderEmail,
      to: email.to.map((t) => t.email),
      cc: email.cc?.map((c) => c.email) ?? [],
      threadKey,
      normalizedSubject,
      counterpartEmail: senderEmail,
      ...(email.inReplyTo ? { inReplyTo: email.inReplyTo } : {}),
    },
    links: {
      contacts: [contact.id],
      ...(accountId ? { accounts: [accountId] } : {}),
    },
  });

  // 6. AI summarization for substantive emails
  if (email.body.length >= AI_SUMMARY_MIN_BODY) {
    await scheduleSummarization(db, ai, jobs, ctx, {
      activityId: activity.id,
      content: email.body,
      links: { contactId: contact.id, ...(accountId ? { accountId } : {}) },
    });
  }

  return {
    activityId: activity.id,
    duplicate: false,
    threadKey,
    contactId: contact.id,
    contactCreated,
    accountId,
  };
}

/** Outbound: send via the provider, then record the activity on the same thread. */
export async function sendEmail(
  db: Db,
  mail: MailProvider,
  ctx: AuthContext,
  input: SendEmailInput,
): Promise<{ activityId: string; threadKey: string; providerMessageId: string }> {
  const normalizedSubject = normalizeSubject(input.subject);
  const counterpartEmail = input.to[0]!;

  const { threadKey, replyToProviderId, contactId } = await withOrg(
    db,
    ctx.organizationId,
    async (tx) => {
      let key: string | null = null;
      let replyId: string | undefined;
      if (input.inReplyToActivityId) {
        const [parent] = await tx
          .select()
          .from(activities)
          .where(eq(activities.id, input.inReplyToActivityId))
          .limit(1);
        if (!parent || parent.type !== 'email') throw new ValidationError('reply target is not an email');
        const parentMeta = meta(parent);
        key = typeof parentMeta.threadKey === 'string' ? parentMeta.threadKey : null;
        replyId = typeof parentMeta.providerMessageId === 'string' ? parentMeta.providerMessageId : undefined;
      }
      if (!key) {
        key = await resolveThreadKey(tx, { normalizedSubject, counterpartEmail });
      }
      // auto-link the recipient contact when the caller didn't specify one
      let linkedContact = input.contactId ?? null;
      if (!linkedContact) {
        const [match] = await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(sql`lower(${contacts.email})`, counterpartEmail), isNull(contacts.deletedAt)))
          .limit(1);
        linkedContact = match?.id ?? null;
      }
      return { threadKey: key, replyToProviderId: replyId, contactId: linkedContact };
    },
  );

  const { providerMessageId } = await mail.send({
    to: input.to,
    cc: input.cc,
    subject: input.subject,
    body: input.body,
    inReplyTo: replyToProviderId,
  });

  const activity = await createActivity(db, ctx, {
    type: 'email',
    direction: 'outbound',
    subject: input.subject,
    body: input.body,
    metadata: {
      providerMessageId,
      from: ctx.email,
      to: input.to,
      cc: input.cc ?? [],
      threadKey,
      normalizedSubject,
      counterpartEmail,
    },
    links: {
      ...(contactId ? { contacts: [contactId] } : {}),
      ...(input.accountId ? { accounts: [input.accountId] } : {}),
      ...(input.dealId ? { deals: [input.dealId] } : {}),
    },
  });

  return { activityId: activity.id, threadKey, providerMessageId };
}

/** Send a Prompt-9 draft: transmit via the provider and clear the draft flag. */
export async function sendDraft(
  db: Db,
  mail: MailProvider,
  ctx: AuthContext,
  activityId: string,
  to: string[],
): Promise<{ providerMessageId: string }> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [draft] = await tx
      .select()
      .from(activities)
      .where(and(eq(activities.id, activityId), isNull(activities.deletedAt)))
      .limit(1);
    if (!draft || draft.type !== 'email') throw new NotFoundError('draft email not found');
    const draftMeta = meta(draft);
    if (draftMeta.draft !== true) throw new ValidationError('activity is not a draft');

    const { providerMessageId } = await mail.send({
      to,
      subject: draft.subject,
      body: draft.body ?? '',
    });
    await tx
      .update(activities)
      .set({
        metadata: {
          ...draftMeta,
          draft: false,
          sentAt: new Date().toISOString(),
          providerMessageId,
          to,
          counterpartEmail: to[0],
          normalizedSubject: normalizeSubject(draft.subject),
          threadKey: draftMeta.threadKey ?? randomUUID(),
          from: ctx.email,
        },
        updatedBy: ctx.userId,
      })
      .where(eq(activities.id, activityId));
    return { providerMessageId };
  });
}

export async function getThread(
  db: Db,
  ctx: AuthContext,
  threadKey: string,
): Promise<EmailThreadMessageDto[]> {
  const rows = await withOrg(db, ctx.organizationId, (tx) =>
    tx
      .select()
      .from(activities)
      .where(
        and(
          eq(activities.type, 'email'),
          isNull(activities.deletedAt),
          sql`${activities.metadata}->>'threadKey' = ${threadKey}`,
        ),
      )
      .orderBy(activities.occurredAt, activities.id),
  );
  return rows.map((row) => {
    const m = meta(row);
    return {
      activityId: row.id,
      direction: (row.direction ?? 'inbound') as 'inbound' | 'outbound',
      subject: row.subject,
      body: row.body,
      from: typeof m.from === 'string' ? m.from : null,
      to: Array.isArray(m.to) ? (m.to as string[]) : [],
      occurredAt: row.occurredAt.toISOString(),
      draft: m.draft === true,
    };
  });
}
