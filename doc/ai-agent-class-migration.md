# AI Agent Class Migration Plan

## Current Vercel AI SDK Footprint
- **Conversation entrypoint** – `packages/core/src/effect/services/ai-agent.ts:62` builds user-specific agents on the fly, injects the OpenAI API key via `process.env`, and calls `generateText` with `toolChoice: "required"` to let the SDK execute tools automatically. The service returns raw `GenerateTextResult` objects alongside formatting metadata.
- **Structured journal tooling** – `packages/core/src/effect/journal/tools.ts:185` pre-creates an `openai` model instance per user and calls `generateObject` for task suggestions while exposing `tool(...)` definitions that the agent consumes.
- **Journal analysis pipeline** – `packages/core/src/effect/services/journal-analysis.ts:51` keeps a long-lived `openai` model instance and relies on a single `generateText` call with a strict JSON prompt, performing its own parsing and validation.
- **Tool registry and consumers** – `packages/core/src/effect/services/integration-registry.ts:1` aggregates `Tool` objects exported from digest, journal, task, and integration modules. Downstream layers (e.g. Telegram client) expect this registry to surface `tools`, `formatters`, and `progressMessages` separately, mirroring the shape produced by `tool(...)` helpers.
- **Additional tool wrappers** – Supporting files such as `packages/core/src/effect/tasks/tools.ts` and `packages/core/src/effect/integrations/yandex-calendar/index.ts` define business logic within `tool({ execute })` factories. They currently depend on the SDK only through the `tool` helper type and return plain JavaScript objects, so they are mostly API-shape compatible with the Agent class.

## What the Agent Class Brings
- Centralises model, system prompt, tools, and loop policy (`Experimental_Agent` from `ai`). Once instantiated, `agent.generateText`, `agent.stream`, or `agent.respond` can be reused across transports without re-specifying configuration.
- Built-in tool loop orchestration (sequential multi-call support) with optional `toolChoice`, `maxToolRoundTrips`, and custom loop handlers.
- More consistent typing via `Experimental_InferAgentInputs`/`Experimental_InferAgentUIMessage` helpers for end-to-end safety.
- Flexible output primitives (`respond()` for HTTP handlers, `generateText()` for backend flows) that align with existing Effect pipelines.

## Migration Objectives
1. Eliminate direct `generateText` / `generateObject` usage where conversational behaviour lives, replacing them with the Agent abstraction while preserving Effect-centric error handling.
2. Keep the existing tool registry contract intact so downstream services (Telegram client, formatters) continue to work without large refactors.
3. Improve configuration hygiene (avoid mutating `process.env`, support per-user API keys and models).
4. Maintain structured outputs for journal analytics either through dedicated Agents or by isolating the remaining `generate*` helpers behind Effect services.

## Recommended Migration Phases

### Phase 0 – Prerequisites
- Upgrade `ai` / `@ai-sdk/*` packages to versions that expose `Experimental_Agent`. Capture release notes for breaking changes (stream protocol, tool signatures).
- Document minimum runtime expectations (Node version, streaming polyfills) in `doc/PRD_*` series.

### Phase 1 – Introduce Agent Factory Layer
- Add an internal `packages/core/src/effect/services/agent-factory.ts` (name TBD) exporting a helper that wraps `new Agent({ model, system, tools, ... })`.
- Replace the mutable `process.env.OPENAI_API_KEY` with model factory options, e.g. `openai(validatedConfig.model, { apiKey: validatedConfig.openaiApiKey })`.
- Expose knobs for loop control (iterations, fallbacks) that mirror current `toolChoice: "required"` semantics.

### Phase 2 – Migrate `AIAgent` Service
- Rework `packages/core/src/effect/services/ai-agent.ts` to instantiate the Agent via the new factory. Cache user-specific `Agent` instances instead of ad-hoc functions.
- Update `processMessage` to call `agent.generateText({ messages, input: { ...context } })` (or `agent.respond` when integrating with HTTP). Ensure tool result metadata is still surfaced for formatters and progress reporters.
- Adjust logging to reflect Agent loop iterations (tool call counts now available through loop events).

### Phase 3 – Align Tool Registry
- Verify that existing `tool({ ... })` definitions remain compatible. If the Agent class requires the new tool signature (`defineTool` with `metadata`), add thin adapters inside `create*Tools` modules without altering business logic.
- Extend `IntegrationToolsBundle` to optionally carry Agent-specific metadata (e.g. `maxToolRoundTrips`) should we want per-user overrides.

### Phase 4 – Structured Generation Updates
- For journal task extraction (`generateObject`), decide between
  1. wrapping it inside a small Agent configured with `structuredOutput: schema`, or
  2. leaving it as-is behind a dedicated Effect service that hides the legacy API.
- For `JournalAnalysisService`, consider a minimal Agent with deterministic system prompt and `agent.generateText`. Reuse the existing JSON parsing guard to maintain validation.

### Phase 5 – Testing & Rollout
- Update unit/integration tests (or add targeted Effect property tests) to capture Agent behaviour, especially tool sequencing and error propagation.
- Exercise Telegram flows end-to-end in staging, checking tool progress reporting and message formatting.
- Remove deprecated helpers (`generateText`, `generateObject`) from hot paths once confidence is achieved.

## Task Breakdown
1. Audit and lock dependency versions supporting `Experimental_Agent` (package.json, bun.lock). 
2. Prototype Agent instantiation with one tool bundle (e.g. journal tools) and validate responses locally. 
3. Refactor `AIAgent` cache to store Agent instances and adapt message handling to the new API. 
4. Ensure tool registry outputs satisfy the Agent contract; add adapters/tests if needed. 
5. Decide and implement strategy for structured outputs (full Agent vs legacy wrapper). 
6. Regression test Telegram workflows and cron jobs that depend on AI outcomes. 
7. Update documentation (`doc/PRD_*`) and developer onboarding notes with the new Agent usage pattern.

## Open Questions & Risks
- Agent loop defaults (max iterations, stop criteria) might differ from the implicit behaviour we rely on today; we should confirm they match the existing `toolChoice: "required"` expectations.
- Performance implications of caching full Agent instances vs. lightweight model references, especially with per-user API keys.
- Compatibility of `tool` definitions generated via `tool({ ... })` once the SDK finalises the Agent API (currently under `Experimental_*` namespace).
- Structured output fidelity: if we migrate `generateObject`, we must ensure zod-based schema validation still happens before persisting data.

