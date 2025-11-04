import { google } from 'googleapis';
import { handleOAuthStart } from './routes/start';
import { handleOAuthCallback } from './routes/callback';
import { handleSuccess } from './routes/success';
import { handleError } from './routes/error';
import { cleanupExpiredSessions } from './utils/sessions';

const PORT = process.env.API_PORT || 3001;

// Validate required environment variables
const requiredEnvVars = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'API_URL',
  'DATABASE_URL',
  'ENCRYPTION_KEY',
  'TELEGRAM_BOT_TOKEN',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// Cleanup expired sessions every hour
setInterval(async () => {
  try {
    const deleted = await cleanupExpiredSessions();
    if (deleted > 0) {
      console.log(`🧹 Cleaned up ${deleted} expired OAuth session(s)`);
    }
  } catch (error) {
    console.error('Error cleaning up expired sessions:', error);
  }
}, 60 * 60 * 1000);

// Bun native HTTP server
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Request logging
    console.log(`${new Date().toISOString()} ${req.method} ${path}`);

    // CORS headers
    const headers = {
      'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    try {
      // Root and health check
      if (path === '/' || path === '/health') {
        return Response.json(
          { status: 'ok', timestamp: new Date().toISOString(), service: 'google-auth' },
          { headers }
        );
      }

      // OAuth routes
      if (path === '/oauth/google/start') {
        return await handleOAuthStart(url, headers);
      }

      if (path === '/oauth/google/callback') {
        return await handleOAuthCallback(url, headers);
      }

      if (path === '/oauth/google/success') {
        return handleSuccess(url, headers);
      }

      if (path === '/oauth/google/error') {
        return handleError(url, headers);
      }

      // 404
      return Response.json(
        { error: 'Not found' },
        { status: 404, headers }
      );
    } catch (error) {
      console.error('Server error:', error);
      return Response.json(
        { error: 'Internal server error' },
        { status: 500, headers }
      );
    }
  },
});

console.log(`🚀 Google Auth server running on port ${PORT}`);
console.log(`📍 OAuth endpoints:`);
console.log(`   - Start: http://localhost:${PORT}/oauth/google/start`);
console.log(`   - Callback: http://localhost:${PORT}/oauth/google/callback`);
console.log(`   - Success: http://localhost:${PORT}/oauth/google/success`);
console.log(`   - Error: http://localhost:${PORT}/oauth/google/error`);
console.log(`💾 Using PostgreSQL for session storage`);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, closing server...');
  server.stop();
  process.exit(0);
});
