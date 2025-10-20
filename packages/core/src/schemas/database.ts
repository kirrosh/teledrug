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

export const UserSettingsSchema = Schema.Struct({
  userId: Schema.Number,
  timezone: Schema.String,
  locale: Schema.String,
  city: Schema.optional(Schema.String),
  country: Schema.optional(Schema.String),
  preferences: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown })
  ),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
})

export const NewUserSettingsSchema = Schema.Struct({
  userId: Schema.Number,
  timezone: Schema.optional(Schema.String),
  locale: Schema.optional(Schema.String),
  city: Schema.optional(Schema.String),
  country: Schema.optional(Schema.String),
  preferences: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown })
  ),
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
  settings: Schema.Struct({
    timezone: Schema.String,
    locale: Schema.String,
    city: Schema.optional(Schema.String),
    country: Schema.optional(Schema.String),
  }),
  aiSettings: Schema.optional(Schema.Struct({
    model: Schema.optional(Schema.String),
    temperature: Schema.optional(Schema.Number),
    maxTokens: Schema.optional(Schema.Number),
  })),
  preferences: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})

export const JournalMoodSchema = Schema.Literal(
  "very_negative",
  "negative",
  "neutral",
  "positive",
  "very_positive",
  "mixed"
)

export const JournalEnergySchema = Schema.Literal(
  "very_low",
  "low",
  "medium",
  "high",
  "very_high"
)

export const JournalEntrySchema = Schema.Struct({
  id: Schema.Number,
  userId: Schema.Number,
  entryDate: Schema.Date,
  title: Schema.String,
  content: Schema.String,
  mood: JournalMoodSchema,
  energy: JournalEnergySchema,
  tags: Schema.Array(Schema.String),
  aiMetadata: Schema.optional(Schema.Unknown),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
})

export const NewJournalEntrySchema = Schema.Struct({
  userId: Schema.Number,
  entryDate: Schema.optional(Schema.Date),
  title: Schema.String,
  content: Schema.String,
  mood: JournalMoodSchema,
  energy: JournalEnergySchema,
  tags: Schema.optional(Schema.Array(Schema.String)),
  aiMetadata: Schema.optional(Schema.Unknown),
})

export const JournalTagSchema = Schema.Struct({
  id: Schema.Number,
  userId: Schema.Number,
  name: Schema.String,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
})

export const NewJournalTagSchema = Schema.Struct({
  userId: Schema.Number,
  name: Schema.String,
})

// Infer types
export type User = Schema.Schema.Type<typeof UserSchema>
export type NewUser = Schema.Schema.Type<typeof NewUserSchema>
export type UserSettings = Schema.Schema.Type<typeof UserSettingsSchema>
export type NewUserSettings = Schema.Schema.Type<typeof NewUserSettingsSchema>
export type UserIntegration = Schema.Schema.Type<typeof UserIntegrationSchema>
export type NewUserIntegration = Schema.Schema.Type<typeof NewUserIntegrationSchema>
export type UserIntegrationConfig = Schema.Schema.Type<typeof UserIntegrationConfigSchema>
export type UserConfig = Schema.Schema.Type<typeof UserConfigSchema>
export type JournalEntry = Schema.Schema.Type<typeof JournalEntrySchema>
export type NewJournalEntry = Schema.Schema.Type<typeof NewJournalEntrySchema>
export type JournalTag = Schema.Schema.Type<typeof JournalTagSchema>
export type NewJournalTag = Schema.Schema.Type<typeof NewJournalTagSchema>
export type JournalMood = Schema.Schema.Type<typeof JournalMoodSchema>
export type JournalEnergy = Schema.Schema.Type<typeof JournalEnergySchema>
