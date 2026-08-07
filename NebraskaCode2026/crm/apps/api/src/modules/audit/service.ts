import { auditLog } from '../../db/schema/index.js';
import type { DbLike } from '../../lib/tenant.js';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'restore'
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'enrich';

export interface AuditEntry {
  organizationId: string;
  userId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  changes?: Record<string, unknown> | null;
}

// Must be called inside a tenant transaction (withOrg) — audit_log is under RLS.
export async function recordAudit(tx: DbLike, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    organizationId: entry.organizationId,
    userId: entry.userId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    changes: entry.changes ?? null,
  });
}
