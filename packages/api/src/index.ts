import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import oauthGoogleRouter from './routes/oauth-google.js';
import { errorHandler } from './middleware/error-handler.js';
import { cleanupExpiredSessions } from './utils/sessions.js';

const app = express();
const PORT = process.env.API_PORT || 3001;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for OAuth redirects
}));

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// OAuth routes
app.use('/oauth/google', oauthGoogleRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use(errorHandler);

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 API server running on port ${PORT}`);
  console.log(`📍 OAuth endpoints:`);
  console.log(`   - Start: http://localhost:${PORT}/oauth/google/start`);
  console.log(`   - Callback: http://localhost:${PORT}/oauth/google/callback`);
  console.log(`   - Success: http://localhost:${PORT}/oauth/google/success`);
  console.log(`   - Error: http://localhost:${PORT}/oauth/google/error`);
  console.log(`💾 Using PostgreSQL for session storage`);

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
  }, 60 * 60 * 1000); // 1 hour
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

export default app;
