# @teledrug/ai

Dedicated package for TeleDrug's AI/LLM orchestration.

## What lives here now
- Agent orchestration service (`AIAgent`, `AIAgentFactory`) with routing, history normalisation, and Effect layers.
- Shared contracts: configuration schemas, chat context, conversation messages, integration tool bundles, and formatter types.
- AI-specific error types (`AIAgentError`, `IntegrationError`, etc.).
- Internal test helpers and LLM harnesses.
- Unit and integration tests under `tests/` (LLM scenarios gated by `RUN_LLM_TESTS=1`).

## Roadmap
- Move domain tool factories (journal/tasks/digest/settings/calendar) behind explicit ports.
- Extract transcription and journal-analysis services from `@teledrug/core`.
- Reduce Telegram-specific surface in formatter contracts once adapters are in place.

See `doc/ai-package-extraction.md` for detailed migration notes.
