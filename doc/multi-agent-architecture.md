# Multi-Agent Architecture Proposal

## Objectives
- Reduce coupling inside the monolithic `AIAgent` by isolating journal, task, calendar flows into focused agents with their own prompts and tool policies.
- Unlock domain-specific tuning (system prompts, loop limits, schema validation) without affecting unrelated features.
- Prepare the stack for future orchestration patterns (parallel tool execution, fallback agents, monitoring).

## Proposed Agent Landscape
| Agent | Primary responsibilities | Tool bundle | System prompt themes | Notes |
| --- | --- | --- | --- | --- |
| **Orchestrator Agent** | Entry point for each incoming user message. Classifies the intent, keeps high-level conversation context, and triggers downstream agents. | Internal tools only ("call_journal_agent", "call_task_agent", etc.). Each tool wraps an Effect call into a peer agent. | Clarify its role as a coordinator, outline how to decide between replying directly vs. delegating. | Should never mutate state itself—delegates all side effects via subagents. |
| **Journal Agent** | Handles diary-specific interactions: entry creation, mood analysis, journaling follow-ups. | `createJournalEntry`, structured analysis helpers. | Empathy, journaling, ensures tags/metadata, minimal calendar/task instructions. | Reuses existing `createJournalTools` bundle; may use the journal analysis service internally. |
| **Task Agent** | Task CRUD, rescheduling, listing, suggestions. | `createTask`, `updateTask`, `listTasks`, `rescheduleTask`. | Productivity-focused prompt with instructions for concise task operations. | Powered by `createTaskTools`; responsible for calling TaskRepository. |
| **Calendar Agent** | Calendar queries, event creation, availability checks. | Yandex calendar tools, potentially weather/digest modules later. | Scheduling tone, confirm time zones and date formats. | Can be extended with future providers beyond Yandex. |
| **Digest Agent (optional)** | Morning digest generation, settings tweaks. | `updateDigestSettings`, digest summarization helpers. | Informational tone, status reporting. | Only needed if digest conversation flows remain in chat. |

## Orchestrator Flow (generateObject-first)
1. **Pre-processing**: collect conversation history, user profile, and integration metadata (via `IntegrationRegistry`).
2. **Routing decision via `generateObject`**:
   - Call `generateObject` with a compact schema describing available domain agents, e.g. `{ agents: z.array(z.enum(["journal", "tasks", "calendar"])) }` plus a confidence score or reason.
   - The prompt should briefly describe each agent’s remit so the model can pick one or more candidates.
   - We can cap the number of agents returned (e.g. max 2) to keep sequential execution manageable.
3. **Sequential agent execution**: iterate through the ordered list from `generateObject` and invoke the corresponding domain agents programmatically (no Agent-class orchestrator). Each agent receives the original message, relevant history, and any intermediate context produced by earlier agents.
4. **Response aggregation**: collect tool results/responses from each agent, merge using existing formatter logic, and surface a single outgoing message. If multiple agents respond, concatenate in a deterministic order with separators.
5. **Fallback / escalation**: when `generateObject` returns an empty list or low confidence, reply with a neutral fallback and log the interaction for later prompt tuning.

## Effect Layering Strategy
- **Service wrappers**: expose each domain agent as an Effect service (`JournalAgent`, `TaskAgent`, etc.) with `processMessage`/`processText` APIs similar to the current `AIAgent` contract.
- **Layer composition**: orchestrator layer depends on `IntegrationRegistry` for tool discovery plus all domain agent layers. Each domain agent layer loads only the repositories it needs.
- **Caching**: keep per-user caches inside each domain agent factory (mirroring the current cache). The orchestrator can cache its own Agent instance while swapping `tools` dynamically per request if necessary.

## Migration Steps
1. **Extract domain tool bundles**: ensure journal/tasks/calendar tool factories are self-contained and exportable without shared mutable state (mostly already true).
2. **Introduce domain agents**: for each domain, create `makeXAgent` analogous to the current `makeAIAgent` but with specialized system prompts and a slim tool set.
3. **Wrap domain agents**: expose `XAgent` services and factories with Effect layers. Update repositories/tests where appropriate.
4. **Implement `generateObject` router**: define schemas, prompts, and wrapper function that returns the ordered agent list plus routing metadata.
5. **Swap entrypoint**: modify Telegram client (and other consumers) to first call the router, then sequentially run the recommended domain agents.
6. **Telemetry & tuning**: log routing decisions, per-agent execution outcomes, and adjust the routing prompt as new intents emerge.

## Open Questions
- **Conversation state sharing**: should domain agents receive the full conversation history or only filtered snippets? (May need a shared memory service.)
- **Parallel vs. sequential routing**: do we require multi-agent parallelism (e.g., tasks & calendar simultaneously) or is single-agent delegation sufficient for v1?
- **Orchestrator constraints**: to avoid infinite loops, define max tool round trips and guard against cyclical agent calls.
- **Shared prompts**: consider a global style guide so domain responses feel consistent even though prompts diverge.

## Next Actions
- Validate the orchestrator design with a lightweight prototype (e.g., only journal + task agents) before migrating all domains.
- Document prompt guidelines for each agent to keep behaviours predictable.
- Update the migration plan to incorporate multi-agent rollout after the current Agent-class transition stabilizes.
