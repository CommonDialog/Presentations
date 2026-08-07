import { asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { aiConversations, aiMessages } from '../db/schema/index.js';
import { NotFoundError } from '../lib/errors.js';
import { withOrg } from '../lib/tenant.js';
import type { AuthContext } from '../modules/auth/service.js';

export async function createConversation(
  db: Db,
  ctx: AuthContext,
  title?: string,
): Promise<{ id: string }> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [row] = await tx
      .insert(aiConversations)
      .values({ organizationId: ctx.organizationId, userId: ctx.userId, title: title ?? null })
      .returning({ id: aiConversations.id });
    return row!;
  });
}

export async function appendMessage(
  db: Db,
  ctx: AuthContext,
  conversationId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
): Promise<void> {
  await withOrg(db, ctx.organizationId, async (tx) => {
    const [conversation] = await tx
      .select({ id: aiConversations.id })
      .from(aiConversations)
      .where(eq(aiConversations.id, conversationId))
      .limit(1);
    if (!conversation) throw new NotFoundError('conversation not found');
    await tx.insert(aiMessages).values({ conversationId, role, content });
    await tx
      .update(aiConversations)
      .set({ updatedAt: new Date() })
      .where(eq(aiConversations.id, conversationId));
  });
}

export interface ConversationHistory {
  id: string;
  title: string | null;
  messages: { role: string; content: string; createdAt: string }[];
}

export async function getConversation(
  db: Db,
  ctx: AuthContext,
  conversationId: string,
): Promise<ConversationHistory> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [conversation] = await tx
      .select()
      .from(aiConversations)
      .where(eq(aiConversations.id, conversationId))
      .limit(1);
    if (!conversation) throw new NotFoundError('conversation not found');
    const messages = await tx
      .select()
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, conversationId))
      .orderBy(asc(aiMessages.createdAt), asc(aiMessages.id));
    return {
      id: conversation.id,
      title: conversation.title,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  });
}

export async function listConversations(
  db: Db,
  ctx: AuthContext,
): Promise<{ id: string; title: string | null; updatedAt: string }[]> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const rows = await tx
      .select()
      .from(aiConversations)
      .where(eq(aiConversations.userId, ctx.userId))
      .orderBy(desc(aiConversations.updatedAt))
      .limit(50);
    return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt.toISOString() }));
  });
}
