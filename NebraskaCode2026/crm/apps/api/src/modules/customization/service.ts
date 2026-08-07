import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import {
  evaluateFieldCondition,
  isEmptyFieldValue,
  RECORD_TYPE_FIELD,
  type CustomFieldCreateInput,
  type CustomFieldDto,
  type CustomFieldUpdateInput,
  type CustomizableEntityType,
  type CustomizationBundleDto,
  type CustomValueIssue,
  type EntityLayoutDto,
  type FieldRules,
  type LayoutSection,
  type LayoutUpsertInput,
  type RecordTypeCreateInput,
  type RecordTypeDto,
  type RecordTypeUpdateInput,
} from '@crm/shared';
import type { Db } from '../../db/client.js';
import { customFieldDefinitions, entityLayouts, recordTypes } from '../../db/schema/index.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { withOrg, type DbLike, type Tx } from '../../lib/tenant.js';
import type { AuthContext } from '../auth/service.js';

type FieldRow = typeof customFieldDefinitions.$inferSelect;
type RecordTypeRow = typeof recordTypes.$inferSelect;

function fieldToDto(row: FieldRow): CustomFieldDto {
  return {
    id: row.id,
    entityType: row.entityType as CustomizableEntityType,
    key: row.key,
    label: row.label,
    fieldType: row.fieldType,
    required: row.required,
    options: (row.options as string[] | null) ?? null,
    rules: (row.rules ?? {}) as FieldRules,
    displayOrder: row.displayOrder,
    isActive: row.isActive,
  };
}

function recordTypeToDto(row: RecordTypeRow): RecordTypeDto {
  return {
    id: row.id,
    entityType: row.entityType as CustomizableEntityType,
    key: row.key,
    name: row.name,
    description: row.description,
    isDefault: row.isDefault,
    displayOrder: row.displayOrder,
  };
}

function assertValidPattern(rules: FieldRules): void {
  if (rules.pattern === undefined) return;
  try {
    new RegExp(rules.pattern);
  } catch {
    throw new ValidationError(`invalid pattern: ${rules.pattern}`);
  }
}

// ---------- custom field definitions ----------

export async function listCustomFields(
  db: Db,
  ctx: AuthContext,
  entityType?: CustomizableEntityType,
  includeInactive = false,
): Promise<CustomFieldDto[]> {
  const rows = await withOrg(db, ctx.organizationId, (tx) =>
    tx
      .select()
      .from(customFieldDefinitions)
      .where(
        and(
          entityType ? eq(customFieldDefinitions.entityType, entityType) : undefined,
          includeInactive ? undefined : eq(customFieldDefinitions.isActive, true),
        ),
      )
      .orderBy(asc(customFieldDefinitions.displayOrder), asc(customFieldDefinitions.key)),
  );
  return rows.map(fieldToDto);
}

export async function createCustomField(
  db: Db,
  ctx: AuthContext,
  input: CustomFieldCreateInput,
): Promise<CustomFieldDto> {
  if (input.key === RECORD_TYPE_FIELD) throw new ValidationError('reserved field key');
  assertValidPattern(input.rules);
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx
      .select({ id: customFieldDefinitions.id })
      .from(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.entityType, input.entityType),
          eq(customFieldDefinitions.key, input.key),
        ),
      )
      .limit(1);
    if (existing) throw new ConflictError(`field "${input.key}" already exists for ${input.entityType}`);
    const [row] = await tx
      .insert(customFieldDefinitions)
      .values({
        organizationId: ctx.organizationId,
        entityType: input.entityType,
        key: input.key,
        label: input.label,
        fieldType: input.fieldType,
        required: input.required,
        options: input.options ?? null,
        rules: input.rules,
        displayOrder: input.displayOrder,
      })
      .returning();
    return fieldToDto(row!);
  });
}

export async function updateCustomField(
  db: Db,
  ctx: AuthContext,
  id: string,
  input: CustomFieldUpdateInput,
): Promise<CustomFieldDto> {
  if (input.rules) assertValidPattern(input.rules);
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(customFieldDefinitions)
      .where(eq(customFieldDefinitions.id, id))
      .limit(1);
    if (!existing) throw new NotFoundError('custom field not found');
    const [row] = await tx
      .update(customFieldDefinitions)
      .set({
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.required !== undefined ? { required: input.required } : {}),
        ...(input.options !== undefined ? { options: input.options } : {}),
        ...(input.rules !== undefined ? { rules: input.rules } : {}),
        ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      })
      .where(eq(customFieldDefinitions.id, id))
      .returning();
    return fieldToDto(row!);
  });
}

export async function deleteCustomField(db: Db, ctx: AuthContext, id: string): Promise<void> {
  await withOrg(db, ctx.organizationId, async (tx) => {
    const [row] = await tx
      .delete(customFieldDefinitions)
      .where(eq(customFieldDefinitions.id, id))
      .returning({ id: customFieldDefinitions.id });
    if (!row) throw new NotFoundError('custom field not found');
  });
}

// ---------- record types ----------

export async function listRecordTypes(
  db: Db,
  ctx: AuthContext,
  entityType?: CustomizableEntityType,
): Promise<RecordTypeDto[]> {
  const rows = await withOrg(db, ctx.organizationId, (tx) =>
    tx
      .select()
      .from(recordTypes)
      .where(entityType ? eq(recordTypes.entityType, entityType) : undefined)
      .orderBy(asc(recordTypes.entityType), asc(recordTypes.displayOrder), asc(recordTypes.name)),
  );
  return rows.map(recordTypeToDto);
}

export async function createRecordType(
  db: Db,
  ctx: AuthContext,
  input: RecordTypeCreateInput,
): Promise<RecordTypeDto> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx
      .select({ id: recordTypes.id })
      .from(recordTypes)
      .where(and(eq(recordTypes.entityType, input.entityType), eq(recordTypes.key, input.key)))
      .limit(1);
    if (existing) throw new ConflictError(`record type "${input.key}" already exists for ${input.entityType}`);
    const [row] = await tx
      .insert(recordTypes)
      .values({
        organizationId: ctx.organizationId,
        entityType: input.entityType,
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        isDefault: input.isDefault,
        displayOrder: input.displayOrder,
      })
      .returning();
    if (input.isDefault) {
      await tx
        .update(recordTypes)
        .set({ isDefault: false })
        .where(and(eq(recordTypes.entityType, input.entityType), ne(recordTypes.id, row!.id)));
    }
    return recordTypeToDto(row!);
  });
}

export async function updateRecordType(
  db: Db,
  ctx: AuthContext,
  id: string,
  input: RecordTypeUpdateInput,
): Promise<RecordTypeDto> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const [existing] = await tx.select().from(recordTypes).where(eq(recordTypes.id, id)).limit(1);
    if (!existing) throw new NotFoundError('record type not found');
    const [row] = await tx
      .update(recordTypes)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
      })
      .where(eq(recordTypes.id, id))
      .returning();
    if (input.isDefault === true) {
      await tx
        .update(recordTypes)
        .set({ isDefault: false })
        .where(and(eq(recordTypes.entityType, existing.entityType), ne(recordTypes.id, id)));
    }
    return recordTypeToDto(row!);
  });
}

export async function deleteRecordType(db: Db, ctx: AuthContext, id: string): Promise<void> {
  await withOrg(db, ctx.organizationId, async (tx) => {
    const [row] = await tx
      .delete(recordTypes)
      .where(eq(recordTypes.id, id))
      .returning({ id: recordTypes.id });
    if (!row) throw new NotFoundError('record type not found');
  });
}

// ---------- layouts ----------

function layoutToDto(row: typeof entityLayouts.$inferSelect): EntityLayoutDto {
  return {
    id: row.id,
    entityType: row.entityType as CustomizableEntityType,
    recordTypeId: row.recordTypeId,
    sections: (row.sections ?? []) as LayoutSection[],
  };
}

export async function listLayouts(
  db: Db,
  ctx: AuthContext,
  entityType?: CustomizableEntityType,
): Promise<EntityLayoutDto[]> {
  const rows = await withOrg(db, ctx.organizationId, (tx) =>
    tx
      .select()
      .from(entityLayouts)
      .where(entityType ? eq(entityLayouts.entityType, entityType) : undefined),
  );
  return rows.map(layoutToDto);
}

export async function upsertLayout(
  db: Db,
  ctx: AuthContext,
  input: LayoutUpsertInput,
): Promise<EntityLayoutDto> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    if (input.recordTypeId !== null) {
      const [rt] = await tx
        .select({ id: recordTypes.id, entityType: recordTypes.entityType })
        .from(recordTypes)
        .where(eq(recordTypes.id, input.recordTypeId))
        .limit(1);
      if (!rt || rt.entityType !== input.entityType) {
        throw new ValidationError('record type does not exist for this entity type');
      }
    }
    const [existing] = await tx
      .select({ id: entityLayouts.id })
      .from(entityLayouts)
      .where(
        and(
          eq(entityLayouts.entityType, input.entityType),
          input.recordTypeId === null
            ? isNull(entityLayouts.recordTypeId)
            : eq(entityLayouts.recordTypeId, input.recordTypeId),
        ),
      )
      .limit(1);
    if (existing) {
      const [row] = await tx
        .update(entityLayouts)
        .set({ sections: input.sections })
        .where(eq(entityLayouts.id, existing.id))
        .returning();
      return layoutToDto(row!);
    }
    const [row] = await tx
      .insert(entityLayouts)
      .values({
        organizationId: ctx.organizationId,
        entityType: input.entityType,
        recordTypeId: input.recordTypeId,
        sections: input.sections,
      })
      .returning();
    return layoutToDto(row!);
  });
}

export async function deleteLayout(db: Db, ctx: AuthContext, id: string): Promise<void> {
  await withOrg(db, ctx.organizationId, async (tx) => {
    const [row] = await tx
      .delete(entityLayouts)
      .where(eq(entityLayouts.id, id))
      .returning({ id: entityLayouts.id });
    if (!row) throw new NotFoundError('layout not found');
  });
}

// ---------- record-page bundle ----------

function fieldAppliesToRecordType(field: CustomFieldDto, recordTypeKey: string | null): boolean {
  const restriction = field.rules.recordTypes;
  if (!restriction || restriction.length === 0) return true;
  return recordTypeKey !== null && restriction.includes(recordTypeKey);
}

export async function getBundle(
  db: Db,
  ctx: AuthContext,
  entityType: CustomizableEntityType,
  recordTypeKey?: string,
): Promise<CustomizationBundleDto> {
  return withOrg(db, ctx.organizationId, async (tx) => {
    const fieldRows = await tx
      .select()
      .from(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.entityType, entityType),
          eq(customFieldDefinitions.isActive, true),
        ),
      )
      .orderBy(asc(customFieldDefinitions.displayOrder), asc(customFieldDefinitions.key));
    const rtRows = await tx
      .select()
      .from(recordTypes)
      .where(eq(recordTypes.entityType, entityType))
      .orderBy(asc(recordTypes.displayOrder), asc(recordTypes.name));

    const requested = recordTypeKey ? rtRows.find((r) => r.key === recordTypeKey) : undefined;
    const layoutRows = await tx
      .select()
      .from(entityLayouts)
      .where(eq(entityLayouts.entityType, entityType));
    const layout =
      (requested ? layoutRows.find((l) => l.recordTypeId === requested.id) : undefined) ??
      layoutRows.find((l) => l.recordTypeId === null);

    const fields = fieldRows
      .map(fieldToDto)
      .filter((f) => fieldAppliesToRecordType(f, recordTypeKey ?? null));
    return {
      entityType,
      fields,
      recordTypes: rtRows.map(recordTypeToDto),
      layout: layout ? layoutToDto(layout) : null,
    };
  });
}

// ---------- value validation (runs on every entity create/update) ----------

const URL_PATTERN = /^https?:\/\/\S+$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function typeIssue(field: CustomFieldDto, value: unknown): string | null {
  const rules = field.rules;
  switch (field.fieldType) {
    case 'text': {
      if (typeof value !== 'string') return 'must be text';
      if (rules.minLength !== undefined && value.length < rules.minLength)
        return `must be at least ${rules.minLength} characters`;
      if (rules.maxLength !== undefined && value.length > rules.maxLength)
        return `must be at most ${rules.maxLength} characters`;
      if (rules.pattern !== undefined && !new RegExp(rules.pattern).test(value))
        return 'does not match the required format';
      return null;
    }
    case 'number': {
      if (typeof value !== 'number' || Number.isNaN(value)) return 'must be a number';
      if (rules.min !== undefined && value < rules.min) return `must be ≥ ${rules.min}`;
      if (rules.max !== undefined && value > rules.max) return `must be ≤ ${rules.max}`;
      return null;
    }
    case 'date':
      return typeof value === 'string' && DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value))
        ? null
        : 'must be a date (YYYY-MM-DD)';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be true or false';
    case 'select':
      return typeof value === 'string' && (field.options ?? []).includes(value)
        ? null
        : `must be one of: ${(field.options ?? []).join(', ')}`;
    case 'multiselect': {
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
        return 'must be a list of options';
      const allowed = new Set(field.options ?? []);
      const bad = (value as string[]).filter((v) => !allowed.has(v));
      return bad.length === 0 ? null : `invalid options: ${bad.join(', ')}`;
    }
    case 'url':
      return typeof value === 'string' && URL_PATTERN.test(value)
        ? null
        : 'must be a URL (http:// or https://)';
    case 'email':
      return typeof value === 'string' && EMAIL_PATTERN.test(value)
        ? null
        : 'must be an email address';
  }
}

/**
 * Validate a record's full custom-value object against the org's definitions.
 * `values` is complete state, not a delta — the API replaces `custom` wholesale.
 */
export function validateCustomValues(
  fields: CustomFieldDto[],
  orgRecordTypes: RecordTypeDto[],
  values: Record<string, unknown>,
): CustomValueIssue[] {
  const issues: CustomValueIssue[] = [];

  const recordTypeKey = values[RECORD_TYPE_FIELD];
  if (!isEmptyFieldValue(recordTypeKey)) {
    if (typeof recordTypeKey !== 'string' || !orgRecordTypes.some((r) => r.key === recordTypeKey)) {
      issues.push({ field: RECORD_TYPE_FIELD, message: 'unknown record type' });
    }
  }
  const activeKey = typeof recordTypeKey === 'string' ? recordTypeKey : null;

  const known = new Map(fields.map((f) => [f.key, f]));
  for (const key of Object.keys(values)) {
    if (key === RECORD_TYPE_FIELD) continue;
    if (!known.has(key)) issues.push({ field: key, message: 'unknown field' });
  }

  for (const field of fields) {
    if (!fieldAppliesToRecordType(field, activeKey)) continue;
    const visible = field.rules.visibleWhen
      ? evaluateFieldCondition(field.rules.visibleWhen, values)
      : true;
    const value = values[field.key];

    if (!isEmptyFieldValue(value)) {
      const issue = typeIssue(field, value);
      if (issue) issues.push({ field: field.key, message: issue });
      continue;
    }

    // empty: required checks apply only to visible fields
    if (!visible) continue;
    const conditionallyRequired = field.rules.requiredWhen
      ? evaluateFieldCondition(field.rules.requiredWhen, values)
      : false;
    if (field.required || conditionallyRequired) {
      issues.push({ field: field.key, message: `${field.label} is required` });
    }
  }
  return issues;
}

/**
 * Enforcement hook for entity services. Runs inside the caller's transaction;
 * throws ValidationError listing every failing field. `custom === undefined`
 * on update means "unchanged" and skips validation.
 */
export async function assertValidCustom(
  tx: Tx | DbLike,
  entityType: CustomizableEntityType,
  custom: Record<string, unknown> | undefined,
  options: { isCreate: boolean },
): Promise<void> {
  if (custom === undefined && !options.isCreate) return;
  const values = custom ?? {};

  const fieldRows = await tx
    .select()
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.entityType, entityType),
        eq(customFieldDefinitions.isActive, true),
      ),
    );
  if (fieldRows.length === 0 && Object.keys(values).length === 0) return;
  const rtRows = await tx
    .select()
    .from(recordTypes)
    .where(eq(recordTypes.entityType, entityType));

  const issues = validateCustomValues(fieldRows.map(fieldToDto), rtRows.map(recordTypeToDto), values);
  if (issues.length > 0) {
    throw new ValidationError(
      `custom field validation failed: ${issues.map((i) => `${i.field} — ${i.message}`).join('; ')}`,
    );
  }
}
