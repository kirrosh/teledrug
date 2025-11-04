import express, { Request, Response } from 'express';
import { google } from 'googleapis';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from '../utils/pkce.js';
import {
  storeOAuthSession,
  getOAuthSession,
  deleteOAuthSession,
  type OAuthSessionData,
} from '../utils/sessions.js';
import { notifyTelegramBot } from '../utils/telegram.js';
import { saveGoogleCalendarTokens } from '../utils/database.js';

const router = express.Router();

// Validate required environment variables
const requiredEnvVars = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'API_URL',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!;

/**
 * Create OAuth2 client
 */
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
router.get('/start', async (req: Request, res: Response) => {
  try {
    const { session_id, user_id } = req.query;

    // Validate query parameters
    if (!session_id || typeof session_id !== 'string') {
      return res.status(400).send('Missing or invalid session_id parameter');
    }

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).send('Missing or invalid user_id parameter');
    }

    const userId = parseInt(user_id, 10);
    if (isNaN(userId)) {
      return res.status(400).send('Invalid user_id format');
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
    res.redirect(authUrl);
  } catch (error) {
    console.error('Error in OAuth start:', error);
    res.status(500).send('Internal server error during OAuth initialization');
  }
});

/**
 * Step 2: Handle Google callback
 * GET /oauth/google/callback?code=XXX&state=YYY
 */
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, state, error } = req.query;

    // Handle OAuth errors
    if (error) {
      console.error('OAuth error from Google:', error);
      return res.redirect(
        `/oauth/google/error?error=${encodeURIComponent(String(error))}`
      );
    }

    // Validate parameters
    if (!code || typeof code !== 'string') {
      return res.status(400).send('Missing or invalid code parameter');
    }

    if (!state || typeof state !== 'string') {
      return res.status(400).send('Missing or invalid state parameter');
    }

    // Parse state parameter (format: "state_token|session_id")
    const [stateToken, sessionId] = state.split('|');

    if (!stateToken || !sessionId) {
      return res.status(400).send('Invalid state parameter format');
    }

    // Retrieve session from PostgreSQL
    const sessionData = await getOAuthSession(sessionId);

    if (!sessionData) {
      console.error(`Session not found or expired: ${sessionId}`);
      return res.status(400).send('Invalid or expired session');
    }

    // Validate state token
    if (stateToken !== sessionData.state) {
      console.error(
        `State mismatch: expected ${sessionData.state}, got ${stateToken}`
      );
      return res.status(400).send('Invalid state parameter (CSRF protection)');
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
    res.redirect(`/oauth/google/success?session_id=${sessionId}`);
  } catch (error) {
    console.error('Error in OAuth callback:', error);

    // Try to notify user about error
    const { state } = req.query;
    if (state && typeof state === 'string') {
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

    res.redirect(
      `/oauth/google/error?error=${encodeURIComponent('Internal server error')}`
    );
  }
});

/**
 * Step 3: Success page
 * GET /oauth/google/success?session_id=XXX
 */
router.get('/success', (req: Request, res: Response) => {
  const { session_id } = req.query;

  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Авторизация завершена</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
                       'Helvetica Neue', Arial, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          padding: 20px;
        }

        .container {
          background: white;
          padding: 48px 40px;
          border-radius: 24px;
          text-align: center;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          max-width: 480px;
          width: 100%;
          animation: slideUp 0.4s ease-out;
        }

        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .success-icon {
          font-size: 72px;
          margin-bottom: 24px;
          animation: bounce 0.6s ease-out;
          display: inline-block;
        }

        @keyframes bounce {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-20px);
          }
        }

        h1 {
          color: #1a202c;
          font-size: 28px;
          font-weight: 600;
          margin-bottom: 12px;
          line-height: 1.3;
        }

        p {
          color: #4a5568;
          font-size: 16px;
          line-height: 1.6;
          margin-bottom: 8px;
        }

        .highlight {
          color: #667eea;
          font-weight: 500;
        }

        .countdown {
          margin-top: 24px;
          padding-top: 24px;
          border-top: 1px solid #e2e8f0;
          color: #718096;
          font-size: 14px;
        }

        .countdown strong {
          color: #4a5568;
        }

        @media (max-width: 480px) {
          .container {
            padding: 36px 24px;
          }

          h1 {
            font-size: 24px;
          }

          .success-icon {
            font-size: 64px;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="success-icon">✅</div>
        <h1>Авторизация завершена!</h1>
        <p>
          <span class="highlight">Google Calendar</span> успешно подключен к вашему аккаунту.
        </p>
        <p style="margin-top: 16px;">
          Теперь вы можете вернуться в Telegram и начать работу с календарем.
        </p>
        <div class="countdown">
          Окно автоматически закроется через <strong><span id="countdown">3</span></strong> секунд...
        </div>
      </div>

      <script>
        // Auto-close countdown
        let seconds = 3;
        const countdownElement = document.getElementById('countdown');

        const interval = setInterval(() => {
          seconds--;
          if (countdownElement) {
            countdownElement.textContent = seconds.toString();
          }

          if (seconds <= 0) {
            clearInterval(interval);

            // Try to close the window
            window.close();

            // If window.close() doesn't work (some browsers block it),
            // show alternative message
            setTimeout(() => {
              if (!window.closed) {
                document.body.innerHTML = \`
                  <div class="container">
                    <div class="success-icon">👍</div>
                    <h1>Готово!</h1>
                    <p>Вы можете закрыть эту вкладку и вернуться в Telegram.</p>
                  </div>
                \`;
              }
            }, 500);
          }
        }, 1000);

        // Try to close immediately on mobile
        if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
          setTimeout(() => {
            window.close();
          }, 2000);
        }
      </script>
    </body>
    </html>
  `);
});

/**
 * Error page
 * GET /oauth/google/error?error=XXX
 */
router.get('/error', (req: Request, res: Response) => {
  const { error } = req.query;
  const errorMessage = error || 'Неизвестная ошибка';

  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Ошибка авторизации</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
                       'Helvetica Neue', Arial, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          background: linear-gradient(135deg, #f56565 0%, #c53030 100%);
          padding: 20px;
        }

        .container {
          background: white;
          padding: 48px 40px;
          border-radius: 24px;
          text-align: center;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          max-width: 480px;
          width: 100%;
        }

        .error-icon {
          font-size: 72px;
          margin-bottom: 24px;
        }

        h1 {
          color: #1a202c;
          font-size: 28px;
          font-weight: 600;
          margin-bottom: 12px;
        }

        p {
          color: #4a5568;
          font-size: 16px;
          line-height: 1.6;
          margin-bottom: 8px;
        }

        .error-details {
          margin-top: 20px;
          padding: 16px;
          background: #fff5f5;
          border: 1px solid #feb2b2;
          border-radius: 8px;
          color: #c53030;
          font-size: 14px;
          word-break: break-word;
        }

        .action {
          margin-top: 24px;
          padding-top: 24px;
          border-top: 1px solid #e2e8f0;
          color: #718096;
          font-size: 14px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="error-icon">❌</div>
        <h1>Ошибка авторизации</h1>
        <p>К сожалению, не удалось подключить Google Calendar.</p>

        <div class="error-details">
          ${String(errorMessage)}
        </div>

        <div class="action">
          Вернитесь в Telegram и попробуйте снова: <strong>/connect_google</strong>
        </div>
      </div>
    </body>
    </html>
  `);
});

export default router;
