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

/**
 * The identity provider's login/refresh body. It deliberately carries no tokens: those are
 * issued as HttpOnly cookies so an XSS in a browser client cannot read them, and the body
 * only describes the session. `tokenType` is accepted as a free-form string rather than a
 * literal so that a provider-side change to that marker degrades into a token-extraction
 * error with a real message, instead of a blanket "invalid credentials".
 */
export const identityProviderSessionSchema = identityProfileSchema.extend({
  tokenType: z.string().min(1),
  expiresIn: z.string().min(1),
  accessToken: z.string().min(20).optional(),
  refreshToken: z.string().min(20).optional(),
});

/**
 * A super admin's password check succeeds but yields a mailed PIN challenge instead of a
 * session. It is a distinct outcome, not a failure, so it must not be read as a session.
 */
export const identityPinChallengeSchema = z.object({
  pinChallengeRequired: z.literal(true),
  challengeToken: z.string().min(1),
  expiresInMinutes: z.number(),
});

/** The session ATLAS works with once the provider's cookie tokens have been recovered. */
export const identitySessionSchema = identityProfileSchema.extend({
  accessToken: z.string().min(20),
  refreshToken: z.string().min(20),
  tokenType: z.literal('Bearer'),
  expiresIn: z.string().min(1),
});

export type IdentityProfile = z.infer<typeof identityProfileSchema>;
export type IdentitySession = z.infer<typeof identitySessionSchema>;

export type PublicIdentitySession = Omit<IdentitySession, 'refreshToken'>;
