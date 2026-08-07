import { asc, eq } from 'drizzle-orm';
import type { PipelineDto, PipelineStageDto } from '@crm/shared';
import type { Db } from '../../db/client.js';
import { pipelines, pipelineStages } from '../../db/schema/index.js';
import { NotFoundError } from '../../lib/errors.js';
import { withOrg, type Tx } from '../../lib/tenant.js';

// Seeded for every new organization at registration.
export const DEFAULT_PIPELINE_NAME = 'Sales Pipeline';
export const DEFAULT_STAGES: ReadonlyArray<{
  name: string;
  probability: number;
  isWon?: boolean;
  isLost?: boolean;
}> = [
  { name: 'Qualification', probability: 10 },
  { name: 'Discovery', probability: 25 },
  { name: 'Proposal', probability: 50 },
  { name: 'Negotiation', probability: 75 },
  { name: 'Closed Won', probability: 100, isWon: true },
  { name: 'Closed Lost', probability: 0, isLost: true },
];

/** Runs inside the registration transaction (tenant context already set). */
export async function seedDefaultPipeline(tx: Tx, organizationId: string): Promise<void> {
  const [pipeline] = await tx
    .insert(pipelines)
    .values({ organizationId, name: DEFAULT_PIPELINE_NAME, isDefault: true })
    .returning({ id: pipelines.id });
  await tx.insert(pipelineStages).values(
    DEFAULT_STAGES.map((stage, i) => ({
      organizationId,
      pipelineId: pipeline!.id,
      name: stage.name,
      displayOrder: i,
      probability: stage.probability,
      isWon: stage.isWon ?? false,
      isLost: stage.isLost ?? false,
    })),
  );
}

function toStageDto(row: typeof pipelineStages.$inferSelect): PipelineStageDto {
  return {
    id: row.id,
    name: row.name,
    displayOrder: row.displayOrder,
    probability: row.probability,
    isWon: row.isWon,
    isLost: row.isLost,
  };
}

export async function listPipelines(db: Db, organizationId: string): Promise<PipelineDto[]> {
  return withOrg(db, organizationId, async (tx) => {
    const pipelineRows = await tx
      .select()
      .from(pipelines)
      .orderBy(asc(pipelines.displayOrder), asc(pipelines.name));
    const stageRows = await tx
      .select()
      .from(pipelineStages)
      .orderBy(asc(pipelineStages.displayOrder));
    return pipelineRows.map((p) => ({
      id: p.id,
      name: p.name,
      isDefault: p.isDefault,
      stages: stageRows.filter((s) => s.pipelineId === p.id).map(toStageDto),
    }));
  });
}

export async function getPipelineWithStages(
  tx: Tx,
  pipelineId: string,
): Promise<{ pipeline: typeof pipelines.$inferSelect; stages: (typeof pipelineStages.$inferSelect)[] }> {
  const [pipeline] = await tx
    .select()
    .from(pipelines)
    .where(eq(pipelines.id, pipelineId))
    .limit(1);
  if (!pipeline) throw new NotFoundError('pipeline not found');
  const stages = await tx
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.pipelineId, pipelineId))
    .orderBy(asc(pipelineStages.displayOrder));
  return { pipeline, stages };
}

export async function getDefaultPipeline(tx: Tx): Promise<typeof pipelines.$inferSelect> {
  const [pipeline] = await tx
    .select()
    .from(pipelines)
    .where(eq(pipelines.isDefault, true))
    .orderBy(asc(pipelines.displayOrder))
    .limit(1);
  if (!pipeline) throw new NotFoundError('no default pipeline configured');
  return pipeline;
}
