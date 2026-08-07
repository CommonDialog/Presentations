import { z } from 'zod';
import { customFieldEntityTypes, customFieldTypes, type CustomFieldType } from './domain.js';

// Customer customization: admins define fields, rules, record types, and
// layouts through the settings UI — no code. Records store values in their
// `custom` jsonb column; the record type key lives there too, under
// RECORD_TYPE_FIELD, so adopting record types needs no entity migration.

export const RECORD_TYPE_FIELD = '_recordType';

// Field/entity type lists live in domain.ts; re-used here for the schemas.
export const customizableEntityTypes = customFieldEntityTypes;
export type CustomizableEntityType = (typeof customFieldEntityTypes)[number];

/** Condition over a record's custom values (keys, or RECORD_TYPE_FIELD). */
export const fieldConditionSchema = z.object({
  field: z.string().min(1).max(100),
  op: z.enum(['eq', 'neq', 'in', 'set', 'notset']),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
});
export type FieldCondition = z.infer<typeof fieldConditionSchema>;

export function isEmptyFieldValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** Shared by server validation and the web renderer (progressive disclosure). */
export function evaluateFieldCondition(
  condition: FieldCondition,
  values: Record<string, unknown>,
): boolean {
  const actual = values[condition.field];
  switch (condition.op) {
    case 'set':
      return !isEmptyFieldValue(actual);
    case 'notset':
      return isEmptyFieldValue(actual);
    case 'eq':
      return String(actual) === String(condition.value);
    case 'neq':
      return String(actual) !== String(condition.value);
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(String(actual));
    default:
      return false;
  }
}

export const fieldRulesSchema = z.object({
  /** number fields */
  min: z.number().optional(),
  max: z.number().optional(),
  /** text fields */
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().min(1).optional(),
  pattern: z.string().max(300).optional(),
  /** conditionally required (in addition to the static `required` flag) */
  requiredWhen: fieldConditionSchema.optional(),
  /** progressive disclosure: field renders only when the condition holds */
  visibleWhen: fieldConditionSchema.optional(),
  /** restrict to these record type keys; omitted/empty = all record types */
  recordTypes: z.array(z.string()).optional(),
});
export type FieldRules = z.infer<typeof fieldRulesSchema>;

const keyPattern = /^[a-z][a-z0-9_]{0,49}$/;

export const customFieldCreateSchema = z
  .object({
    entityType: z.enum(customizableEntityTypes),
    key: z.string().regex(keyPattern, 'lowercase letters, digits and _ only; must start with a letter'),
    label: z.string().trim().min(1).max(100),
    fieldType: z.enum(customFieldTypes),
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    rules: fieldRulesSchema.default({}),
    displayOrder: z.number().int().min(0).default(0),
  })
  .refine(
    (v) => !['select', 'multiselect'].includes(v.fieldType) || (v.options?.length ?? 0) > 0,
    { message: 'select fields need at least one option' },
  );
export type CustomFieldCreateInput = z.infer<typeof customFieldCreateSchema>;

export const customFieldUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(100).optional(),
    required: z.boolean().optional(),
    options: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    rules: fieldRulesSchema.optional(),
    displayOrder: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });
export type CustomFieldUpdateInput = z.infer<typeof customFieldUpdateSchema>;

export interface CustomFieldDto {
  id: string;
  entityType: CustomizableEntityType;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  required: boolean;
  options: string[] | null;
  rules: FieldRules;
  displayOrder: number;
  isActive: boolean;
}

export const recordTypeCreateSchema = z.object({
  entityType: z.enum(customizableEntityTypes),
  key: z.string().regex(keyPattern),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  isDefault: z.boolean().default(false),
  displayOrder: z.number().int().min(0).default(0),
});
export type RecordTypeCreateInput = z.infer<typeof recordTypeCreateSchema>;

export const recordTypeUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    isDefault: z.boolean().optional(),
    displayOrder: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });
export type RecordTypeUpdateInput = z.infer<typeof recordTypeUpdateSchema>;

export interface RecordTypeDto {
  id: string;
  entityType: CustomizableEntityType;
  key: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  displayOrder: number;
}

export const layoutSectionSchema = z.object({
  key: z.string().regex(keyPattern),
  title: z.string().trim().min(1).max(100),
  /** progressive disclosure: section starts collapsed behind a "show more" */
  collapsed: z.boolean().default(false),
  /** progressive disclosure: section renders only when the condition holds */
  visibleWhen: fieldConditionSchema.optional(),
  /** ordered custom field keys */
  fields: z.array(z.string()).max(30),
});
export type LayoutSection = z.infer<typeof layoutSectionSchema>;

export const layoutUpsertSchema = z.object({
  entityType: z.enum(customizableEntityTypes),
  /** null = the entity-wide default layout */
  recordTypeId: z.uuid().nullable(),
  sections: z.array(layoutSectionSchema).max(10),
});
export type LayoutUpsertInput = z.infer<typeof layoutUpsertSchema>;

export interface EntityLayoutDto {
  id: string;
  entityType: CustomizableEntityType;
  recordTypeId: string | null;
  sections: LayoutSection[];
}

/** Everything a record page needs to render its custom section. */
export interface CustomizationBundleDto {
  entityType: CustomizableEntityType;
  fields: CustomFieldDto[];
  recordTypes: RecordTypeDto[];
  /** Resolved for the requested record type, falling back to the default layout. */
  layout: EntityLayoutDto | null;
}

export interface CustomValueIssue {
  field: string;
  message: string;
}
