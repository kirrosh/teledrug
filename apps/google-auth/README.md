# Google Auth Service

OAuth 2.0 service for Google Calendar integration using Bun native HTTP server.

## Features

- Google Calendar OAuth 2.0 with PKCE
- PostgreSQL session storage
- Automatic session cleanup
- Success/error HTML pages
- Native Bun HTTP server (no Express)

## Setup

1. Copy environment variables:
```bash
cp .env.example .env
```

2. Configure `.env` with your credentials

3. Install dependencies:
```bash
bun install
```

## Development

```bash
bun run dev
```

Server will start on `http://localhost:3001`

## Build

```bash
bun run build
```

Output: `dist/index.js`

## Production

```bash
bun run start
```

Or directly:
```bash
bun run dist/index.js
```

## Deploy

### Railway

1. Push to GitHub
2. Connect repository to Railway
3. Add environment variables
4. Railway will auto-deploy

### Fly.io

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Create app
fly launch

# Set secrets
fly secrets set DATABASE_URL="..." \
  ENCRYPTION_KEY="..." \
  TELEGRAM_BOT_TOKEN="..." \
  GOOGLE_CLIENT_ID="..." \
  GOOGLE_CLIENT_SECRET="..." \
  API_URL="https://your-app.fly.dev" \
  GOOGLE_REDIRECT_URI="https://your-app.fly.dev/oauth/google/callback"

# Deploy
fly deploy
```

### VPS

```bash
# Install dependencies
bun install

# Run with PM2
pm2 start dist/index.js --name google-auth --interpreter bun

# Or with systemd
sudo systemctl start google-auth
```

## Endpoints

- `GET /health` - Health check
- `GET /oauth/google/start` - Initialize OAuth flow
- `GET /oauth/google/callback` - OAuth callback
- `GET /oauth/google/success` - Success page
- `GET /oauth/google/error` - Error page

## Environment Variables

See `.env.example` for all required variables.

## Google Cloud Console

1. Create project at https://console.cloud.google.com
2. Enable Google Calendar API
3. Create OAuth 2.0 credentials
4. Add redirect URI: `https://your-domain.com/oauth/google/callback`
5. Copy Client ID and Client Secret to `.env`
