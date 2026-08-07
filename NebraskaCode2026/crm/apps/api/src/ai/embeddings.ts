import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { aiEmbeddings } from '../db/schema/index.js';
import { withOrg } from '../lib/tenant.js';
import { cosineSimilarity } from './fakeProvider.js';
import type { AiService } from './service.js';

/** Replace the stored embedding chunks for one entity. */
export async function upsertEntityEmbeddings(
  db: Db,
  ai: AiService,
  params: {
    organizationId: string;
    entityType: string;
    entityId: string;
    chunks: string[];
    purpose?: string;
  },
): Promise<void> {
  const vectors = await ai.embed(
    { organizationId: params.organizationId, purpose: params.purpose ?? 'embeddings.upsert' },
    params.chunks,
  );
  await withOrg(db, params.organizationId, async (tx) => {
    await tx
      .delete(aiEmbeddings)
      .where(
        and(
          eq(aiEmbeddings.entityType, params.entityType),
          eq(aiEmbeddings.entityId, params.entityId),
        ),
      );
    if (params.chunks.length === 0) return;
    await tx.insert(aiEmbeddings).values(
      params.chunks.map((content, i) => ({
        organizationId: params.organizationId,
        entityType: params.entityType,
        entityId: params.entityId,
        chunkIndex: i,
        content,
        embedding: vectors[i]!,
        provider: ai.embedder.name,
      })),
    );
  });
}

export interface SimilarityHit {
  entityType: string;
  entityId: string;
  content: string;
  score: number;
}

/**
 * App-side cosine ranking over the org's embeddings. O(n) per query — fine at
 * demo scale; the pgvector upgrade path replaces this with an indexed query.
 */
export async function searchSimilar(
  db: Db,
  ai: AiService,
  params: {
    organizationId: string;
    query: string;
    entityType?: string | undefined;
    limit?: number;
  },
): Promise<SimilarityHit[]> {
  const [queryVector] = await ai.embed(
    { organizationId: params.organizationId, purpose: 'embeddings.search' },
    [params.query],
  );
  // Newest 2000 chunks bound memory: only the needed columns, capped.
  // (The pgvector upgrade replaces this scan with an indexed ANN query.)
  const rows = await withOrg(db, params.organizationId, (tx) =>
    tx
      .select({
        entityType: aiEmbeddings.entityType,
        entityId: aiEmbeddings.entityId,
        content: aiEmbeddings.content,
        embedding: aiEmbeddings.embedding,
      })
      .from(aiEmbeddings)
      .where(params.entityType ? eq(aiEmbeddings.entityType, params.entityType) : undefined)
      .orderBy(desc(aiEmbeddings.createdAt))
      .limit(2000),
  );
  return rows
    .map((row) => ({
      entityType: row.entityType,
      entityId: row.entityId,
      content: row.content,
      score: cosineSimilarity(queryVector!, row.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, params.limit ?? 10);
}
