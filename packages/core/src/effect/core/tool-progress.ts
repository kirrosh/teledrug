import { Context, Effect } from "effect";

export interface ToolProgressReporter {
  readonly report: (
    toolName: string,
    message: string
  ) => Effect.Effect<void, never>;
}

export const ToolProgressReporter = Context.GenericTag<ToolProgressReporter>(
  "@tools/ToolProgressReporter"
);
