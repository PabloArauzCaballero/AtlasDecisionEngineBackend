import type { EnvRule } from './env-rule';

export const requireCredentialsForAuthMode: EnvRule = (value, ctx) => {
  const requiresApiKeys =
    value.AUTH_MODE === 'API_KEY' ||
    value.AUTH_MODE === 'HYBRID' ||
    value.AUTH_MODE === 'IDENTITY_HYBRID';
  const requiresJwt = value.AUTH_MODE === 'JWT' || value.AUTH_MODE === 'HYBRID';
  const requiresIdentityProvider =
    value.AUTH_MODE === 'IDENTITY_PROVIDER' || value.AUTH_MODE === 'IDENTITY_HYBRID';

  if (requiresApiKeys) {
    if (!value.MANAGEMENT_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['MANAGEMENT_API_KEY'],
        message: 'Required for API_KEY or HYBRID authentication',
      });
    }
    if (!value.RUNTIME_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['RUNTIME_API_KEY'],
        message: 'Required for API_KEY or HYBRID authentication',
      });
    }
    if (
      value.MANAGEMENT_API_KEY &&
      value.RUNTIME_API_KEY &&
      value.MANAGEMENT_API_KEY === value.RUNTIME_API_KEY
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['RUNTIME_API_KEY'],
        message: 'Management and runtime API keys must be different',
      });
    }
  }

  if (requiresJwt) {
    if (!value.JWT_JWKS_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_JWKS_URL'],
        message: 'Required for JWT or HYBRID authentication',
      });
    }
    if (!value.JWT_ISSUER) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_ISSUER'],
        message: 'Required for JWT or HYBRID authentication',
      });
    }
  }

  if (requiresIdentityProvider && !value.IDENTITY_PROVIDER_URL) {
    ctx.addIssue({
      code: 'custom',
      path: ['IDENTITY_PROVIDER_URL'],
      message: 'Required for identity provider authentication',
    });
  }
};
