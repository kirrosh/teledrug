import crypto from 'crypto';

/**
 * Generate a cryptographically secure code verifier for PKCE
 * @returns Base64URL encoded random string (43-128 characters)
 */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Generate code challenge from verifier using SHA-256
 * @param verifier - The code verifier
 * @returns Base64URL encoded SHA-256 hash of the verifier
 */
export function generateCodeChallenge(verifier: string): string {
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
}

/**
 * Generate a cryptographically secure state parameter
 * @returns Hex encoded random string (64 characters)
 */
export function generateState(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a unique session ID
 * @returns Hex encoded random string (32 characters)
 */
export function generateSessionId(): string {
  return crypto.randomBytes(16).toString('hex');
}
