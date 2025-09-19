import { Schema } from "effect"

// User schemas
export const UserSchema = Schema.Struct({
  telegramId: Schema.Number,
  username: Schema.optional(Schema.String),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
})

export const NewUserSchema = Schema.Struct({
  telegramId: Schema.Number,
  username: Schema.optional(Schema.String),
})

// User Integration schemas
export const UserIntegrationSchema = Schema.Struct({
  id: Schema.Number,
  userId: Schema.Number,
  integrationType: Schema.String,
  credentialsEncrypted: Schema.String,
  credentialsIv: Schema.String,
  credentialsTag: Schema.String,
  settings: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  enabled: Schema.Boolean,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
})

export const NewUserIntegrationSchema = Schema.Struct({
  userId: Schema.Number,
  integrationType: Schema.String,
  credentialsEncrypted: Schema.String,
  credentialsIv: Schema.String,
  credentialsTag: Schema.String,
  settings: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  enabled: Schema.optional(Schema.Boolean),
})

// User Config schema for application layer
export const UserIntegrationConfigSchema = Schema.Struct({
  name: Schema.String,
  credentials: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  enabled: Schema.Boolean,
  settings: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})

export const UserConfigSchema = Schema.Struct({
  userId: Schema.Union(Schema.String, Schema.Number),
  username: Schema.optional(Schema.String),
  integrations: Schema.Array(UserIntegrationConfigSchema),
  aiSettings: Schema.optional(Schema.Struct({
    model: Schema.optional(Schema.String),
    temperature: Schema.optional(Schema.Number),
    maxTokens: Schema.optional(Schema.Number),
  })),
  preferences: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})

// Infer types
export type User = Schema.Schema.Type<typeof UserSchema>
export type NewUser = Schema.Schema.Type<typeof NewUserSchema>
export type UserIntegration = Schema.Schema.Type<typeof UserIntegrationSchema>
export type NewUserIntegration = Schema.Schema.Type<typeof NewUserIntegrationSchema>
export type UserIntegrationConfig = Schema.Schema.Type<typeof UserIntegrationConfigSchema>
export type UserConfig = Schema.Schema.Type<typeof UserConfigSchema>