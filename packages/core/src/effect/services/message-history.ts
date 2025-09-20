import { Effect, Context, Layer, Ref } from "effect"
import { MessageHistoryError } from "../errors"
import type { ConversationMessage } from "../types"

// Service interface
export interface MessageHistory {
  readonly addUserMessage: (chatId: number, message: string) => Effect.Effect<void, MessageHistoryError>
  readonly addAssistantMessage: (chatId: number, message: string) => Effect.Effect<void, MessageHistoryError>
  readonly getHistory: (chatId: number) => Effect.Effect<string[], MessageHistoryError>
  readonly clearHistory: (chatId: number) => Effect.Effect<void, MessageHistoryError>
  readonly getHistoryLength: (chatId: number) => Effect.Effect<number, MessageHistoryError>
  readonly getRecentHistory: (chatId: number, count: number) => Effect.Effect<string[], MessageHistoryError>
}

// Service tag
export const MessageHistory = Context.GenericTag<MessageHistory>("@services/MessageHistory")

// Implementation
const makeMessageHistory = Effect.gen(function* () {
  const maxMessagesPerChat = 20
  const histories = yield* Ref.make(new Map<number, ConversationMessage[]>())

  const addMessage = (chatId: number, role: "user" | "assistant", content: string): Effect.Effect<void, MessageHistoryError> =>
    Effect.gen(function* () {
      try {
        const message: ConversationMessage = {
          role,
          content,
          timestamp: Date.now(),
        }

        yield* Ref.update(histories, (map) => {
          const chatHistory = map.get(chatId) || []
          chatHistory.push(message)

          // Limit history length
          if (chatHistory.length > maxMessagesPerChat) {
            chatHistory.splice(0, chatHistory.length - maxMessagesPerChat)
          }

          map.set(chatId, chatHistory)
          return new Map(map)
        })
      } catch (cause) {
        return yield* Effect.fail(new MessageHistoryError({
          message: `Failed to add ${role} message for chat ${chatId}`,
          cause
        }))
      }
    })

  const addUserMessage = (chatId: number, message: string): Effect.Effect<void, MessageHistoryError> =>
    addMessage(chatId, "user", message)

  const addAssistantMessage = (chatId: number, message: string): Effect.Effect<void, MessageHistoryError> =>
    addMessage(chatId, "assistant", message)

  const getHistory = (chatId: number): Effect.Effect<string[], MessageHistoryError> =>
    Effect.gen(function* () {
      try {
        const map = yield* Ref.get(histories)
        const chatHistory = map.get(chatId) || []
        return chatHistory.map(msg => msg.content)
      } catch (cause) {
        return yield* Effect.fail(new MessageHistoryError({
          message: `Failed to get history for chat ${chatId}`,
          cause
        }))
      }
    })

  const clearHistory = (chatId: number): Effect.Effect<void, MessageHistoryError> =>
    Effect.gen(function* () {
      try {
        yield* Ref.update(histories, (map) => {
          map.delete(chatId)
          return new Map(map)
        })
      } catch (cause) {
        return yield* Effect.fail(new MessageHistoryError({
          message: `Failed to clear history for chat ${chatId}`,
          cause
        }))
      }
    })

  const getHistoryLength = (chatId: number): Effect.Effect<number, MessageHistoryError> =>
    Effect.gen(function* () {
      try {
        const map = yield* Ref.get(histories)
        const chatHistory = map.get(chatId) || []
        return chatHistory.length
      } catch (cause) {
        return yield* Effect.fail(new MessageHistoryError({
          message: `Failed to get history length for chat ${chatId}`,
          cause
        }))
      }
    })

  const getRecentHistory = (chatId: number, count: number): Effect.Effect<string[], MessageHistoryError> =>
    Effect.gen(function* () {
      try {
        const map = yield* Ref.get(histories)
        const chatHistory = map.get(chatId) || []
        const recentMessages = chatHistory.slice(-count)
        return recentMessages.map(msg => msg.content)
      } catch (cause) {
        return yield* Effect.fail(new MessageHistoryError({
          message: `Failed to get recent history for chat ${chatId}`,
          cause
        }))
      }
    })

  return MessageHistory.of({
    addUserMessage,
    addAssistantMessage,
    getHistory,
    clearHistory,
    getHistoryLength,
    getRecentHistory,
  })
})

// Live layer
export const MessageHistoryLive = Layer.effect(
  MessageHistory,
  makeMessageHistory
)