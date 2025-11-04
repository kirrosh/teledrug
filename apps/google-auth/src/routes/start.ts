import { google } from 'googleapis';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from '../utils/pkce.js';
import {
  storeOAuthSession,
  type OAuthSessionData,
} from '../utils/sessions.js';

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
 * Step 1: Initiate OAuth flow
 * GET /oauth/google/start?session_id=XXX&user_id=YYY
 */
export async function handleOAuthStart(url: URL, headers: Record<string, string>): Promise<Response> {
  try {
    const session_id = url.searchParams.get('session_id');
    const user_id = url.searchParams.get('user_id');

    // Validate query parameters
    if (!session_id) {
      return new Response('Missing or invalid session_id parameter', {
        status: 400,
        headers,
      });
    }

    if (!user_id) {
      return new Response('Missing or invalid user_id parameter', {
        status: 400,
        headers,
      });
    }

    const userId = parseInt(user_id, 10);
    if (isNaN(userId)) {
      return new Response('Invalid user_id format', {
        status: 400,
        headers,
      });
    }

    // Generate PKCE parameters
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    // Store session in PostgreSQL (TTL 10 minutes)
    const sessionData: OAuthSessionData = {
      user_id: userId,
      code_verifier: codeVerifier,
      state,
      timestamp: Date.now(),
    };

    await storeOAuthSession(session_id, sessionData, 600);

    console.log(
      `🔐 OAuth flow initiated for user ${userId}, session ${session_id}`
    );

    // Generate Google OAuth URL
    const oauth2Client = createOAuth2Client();

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline', // Get refresh token
      scope: [
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.readonly',
      ],
      state: `${state}|${session_id}`,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'consent', // Force consent screen to get refresh token
    });

    // Redirect to Google OAuth
    return Response.redirect(authUrl, 302);
  } catch (error) {
    console.error('Error in OAuth start:', error);
    return new Response('Internal server error during OAuth initialization', {
      status: 500,
      headers,
    });
  }
}
