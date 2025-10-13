import { Schema } from "@effect/schema";

export const ConversationMessageSchema = Schema.Struct({
  role: Schema.Literal("user", "assistant"),
  content: Schema.String,
  timestamp: Schema.Number,
});

export type ConversationMessage = Schema.Schema.Type<
  typeof ConversationMessageSchema
>;
