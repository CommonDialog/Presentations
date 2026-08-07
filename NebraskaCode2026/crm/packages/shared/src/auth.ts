import { z } from 'zod';

export const registerSchema = z.object({
  organizationName: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(100),
  email: z.email().toLowerCase(),
  password: z.string().min(10).max(200),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.email().toLowerCase(),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

export interface AuthOrganization {
  id: string;
  name: string;
  slug: string;
}

export interface MeResponse {
  user: AuthUser;
  organization: AuthOrganization;
  permissions: string[];
}
