import type { ZodError } from 'zod';

export class ValidationError extends Error {}
export class NotFoundError extends Error {}
export class ConflictError extends Error {}

/** Zod failure at the HTTP boundary; carries issues for the 400 response body. */
export class RequestValidationError extends Error {
  constructor(public readonly issues: ZodError['issues']) {
    super('validation failed');
  }
}

/** Parse-or-throw helper for request bodies/params/queries. */
export function parse<T>(schema: { safeParse: (d: unknown) => { success: true; data: T } | { success: false; error: ZodError } }, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new RequestValidationError(result.error.issues);
  return result.data;
}
