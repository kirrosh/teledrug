import { Schema } from "@effect/schema"
export {
  ConversationMessageSchema,
  type ConversationMessage,
} from "@teledrug/ai"

// Encrypted data schema
export const EncryptedDataSchema = Schema.Struct({
  encrypted: Schema.String,
  iv: Schema.String,
  tag: Schema.String,
})

export type EncryptedPayload = Schema.Schema.Type<typeof EncryptedDataSchema>

// Message schemas re-exported from @teledrug/ai
// Configuration schemas
export const BotConfigSchema = Schema.Struct({
  telegramToken: Schema.String,
  webAppUrl: Schema.optional(Schema.String),
})

export type BotConfig = Schema.Schema.Type<typeof BotConfigSchema>

// Chat context for updates
export const UpdateContextSchema = Schema.Struct({
  chatId: Schema.Number,
  userId: Schema.Number,
  text: Schema.String,
})

export type UpdateContext = Schema.Schema.Type<typeof UpdateContextSchema>
