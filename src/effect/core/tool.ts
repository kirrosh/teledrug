import { Effect, Context, Data, Schema } from "effect"
import { Tool as AITool } from "ai"
import {
  ToolMetadata,
  ToolResult,
  ToolError,
  FormatError,
  ProgressStep,
  InteractionType
} from "../types/integrations"

// Tool Configuration Schema
export interface ToolConfig {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly permissions: {
    readonly read: boolean
    readonly write: boolean
  }
  readonly supportedInteractionTypes: readonly InteractionType[]
}

// Tool Service - отдельная сущность
export interface ToolService<TParams = unknown, TResult = unknown> {
  readonly config: ToolConfig
  readonly execute: (params: TParams) => Effect.Effect<TResult, ToolError>
  readonly format: (result: TResult) => Effect.Effect<string, FormatError>
  readonly toAITool: () => Effect.Effect<AITool, never>
  readonly progress: ProgressStep
}

// Generic Tool Context Tag
export interface Tool<TParams = unknown, TResult = unknown> {
  readonly _tag: unique symbol
}

export const Tool = <TParams = unknown, TResult = unknown>(
  tag: string
): Context.Tag<Tool<TParams, TResult>, ToolService<TParams, TResult>> =>
  Context.GenericTag<ToolService<TParams, TResult>>(`@tools/${tag}`)

// AuthContext interface for tools
export interface AuthContext {
  readonly credentials: Record<string, any>
  readonly isAuthenticated: boolean
}

export const AuthContext = Context.GenericTag<AuthContext>("@auth/Context")

// Tool Factory
export const makeTool = <TParams, TResult>(
  config: ToolConfig,
  execute: (
    params: TParams,
    auth: AuthContext
  ) => Effect.Effect<TResult, ToolError>,
  format: (result: TResult) => string
) =>
  Effect.gen(function* () {
    // Получаем контекст авторизации из слоя
    const auth = yield* AuthContext

    const executeWithAuth = (params: TParams) => execute(params, auth)

    const formatResult = (result: TResult) => Effect.succeed(format(result))

    const toAITool = () => {
      const { tool } = require("ai")

      return Effect.succeed(
        tool({
          description: config.description,
          parameters: config.parameters,
          execute: async (params) => {
            const result = await Effect.runPromise(
              executeWithAuth(params as TParams)
            )
            return format(result)
          }
        })
      )
    }

    return {
      config,
      execute: executeWithAuth,
      format: formatResult,
      toAITool,
      progress: {
        type: "tool_call" as const,
        message: `Executing ${config.name}...`,
        emoji: "⚡"
      }
    } satisfies ToolService<TParams, TResult>
  })