import { db, oauthSessions } from '@teledrug/db';
import { eq, lt } from 'drizzle-orm';

/**
 * OAuth session data stored in PostgreSQL
 */
export interface OAuthSessionData {
  user_id: number;
  code_verifier: string;
  state: string;
  timestamp: number;
}

/**
 * Store OAuth session in PostgreSQL with TTL
 * @param sessionId - Unique session identifier
 * @param data - Session data
 * @param ttlSeconds - Time to live in seconds (default 600 = 10 minutes)
 */
export async function storeOAuthSession(
  sessionId: string,
  data: OAuthSessionData,
  ttlSeconds: number = 600
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await db.insert(oauthSessions).values({
    sessionId,
    userId: data.user_id,
    provider: 'google',
    state: data.state,
    codeVerifier: data.code_verifier,
    metadata: {
      timestamp: data.timestamp,
    },
    expiresAt,
  });
}

/**
 * Get OAuth session from PostgreSQL
 * @param sessionId - Unique session identifier
 * @returns Session data or null if not found/expired
 */
export async function getOAuthSession(
  sessionId: string
): Promise<OAuthSessionData | null> {
  const [session] = await db
    .select()
    .from(oauthSessions)
    .where(eq(oauthSessions.sessionId, sessionId))
    .limit(1);

  if (!session) {
    return null;
  }

  // Check if session is expired
  if (session.expiresAt < new Date()) {
    // Delete expired session
    await db
      .delete(oauthSessions)
      .where(eq(oauthSessions.sessionId, sessionId));
    return null;
  }

  return {
    user_id: session.userId,
    code_verifier: session.codeVerifier,
    state: session.state,
    timestamp: (session.metadata as any)?.timestamp || Date.now(),
  };
}

/**
 * Delete OAuth session from PostgreSQL
 * @param sessionId - Unique session identifier
 */
export async function deleteOAuthSession(sessionId: string): Promise<void> {
  await db
    .delete(oauthSessions)
    .where(eq(oauthSessions.sessionId, sessionId));
}

/**
 * Clean up expired OAuth sessions (can be run periodically)
 * @returns Number of deleted sessions
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const result = await db
    .delete(oauthSessions)
    .where(lt(oauthSessions.expiresAt, new Date()))
    .returning();

  return result.length;
}
