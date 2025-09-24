import { Effect } from "effect";
import type { ModuleSettingEntry } from "../services/digest-settings";

export type DigestModuleId = "weather" | "fx" | "calendar" | "tasks";

export interface DigestModuleContext {
  readonly userId: number;
  readonly date: Date;
}

export interface DigestModuleResult {
  readonly id: DigestModuleId;
  readonly text: string | null;
}

export interface DigestModuleImpl<R = never> {
  readonly id: DigestModuleId;
  readonly fetch: (
    context: DigestModuleContext,
    settings: ModuleSettingEntry | undefined
  ) => Effect.Effect<string | null, never, R>;
}
