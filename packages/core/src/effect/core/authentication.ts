import { Effect, Context, Layer } from "effect"
import { AuthError } from "../types/integrations"

// Authentication Context interface
export interface AuthContext {
  readonly credentials: Record<string, any>
  readonly isAuthenticated: boolean
  readonly refresh: () => Effect.Effect<void, AuthError>
}

export const AuthContext = Context.GenericTag<AuthContext>("@auth/Context")

// Authentication Provider для каждой интеграции
export const makeAuthProvider =
  <TCredentials extends Record<string, any>>(
    validate: (credentials: TCredentials) => Effect.Effect<boolean, AuthError>,
    refresh?: (
      credentials: TCredentials
    ) => Effect.Effect<TCredentials, AuthError>
  ) =>
  (credentials: TCredentials) =>
    Layer.effect(
      AuthContext,
      Effect.gen(function* () {
        const isAuthenticated = yield* validate(credentials)

        return {
          credentials,
          isAuthenticated,
          refresh: refresh
            ? () => Effect.flatMap(refresh(credentials), validate)
            : () => Effect.succeed(void 0)
        }
      })
    )

// Простой провайдер для тестирования (всегда валидный)
export const TestAuthProvider = (credentials: Record<string, any>) =>
  Layer.succeed(AuthContext, {
    credentials,
    isAuthenticated: true,
    refresh: () => Effect.succeed(void 0)
  })