import { z } from 'zod';

// ---------- pagination ----------

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

const sortOrder = z.enum(['asc', 'desc']);

// ---------- accounts ----------

export const accountCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().max(255).optional(),
  website: z.url().max(500).optional(),
  industry: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(40).optional(),
  description: z.string().max(2000).optional(),
  ownerId: z.uuid().optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
});
export type AccountCreateInput = z.infer<typeof accountCreateSchema>;

export const accountUpdateSchema = accountCreateSchema
  .partial()
  .extend({
    // explicit nulls clear optional fields
    domain: z.string().trim().max(255).nullable().optional(),
    website: z.url().max(500).nullable().optional(),
    industry: z.string().trim().max(100).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    ownerId: z.uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;

export const accountQuerySchema = paginationSchema.extend({
  query: z.string().trim().max(200).optional(),
  industry: z.string().trim().max(100).optional(),
  ownerId: z.uuid().optional(),
  sort: z.enum(['name', 'createdAt', 'updatedAt']).default('name'),
  order: sortOrder.default('asc'),
});
export type AccountQuery = z.infer<typeof accountQuerySchema>;

export interface AccountDto {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  phone: string | null;
  description: string | null;
  ownerId: string | null;
  custom: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

// ---------- contacts ----------

export const contactCreateSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.email().toLowerCase().optional(),
  phone: z.string().trim().max(40).optional(),
  title: z.string().trim().max(100).optional(),
  accountId: z.uuid().optional(),
  ownerId: z.uuid().optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
});
export type ContactCreateInput = z.infer<typeof contactCreateSchema>;

export const contactUpdateSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    email: z.email().toLowerCase().nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    title: z.string().trim().max(100).nullable().optional(),
    accountId: z.uuid().nullable().optional(),
    ownerId: z.uuid().nullable().optional(),
    custom: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });
export type ContactUpdateInput = z.infer<typeof contactUpdateSchema>;

export const contactQuerySchema = paginationSchema.extend({
  query: z.string().trim().max(200).optional(),
  accountId: z.uuid().optional(),
  ownerId: z.uuid().optional(),
  sort: z.enum(['lastName', 'createdAt', 'updatedAt']).default('lastName'),
  order: sortOrder.default('asc'),
});
export type ContactQuery = z.infer<typeof contactQuerySchema>;

export interface ContactDto {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  accountId: string | null;
  ownerId: string | null;
  custom: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

// ---------- timeline ----------

export interface TimelineEntryDto {
  id: string;
  entryType: string;
  occurredAt: string;
  actorUserId: string | null;
  summary: string;
  detail: Record<string, unknown>;
}
