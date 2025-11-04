import { google } from 'googleapis';
import {
  getOAuthSession,
  deleteOAuthSession,
} from '../utils/sessions.js';
import { notifyTelegramBot } from '../utils/telegram.js';
import { saveGoogleCalendarTokens } from '../utils/database.js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!;

function createOAuth2Client() {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

/**
 * Step 2: Handle Google callback
 * GET /oauth/google/callback?code=XXX&state=YYY
 */
export async function handleOAuthCallback(url: URL, headers: Record<string, string>): Promise<Response> {
  try {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    // Handle OAuth errors
    if (error) {
      console.error('OAuth error from Google:', error);
      return Response.redirect(
        `/oauth/google/error?error=${encodeURIComponent(error)}`,
        302
      );
    }

    // Validate parameters
    if (!code) {
      return new Response('Missing or invalid code parameter', {
        status: 400,
        headers,
      });
    }

    if (!state) {
      return new Response('Missing or invalid state parameter', {
        status: 400,
        headers,
      });
    }

    // Parse state parameter (format: "state_token|session_id")
    const [stateToken, sessionId] = state.split('|');

    if (!stateToken || !sessionId) {
      return new Response('Invalid state parameter format', {
        status: 400,
        headers,
      });
    }

    // Retrieve session from PostgreSQL
    const sessionData = await getOAuthSession(sessionId);

    if (!sessionData) {
      console.error(`Session not found or expired: ${sessionId}`);
      return new Response('Invalid or expired session', {
        status: 400,
        headers,
      });
    }

    // Validate state token
    if (stateToken !== sessionData.state) {
      console.error(
        `State mismatch: expected ${sessionData.state}, got ${stateToken}`
      );
      return new Response('Invalid state parameter (CSRF protection)', {
        status: 400,
        headers,
      });
    }

    console.log(
      `🔐 Exchanging code for tokens, user ${sessionData.user_id}, session ${sessionId}`
    );

    // Exchange authorization code for tokens
    const oauth2Client = createOAuth2Client();

    const { tokens } = await oauth2Client.getToken({
      code,
      codeVerifier: sessionData.code_verifier,
    });

    console.log(
      `✅ Tokens received for user ${sessionData.user_id}:`,
      {
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        expiryDate: tokens.expiry_date,
      }
    );

    // Prepare credentials for storage
    const credentials = {
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token,
      expiryDate: tokens.expiry_date || Date.now() + 3600 * 1000,
      scope: tokens.scope || '',
      tokenType: tokens.token_type || 'Bearer',
    };

    // Save tokens to database (encrypted)
    await saveGoogleCalendarTokens(sessionData.user_id, credentials);

    console.log(
      `💾 Tokens saved to database for user ${sessionData.user_id}`
    );

    // Clean up session
    await deleteOAuthSession(sessionId);

    console.log(`🧹 Session cleaned up: ${sessionId}`);

    // Notify Telegram bot
    await notifyTelegramBot(sessionData.user_id, 'google_calendar_connected');

    console.log(
      `📱 Telegram notification sent to user ${sessionData.user_id}`
    );

    // Redirect to success page
    return Response.redirect(`/oauth/google/success?session_id=${sessionId}`, 302);
  } catch (error) {
    console.error('Error in OAuth callback:', error);

    // Try to notify user about error
    const state = url.searchParams.get('state');
    if (state) {
      const [, sessionId] = state.split('|');
      if (sessionId) {
        const sessionData = await getOAuthSession(sessionId);
        if (sessionData) {
          await notifyTelegramBot(
            sessionData.user_id,
            'google_calendar_error',
            error instanceof Error ? error.message : 'Unknown error'
          );
          await deleteOAuthSession(sessionId);
        }
      }
    }

    return Response.redirect(
      `/oauth/google/error?error=${encodeURIComponent('Internal server error')}`,
      302
    );
  }
}
