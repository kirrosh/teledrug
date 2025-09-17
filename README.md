# TeleDrug - AI Assistant with Integrations

AI-powered Telegram bot with Yandex Calendar integration.

## Features

- 🤖 **AI-powered responses** using OpenAI with interactive progress updates
- 📅 **Advanced Yandex Calendar integration** - get/create events with rich card formatting
- 💬 **Smart conversation management** - LLM history + message tracking
- 🧹 **Complete chat cleanup** - clears both LLM memory and Telegram messages
- 📊 **Enhanced event cards** - detailed formatting with links, participants, and status
- ⚡ **Real-time progress** - shows what the bot is doing (thinking → checking calendar → result)
- 🔧 Configurable via environment variables

## Setup

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required variables:
- `TELEGRAM_BOT_TOKEN` - Your Telegram bot token
- `OPENAI_API_KEY` - Your OpenAI API key

### 3. Run the bot

```bash
bun run src/index.ts
```

## Usage

After starting a conversation with the bot:

1. **Automatic Integration Setup**: When you first message the bot, available integrations are automatically configured based on your environment variables.

2. **Available Commands**:
   - `/integrations` - Show your active integrations
   - `/clear` - **Complete chat cleanup** (clears LLM history + deletes messages from Telegram chat)
   - `/history` - Show chat statistics (LLM history size + tracked messages count)

3. **Natural Language Queries**:
   - "Какие у меня встречи сегодня?" - Get today's calendar events
   - "Создай встречу завтра в 15:00" - Create a calendar event

## Project Structure

```
src/
├── core/           # Core services (bot, user management, AI)
├── integrations/   # Integration modules
│   ├── base/       # Base integration classes
│   ├── jira/       # Jira integration
│   └── yandex-calendar/ # Yandex Calendar integration
├── modules/        # Utility modules (AI, conversation history)
├── storage/        # User configuration storage
├── telegram/       # Telegram bot handlers
└── index.ts        # Entry point
```

## Integrations

### Yandex Calendar Integration
- Automatically connects with hardcoded credentials
- Fetches events for specified date ranges
- Creates new calendar events
- Parses iCalendar format

This project was created using `bun init` in bun v1.2.21. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.