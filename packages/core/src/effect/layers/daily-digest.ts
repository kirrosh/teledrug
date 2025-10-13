import { Layer, pipe } from "effect";
import { EncryptionServiceLive } from "@teledrug/encryption";
import { DigestSettingsRepositoryLive, DigestSettingsRepository } from "../services/digest-settings";
import { UserRepositoryLive, UserRepository } from "../services/user-repository";
import { TaskRepositoryLive, TaskRepository } from "../services/task-repository";

/**
 * Shared layer used by daily digest jobs. Provides repositories and services
 * required by digest modules (calendar, tasks, etc.).
 */
export const DailyDigestLayer = Layer.mergeAll(
  DigestSettingsRepositoryLive,
  TaskRepositoryLive,
  pipe(
    UserRepositoryLive,
    Layer.provide(EncryptionServiceLive),
    Layer.provide(DigestSettingsRepositoryLive)
  )
) as unknown as Layer.Layer<DailyDigestEnv, unknown, never>;

export type DailyDigestEnv =
  | typeof DigestSettingsRepository
  | typeof UserRepository
  | typeof TaskRepository;
