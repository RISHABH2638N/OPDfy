export const POLICY_VERSION = '2026-09-09';
// Record acceptance on new self-service clinic registrations only. Existing
// tenants and existing login sessions do not need to re-register.
export function validatePolicyAcceptance(input) {
  if (!input || input.accepted !== true || input.version !== POLICY_VERSION || !['en','hi'].includes(input.language)) {
    return { error: 'Please accept the current terms and acknowledge the privacy notice before registering.' };
  }
  return { value: { termsVersion: POLICY_VERSION, privacyVersion: POLICY_VERSION, language: input.language, acceptedAt: new Date() } };
}
