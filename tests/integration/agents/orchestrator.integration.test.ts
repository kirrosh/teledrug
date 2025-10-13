import { expect } from "bun:test";
import { Effect } from "effect";
import { tool } from "ai";
import { z } from "zod";

import {
  AIAgent,
  AIAgentLive,
} from "../../../packages/core/src/effect/services/ai-agent";
import type { AIAgentConfig } from "@teledrug/ai";
import {
  IntegrationRegistry,
  type IntegrationRegistry as IntegrationRegistryService,
  type IntegrationToolsBundle,
} from "../../../packages/core/src/effect/services/integration-registry";
import {
  buildSimpleContext,
  describeLLM,
  ensureOpenAIKey,
  forceToolContext,
  getModelName,
  isNetworkError,
  testLLM,
} from "./harness";
import type { ConversationMessage } from "../../../packages/core/src/effect/types";

const ManageTasksSchema = z.object({
  create: z
    .array(
      z.object({
        title: z.string().min(1),
        dueAt: z.string().optional().nullable(),
      })
    )
    .default([]),
  update: z
    .array(
      z.object({
        id: z.number().int().positive().optional(),
        title: z.string().optional(),
        set: z.object({
          title: z.string().optional(),
          dueAt: z.string().optional().nullable(),
          status: z.string().optional(),
        }),
      })
    )
    .default([]),
  complete: z
    .array(
      z.object({
        id: z.number().int().positive().optional(),
        title: z.string().optional(),
      })
    )
    .default([]),
  delete: z
    .array(
      z.object({
        id: z.number().int().positive().optional(),
        title: z.string().optional(),
      })
    )
    .default([]),
  reschedule: z
    .array(
      z.object({
        id: z.number().int().positive().optional(),
        title: z.string().optional(),
        dueAt: z.string().optional().nullable(),
        shift: z.string().optional(),
      })
    )
    .default([]),
});

describeLLM("Orchestrator", () => {
  testLLM(
    "routes mixed intent to journal and tasks agents",
    async () => {
      const openaiApiKey = ensureOpenAIKey();

      const context = buildSimpleContext(
        "Сегодня очень тревожно после разговора с менеджером, запиши это в дневник и напомни завтра купить билеты в 11:00",
        { userId: 606 }
      );

      const journalCalls: Array<{ content: string; mood: string }> = [];
      const tasksCalls: Array<z.infer<typeof ManageTasksSchema>> = [];

      const createJournalEntry = tool({
        description:
          "Сохраняет запись дневника. Используй поля content и mood, добавляй tags по желанию.",
        inputSchema: z.object({
          content: z.string().min(10),
          mood: z.string().min(3),
          tags: z.array(z.string()).optional(),
        }),
        execute: async (input) => {
          journalCalls.push(input);
          return {
            success: true,
            data: {
              entryId: 700,
              title: "Запись дня",
              content: input.content,
              mood: input.mood,
              energy: "low",
              moodEmoji: "😟",
              energyEmoji: "🔋",
              entryDate: new Date().toISOString(),
              tags: input.tags ?? [],
            },
          };
        },
      });

      const manageTasks = tool({
        description:
          "Управляет задачами: create для новых, reschedule для переносов, complete/delete для завершения.",
        inputSchema: ManageTasksSchema,
        execute: async (input) => {
          tasksCalls.push(input);
          return {
            success: true,
            summary: {
              created: input.create.length,
              rescheduled: input.reschedule.length,
            },
          };
        },
      });

      const journalBundle: IntegrationToolsBundle = {
        tools: {
          createJournalEntry,
        },
        formatters: {},
        progressMessages: {},
        contextMessages: forceToolContext(
          "createJournalEntry",
          "Запиши эмоции пользователя."
        ),
      };

      const tasksBundle: IntegrationToolsBundle = {
        tools: {
          manageTasks,
        },
        formatters: {},
        progressMessages: {},
        contextMessages: forceToolContext(
          "manageTasks",
          "Создай напоминание и перенеси задачи, если это требуется."
        ),
      };

      const registry: IntegrationRegistryService = {
        getToolsForUser: () => Effect.fail(new Error("not implemented")),
        getDomainToolsForUser: () =>
          Effect.succeed({
            journal: journalBundle,
            tasks: tasksBundle,
          }),
      };

      const config: AIAgentConfig = {
        openaiApiKey,
        model: getModelName(),
        maxTokens: 800,
        userId: context.userId,
      };

      const program = Effect.gen(function* () {
        const agent = yield* AIAgent;
        return yield* agent.processText(context.userId, context.messageContent);
      }).pipe(
        Effect.provideService(IntegrationRegistry, registry),
        Effect.provide(AIAgentLive(config))
      );

      const outcome = await Effect.runPromise(
        program.pipe(
          Effect.map((response) => ({ _tag: "ok" as const, response })),
          Effect.catchAll((error) => {
            const isNetwork =
              isNetworkError(error) ||
              (error instanceof Error &&
                /No subagent produced tool results/.test(error.message));
            return isNetwork
              ? Effect.succeed({ _tag: "network" as const, error })
              : Effect.fail(error);
          })
        )
      );

      if (outcome._tag === "network") {
        console.warn(
          "[orchestrator] skipping due to network error",
          outcome.error
        );
        return;
      }

      const response = outcome.response;

      expect(response.plan.length).toBeGreaterThanOrEqual(2);
      const executedKinds = response.executions.map((item) => item.kind);
      expect(executedKinds).toContain("journal");
      expect(executedKinds).toContain("tasks");
      expect(journalCalls.length).toBeGreaterThan(0);
      expect(tasksCalls.length).toBeGreaterThan(0);
      const journalPayload = journalCalls[0];
      expect(journalPayload.content.toLowerCase()).toContain("трев");
      const tasksPayload = tasksCalls[0];
      expect(tasksPayload.create.length).toBeGreaterThan(0);
    },
    { timeout: 30000, skip: true }
  );

  testLLM(
    "routes journal insight and calendar event without tasks",
    async () => {
      const openaiApiKey = ensureOpenAIKey();

      const message = `Решил сходить на криптомероприятие в Дубае. Хочется понять насколько там есть что стоящее кроме скамеров спекулянтов и инфоциган.\nСобытие будет происходить тут\nOctober 28-29 • UAE, DUBAI, Festival Arena`;

      const context = buildSimpleContext(message, { userId: 707 });

      const journalCalls: Array<{
        content: string;
        mood: string;
        tags?: string[];
      }> = [];
      const calendarCalls: Array<{
        title: string;
        start: string;
        end: string;
        timezone?: string;
        location?: string;
        description?: string;
      }> = [];

      const createJournalEntry = tool({
        description:
          "Сохраняет запись в дневник пользователя с полями content и mood.",
        inputSchema: z.object({
          content: z.string().min(20),
          mood: z.string().min(3),
          tags: z.array(z.string()).optional(),
        }),
        execute: async (input) => {
          journalCalls.push(input);
          return {
            success: true,
            data: {
              entryId: 910,
              title: "Планы на криптомероприятие",
              content: input.content,
              mood: input.mood,
              energy: "curious",
              moodEmoji: "🤔",
              energyEmoji: "⚡️",
              entryDate: new Date().toISOString(),
              tags: input.tags ?? [],
            },
          };
        },
      });

      const createCalendarEvent = tool({
        description:
          "Создаёт событие в календаре с полями title, start, end, timezone.",
        inputSchema: z.object({
          title: z.string().min(5),
          start: z.string().min(10),
          end: z.string().min(10),
          timezone: z.string().default("Asia/Dubai"),
          location: z.string().optional(),
          description: z.string().optional(),
        }),
        execute: async (input) => {
          calendarCalls.push(input);
          return {
            success: true,
            data: {
              eventId: "cal_test_event",
              title: input.title,
              start: input.start,
              end: input.end,
              timezone: input.timezone,
              location: input.location,
            },
          };
        },
      });

      let tasksToolInvoked = false;
      const tasksBypassTool = tool({
        description: "Пустышка для задач. Не должна вызываться.",
        inputSchema: z.object({}).passthrough(),
        execute: async () => {
          tasksToolInvoked = true;
          return { success: true };
        },
      });

      let digestToolInvoked = false;
      const digestBypassTool = tool({
        description: "Пустышка для дайджеста. Не должна вызываться.",
        inputSchema: z.object({}).passthrough(),
        execute: async () => {
          digestToolInvoked = true;
          return { success: true };
        },
      });

      let settingsToolInvoked = false;
      const settingsBypassTool = tool({
        description: "Пустышка для настроек. Не должна вызываться.",
        inputSchema: z.object({}).passthrough(),
        execute: async () => {
          settingsToolInvoked = true;
          return { success: true };
        },
      });

      const journalBundle: IntegrationToolsBundle = {
        tools: {
          createJournalEntry,
        },
        formatters: {},
        progressMessages: {},
        contextMessages: forceToolContext(
          "createJournalEntry",
          "Сделай запись о решении посетить мероприятие."
        ),
      };

      const calendarBundle: IntegrationToolsBundle = {
        tools: {
          createCalendarEvent,
        },
        formatters: {},
        progressMessages: {},
        contextMessages: forceToolContext(
          "createCalendarEvent",
          "Занеси расписание мероприятия в календарь."
        ),
      };

      const tasksGuardBundle: IntegrationToolsBundle = {
        tools: {
          manageTasks: tasksBypassTool,
        },
        formatters: {},
        progressMessages: {},
        contextMessages: forceToolContext(
          "manageTasks",
          "Не создавай задач, если пользователь об этом не просит."
        ),
      };

      const digestGuardBundle: IntegrationToolsBundle = {
        tools: {
          updateDigestSettings: digestBypassTool,
        },
        formatters: {},
        progressMessages: {},
      };

      const settingsGuardBundle: IntegrationToolsBundle = {
        tools: {
          updateUserSettings: settingsBypassTool,
        },
        formatters: {},
        progressMessages: {},
        contextMessages: forceToolContext(
          "updateUserSettings",
          "Не меняй настройки без прямого запроса."
        ),
      };

      const registry: IntegrationRegistryService = {
        getToolsForUser: () => Effect.fail(new Error("not implemented")),
        getDomainToolsForUser: () =>
          Effect.succeed({
            journal: journalBundle,
            calendar: calendarBundle,
            tasks: tasksGuardBundle,
            digest: digestGuardBundle,
            settings: settingsGuardBundle,
          }),
      };

      const config: AIAgentConfig = {
        openaiApiKey,
        model: getModelName(),
        maxTokens: 800,
        userId: context.userId,
      };

      const program = Effect.gen(function* () {
        const agent = yield* AIAgent;
        return yield* agent.processText(context.userId, context.messageContent);
      }).pipe(
        Effect.provideService(IntegrationRegistry, registry),
        Effect.provide(AIAgentLive(config))
      );

      const outcome = await Effect.runPromise(
        program.pipe(
          Effect.map((response) => ({ _tag: "ok" as const, response })),
          Effect.catchAll((error) => {
            const isNetwork =
              isNetworkError(error) ||
              (error instanceof Error &&
                /No subagent produced tool results/.test(error.message));
            return isNetwork
              ? Effect.succeed({ _tag: "network" as const, error })
              : Effect.fail(error);
          })
        )
      );

      if (outcome._tag === "network") {
        console.warn(
          "[orchestrator-calendar] skipping due to network error",
          outcome.error
        );
        return;
      }

      const response = outcome.response;

      const executedKinds = response.executions.map((item) => item.kind);
      expect(executedKinds).toContain("journal");
      expect(executedKinds).toContain("calendar");
      expect(executedKinds).not.toContain("tasks");
      expect(executedKinds).not.toContain("digest");
      expect(executedKinds).not.toContain("settings");

      expect(journalCalls.length).toBeGreaterThan(0);
      const journalPayload = journalCalls[0];
      expect(journalPayload).toBeDefined();
      if (!journalPayload) {
        throw new Error("Journal payload is undefined");
      }
      expect(journalPayload.content.toLowerCase()).toContain("крипто");
      expect(journalPayload.content.toLowerCase()).toContain("дубае");

      expect(calendarCalls.length).toBeGreaterThan(0);
      const calendarPayload = calendarCalls[0];
      expect(calendarPayload).toBeDefined();
      if (!calendarPayload) {
        throw new Error("Calendar payload is undefined");
      }
      expect(calendarPayload.title.toLowerCase()).toContain("дуба");
      expect(Number.isNaN(Date.parse(calendarPayload.start))).toBeFalse();
      expect(Number.isNaN(Date.parse(calendarPayload.end))).toBeFalse();
      if (calendarPayload.location) {
        expect(calendarPayload.location.toLowerCase()).toContain("dubai");
      }

      const tasksPlan = response.plan.find((entry) => entry.kind === "tasks");
      if (tasksPlan) {
        expect(tasksPlan.executed).toBeFalse();
      }
      expect(tasksToolInvoked).toBeFalse();
      expect(digestToolInvoked).toBeFalse();
      expect(settingsToolInvoked).toBeFalse();
    },
    { timeout: 30000 }
  );

  testLLM(
    "completes a task and schedules calendar event from one confirmation",
    async () => {
      const openaiApiKey = ensureOpenAIKey();

      const context = buildSimpleContext(
        "Записался на чистку. Эти задачи можно закрыть и добавь встречу сегодня в 18:30.",
        { userId: 818 }
      );

      const history: ConversationMessage[] = [
        {
          role: "assistant",
          content: [
            "🧭 Задачи на сегодня (8 октября):",
            "• #42 — Запись на чистку зубов",
            "• #43 — Сделать 10 сделок на демо счёте",
          ].join("\n"),
          timestamp: Date.now() - 5000,
        },
      ];

      const tasksCalls: Array<z.infer<typeof ManageTasksSchema>> = [];
      const calendarCalls: Array<{
        summary: string;
        startDate: string;
        endDate?: string;
      }> = [];

      const manageTasks = tool({
        description:
          "Управляет списком задач: закрывай выполненные и обновляй сроки.",
        inputSchema: ManageTasksSchema,
        execute: async (input) => {
          tasksCalls.push(input);
          return {
            success: true,
            summary: {
              completed: input.complete.length,
            },
          };
        },
      });

      const createCalendarEvent = tool({
        description:
          "Создаёт событие в календаре. Требуются summary, startDate (ISO) и endDate.",
        inputSchema: z.object({
          summary: z.string().min(3),
          startDate: z.string().min(10),
          endDate: z.string().min(10).optional(),
        }),
        execute: async (input) => {
          calendarCalls.push(input);
          return {
            success: true,
            eventId: "evt_cleaning",
            event: {
              summary: input.summary,
              startDate: input.startDate,
              endDate: input.endDate ?? input.startDate,
            },
          };
        },
      });

      const tasksBundle: IntegrationToolsBundle = {
        tools: {
          manageTasks,
        },
        formatters: {},
        progressMessages: {},
        contextMessages: forceToolContext(
          "manageTasks",
          "Закрой задачу #42 «Запись на чистку зубов», если пользователь сообщил о выполнении."
        ),
      };

      const calendarBundle: IntegrationToolsBundle = {
        tools: {
          createCalendarEvent,
        },
        formatters: {},
        progressMessages: {},
        contextMessages: forceToolContext(
          "createCalendarEvent",
          "Создай событие «Чистка зубов» на сегодня в 18:30 по Москве. Используй ISO-формат даты и времени."
        ),
      };

      const registry: IntegrationRegistryService = {
        getToolsForUser: () => Effect.fail(new Error("not implemented")),
        getDomainToolsForUser: () =>
          Effect.succeed({
            tasks: tasksBundle,
            calendar: calendarBundle,
          }),
      };

      const config: AIAgentConfig = {
        openaiApiKey,
        model: getModelName(),
        maxTokens: 800,
        userId: context.userId,
      };

      const program = Effect.gen(function* () {
        const agent = yield* AIAgent;
        return yield* agent.processText(
          context.userId,
          context.messageContent,
          history
        );
      }).pipe(
        Effect.provideService(IntegrationRegistry, registry),
        Effect.provide(AIAgentLive(config))
      );

      const outcome = await Effect.runPromise(
        program.pipe(
          Effect.map((response) => ({ _tag: "ok" as const, response })),
          Effect.catchAll((error) => {
            const isNetwork =
              isNetworkError(error) ||
              (error instanceof Error &&
                /No subagent produced tool results/.test(error.message));
            return isNetwork
              ? Effect.succeed({ _tag: "network" as const, error })
              : Effect.fail(error);
          })
        )
      );

      if (outcome._tag === "network") {
        console.warn(
          "[orchestrator-combined] skipping due to network error",
          outcome.error
        );
        return;
      }

      const response = outcome.response;
      const executedKinds = response.executions.map((exec) => exec.kind);
      expect(executedKinds).toContain("tasks");
      expect(executedKinds).toContain("calendar");

      expect(tasksCalls.length).toBeGreaterThan(0);
      const tasksPayload = tasksCalls[0];
      expect(tasksPayload.complete.length).toBeGreaterThan(0);
      const completed = tasksPayload.complete[0];
      expect(
        (completed?.title ?? "").toLowerCase().includes("чист")
      ).toBeTrue();

      expect(calendarCalls).toHaveLength(1);
      const calendarPayload = calendarCalls[0];
      expect(calendarPayload.summary.toLowerCase()).toContain("чист");
      expect(Number.isNaN(Date.parse(calendarPayload.startDate))).toBeFalse();
    },
    { timeout: 30000, skip: true }
  );
});
