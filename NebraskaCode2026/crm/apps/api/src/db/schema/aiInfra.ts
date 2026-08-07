import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { timestamps, uuidPk } from './helpers.js';
import { organizations, users } from './identity.js';

// Global (not tenant-scoped) prompt registry: templates are product config,
// seeded from code and versioned on update.
export const aiPrompts = pgTable('ai_prompts', {
  name: text('name').primaryKey(),
  version: integer('version').notNull().default(1),
  systemTemplate: text('system_template').notNull(),
  userTemplate: text('user_template').notNull(),
  ...timestamps,
});

// One row per LLM/embedding call: the cost-tracking and observability spine.
export const aiCalls = pgTable(
  'ai_calls',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    model: text('model'),
    operation: text('operation').notNull(), // complete | structured | stream | embed
    purpose: text('purpose').notNull(), // e.g. "knowledge.summarize_email"
    promptName: text('prompt_name'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
    latencyMs: integer('latency_ms').notNull(),
    attempts: integer('attempts').notNull().default(1),
    success: boolean('success').notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_calls_org_created_idx').on(t.organizationId, t.createdAt.desc()),
    index('ai_calls_org_purpose_idx').on(t.organizationId, t.purpose),
  ],
);

export const aiConversations = pgTable(
  'ai_conversations',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title'),
    ...timestamps,
  },
  (t) => [index('ai_conversations_org_user_idx').on(t.organizationId, t.userId, t.updatedAt.desc())],
);

export const aiMessages = pgTable(
  'ai_messages',
  {
    id: uuidPk(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => aiConversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_messages_conversation_idx').on(t.conversationId, t.createdAt),
    check('ai_messages_role', sql`${t.role} in ('user', 'assistant', 'system')`),
  ],
);

// pgvector is not installed on this server; embeddings persist as real[] and
// similarity runs app-side. Fine at demo scale — swap to vector(n) + HNSW when
// pgvector is available (documented in docs/08-ai-foundation.md).
export const aiEmbeddings = pgTable(
  'ai_embeddings',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    chunkIndex: integer('chunk_index').notNull().default(0),
    content: text('content').notNull(),
    embedding: real('embedding').array().notNull(),
    provider: text('provider').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ai_embeddings_entity_chunk_unique').on(t.entityType, t.entityId, t.chunkIndex),
    index('ai_embeddings_org_entity_idx').on(t.organizationId, t.entityType),
  ],
);
