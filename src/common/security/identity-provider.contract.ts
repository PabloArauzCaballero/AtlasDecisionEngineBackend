import { z } from 'zod';
import { DATABASE_ID_PATTERN, MAX_DATABASE_ID } from '../http/id';

const databaseIdSchema = z
  .string()
  .regex(DATABASE_ID_PATTERN)
  .refine((value) => BigInt(value) <= MAX_DATABASE_ID, 'Identifier exceeds PostgreSQL BIGINT');

const userSchema = z.object({
  id: databaseIdSchema,
  tenantId: databaseIdSchema,
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
 * An internal actor's password check succeeds but yields a mailed PIN challenge instead of a
 * session. It is a distinct outcome, not a failure, so it must not be read as a session — nor as
 * an error, which is how it used to surface: the challenge became a 501 and the account could not
 * sign in at all, so the deployments that had a second factor were the ones locked out of the
 * portal.
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
export type IdentityPinChallenge = z.infer<typeof identityPinChallengeSchema>;

export type PublicIdentitySession = Omit<IdentitySession, 'refreshToken'>;

/** What a password check can yield: a session, or the demand for a second factor. */
export type IdentityLoginOutcome = IdentitySession | IdentityPinChallenge;

export function isPinChallenge(outcome: IdentityLoginOutcome): outcome is IdentityPinChallenge {
  return 'pinChallengeRequired' in outcome;
}
