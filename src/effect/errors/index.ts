import { Data } from "effect"

export class CryptographyError extends Data.TaggedError("CryptographyError")<{
  message: string
  cause?: unknown
}> {}

export class MessageHistoryError extends Data.TaggedError("MessageHistoryError")<{
  message: string
  cause?: unknown
}> {}

export class TelegramClientError extends Data.TaggedError("TelegramClientError")<{
  message: string
  cause?: unknown
}> {}

export class BotApplicationError extends Data.TaggedError("BotApplicationError")<{
  message: string
  cause?: unknown
}> {}

export class ConfigurationError extends Data.TaggedError("ConfigurationError")<{
  message: string
  cause?: unknown
}> {}