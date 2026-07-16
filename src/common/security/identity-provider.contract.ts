import { z } from 'zod';

const userSchema = z.object({
  id: z.string().regex(/^[1-9]\d*$/),
  tenantId: z.string().regex(/^[1-9]\d*$/),
  email: z.string().email(),
  fullName: z.string().min(1),
  name: z.string().min(1),
  userCode: z.string().nullable(),
  status: z.string().min(1),
  department: z.string().nullable(),
  jobTitle: z.string().nullable(),
  mustChangePassword: z.boolean(),
  mfaEnabled: z.boolean(),
  roles: z.array(z.string()),
  legacyRoles: z.array(z.string()),
  permissions: z.array(z.string()),
});

export const identityProfileSchema = z.object({ user: userSchema });

export const identitySessionSchema = identityProfileSchema.extend({
  accessToken: z.string().min(20),
  refreshToken: z.string().min(20),
  tokenType: z.literal('Bearer'),
  expiresIn: z.string().min(1),
});

export type IdentityProfile = z.infer<typeof identityProfileSchema>;
export type IdentitySession = z.infer<typeof identitySessionSchema>;

export type PublicIdentitySession = Omit<IdentitySession, 'refreshToken'>;
