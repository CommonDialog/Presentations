import { and, desc, eq, sql } from 'drizzle-orm';
import type { NotificationDto } from '@crm/shared';
import type { Db } from '../../db/client.js';
import { notifications } from '../../db/schema/index.js';
import { NotFoundError } from '../../lib/errors.js';
import { withOrg } from '../../lib/tenant.js';
import type { AuthContext } from '../auth/service.js';

export async function pushNotification(
  db: Db,
  organizationId: string,
  userId: string,
  message: string,
  link?: string,
): Promise<void> {
  await withOrg(db, organizationId, (tx) =>
    tx.insert(notifications).values({ organizationId, userId, message, link: link ?? null }),
  );
}

export async function listNotifications(
  db: Db,
  ctx: AuthContext,
): Promise<{ notifications: NotificationDto[]; unread: number }> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const rows = await tx
      .select()
      .from(notifications)
      .where(eq(notifications.userId, ctx.userId))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    const [count] = await tx
      .select({ unread: sql<number>`count(*) filter (where not read)::int` })
      .from(notifications)
      .where(eq(notifications.userId, ctx.userId));
    return {
      notifications: rows.map((r) => ({
        id: r.id,
        message: r.message,
        link: r.link,
        read: r.read,
        createdAt: r.createdAt.toISOString(),
      })),
      unread: count?.unread ?? 0,
    };
  });
}

export async function markNotificationRead(db: Db, ctx: AuthContext, id: string): Promise<void> {
  await withOrg(db, ctx.organizationId, async (tx) => {
    const [row] = await tx
      .update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.id, id), eq(notifications.userId, ctx.userId)))
      .returning({ id: notifications.id });
    if (!row) throw new NotFoundError('notification not found');
  });
}
