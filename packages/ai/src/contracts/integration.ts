import { Schema } from "@effect/schema";
import { Context, Data, Effect } from "effect";
import type { InlineKeyboardMarkup } from "grammy/types";
import { Tool as AITool, type CoreMessage } from "ai";

export const InteractionType = Schema.Literal(
  "TEXT",
  "VOICE",
  "IMAGE",
  "FORWARD"
);
export type InteractionType = Schema.Schema.Type<typeof InteractionType>;

export const ToolMetadata = Schema.Struct({
  name: Schema.String,
  permissions: Schema.Struct({
    read: Schema.Boolean,
    write: Schema.Boolean,
  }),
  supportedInteractionTypes: Schema.Array(InteractionType),
  progressMessage: Schema.String,
  progressEmoji: Schema.String,
  description: Schema.String,
});
export type ToolMetadata = Schema.Schema.Type<typeof ToolMetadata>;

export const IntegrationConfig = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  description: Schema.String,
});
export type IntegrationConfig = Schema.Schema.Type<typeof IntegrationConfig>;

export type IntegrationCredentials = Record<string, unknown>;

export const ToolResult = Schema.Struct({
  success: Schema.Boolean,
  data: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.String),
});
export type ToolResult = Schema.Schema.Type<typeof ToolResult>;

export const ProgressStep = Schema.Struct({
  type: Schema.Literal("tool_call", "progress", "completed"),
  message: Schema.String,
  emoji: Schema.String,
  metadata: Schema.optional(Schema.Unknown),
});
export type ProgressStep = Schema.Schema.Type<typeof ProgressStep>;

export class IntegrationError extends Data.TaggedError("IntegrationError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ToolError extends Data.TaggedError("ToolError")<{
  readonly toolName: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class MetadataError extends Data.TaggedError("MetadataError")<{
  readonly toolName: string;
  readonly message: string;
}> {}

export class AuthError extends Data.TaggedError("AuthError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class FormatError extends Data.TaggedError("FormatError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface ToolFormatterResult {
  readonly text: string;
  readonly parseMode?: "Markdown" | "HTML";
  readonly replyMarkup?: InlineKeyboardMarkup;
  readonly metadata?: Record<string, unknown>;
}

export type ToolResultFormatter = (
  output: unknown
) => Effect.Effect<ToolFormatterResult, never>;

export interface IntegrationToolsBundle {
  readonly tools: Record<string, AITool>;
  readonly formatters: Record<string, ToolResultFormatter>;
  readonly progressMessages: Record<string, string>;
  readonly contextMessages?: ReadonlyArray<CoreMessage>;
}

export interface IntegrationRegistry {
  readonly getToolsForUser: (
    userId: string | number,
    interactionType: InteractionType
  ) => Effect.Effect<IntegrationToolsBundle, IntegrationError>;
}

export const IntegrationRegistry =
  Context.GenericTag<IntegrationRegistry>("@services/IntegrationRegistry");
