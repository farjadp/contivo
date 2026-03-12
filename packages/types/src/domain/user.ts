import { z } from 'zod';

// ─── Enums ────────────────────────────────────────────────────────────────────

export const UserPlan = z.enum(['FREE', 'STARTER', 'PRO', 'AGENCY']);
export type UserPlan = z.infer<typeof UserPlan>;

export const UserRole = z.enum(['USER', 'ADMIN']);
export type UserRole = z.infer<typeof UserRole>;

// ─── Domain type ──────────────────────────────────────────────────────────────

export const UserSchema = z.object({
  id: z.string().cuid(),
  clerkId: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
  plan: UserPlan,
  role: UserRole,
  creditBalance: z.number().int().min(0),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type User = z.infer<typeof UserSchema>;

// ─── Response DTOs ────────────────────────────────────────────────────────────

export const UserProfileResponse = UserSchema.pick({
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  plan: true,
  creditBalance: true,
  createdAt: true,
});

export type UserProfileResponse = z.infer<typeof UserProfileResponse>;
