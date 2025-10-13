import { Schema } from "effect";

export const AIAgentConfigSchema = Schema.Struct({
  openaiApiKey: Schema.String,
  model: Schema.optionalWith(Schema.String, { default: () => "gpt-4o-mini" }),
  maxTokens: Schema.optionalWith(Schema.Number, { default: () => 1000 }),
  userId: Schema.Union(Schema.String, Schema.Number),
});

export type AIAgentConfig = Schema.Schema.Type<typeof AIAgentConfigSchema>;
