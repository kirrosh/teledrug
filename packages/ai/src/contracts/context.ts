import { Schema } from "effect";

export const SimpleChatContextSchema = Schema.Struct({
  userId: Schema.Union(Schema.String, Schema.Number),
  chatId: Schema.Union(Schema.String, Schema.Number),
  messageContent: Schema.String,
  interactionType: Schema.optionalWith(
    Schema.Literal("TEXT", "VOICE", "IMAGE", "FORWARD"),
    { default: () => "TEXT" }
  ),
});

export type SimpleChatContext = Schema.Schema.Type<
  typeof SimpleChatContextSchema
>;
