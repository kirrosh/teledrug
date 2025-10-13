import { Data } from "effect";

export class AIAgentError extends Data.TaggedError("AIAgentError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
