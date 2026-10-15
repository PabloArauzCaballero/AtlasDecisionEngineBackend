import type { EnvRule } from './env-rule';

export const requireWellFormedRetiredAuditSecrets: EnvRule = (value, ctx) => {
  if (value.AUDIT_HASH_PREVIOUS_SECRETS) {
    try {
      const retired = JSON.parse(value.AUDIT_HASH_PREVIOUS_SECRETS) as unknown;
      const valid =
        retired !== null &&
        typeof retired === 'object' &&
        !Array.isArray(retired) &&
        Object.entries(retired).every(
          ([keyId, secret]) =>
            /^[A-Za-z0-9_.-]{1,40}$/.test(keyId) &&
            typeof secret === 'string' &&
            secret.length >= 32,
        );
      if (!valid) throw new Error('invalid retired key map');
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['AUDIT_HASH_PREVIOUS_SECRETS'],
        message: 'Must be a JSON object of {keyId: secret}, with secrets at least 32 characters',
      });
    }
  }
};
