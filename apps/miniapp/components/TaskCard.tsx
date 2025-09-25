"use client";

import type { Task } from "@/types/api";

const TASK_STATUS_META: Record<
  string,
  { label: string; badgeClass: string; indicatorClass: string }
> = {
  todo: {
    label: "В работе",
    badgeClass:
      "bg-sky-500/15 text-sky-200 border border-sky-400/20 shadow-[0_0_18px_-6px_rgba(56,189,248,0.75)]",
    indicatorClass: "bg-sky-400",
  },
  done: {
    label: "Готово",
    badgeClass:
      "bg-emerald-500/15 text-emerald-200 border border-emerald-400/20 shadow-[0_0_18px_-6px_rgba(16,185,129,0.75)]",
    indicatorClass: "bg-emerald-400",
  },
  blocked: {
    label: "Заблокирована",
    badgeClass:
      "bg-rose-500/15 text-rose-200 border border-rose-400/20 shadow-[0_0_18px_-6px_rgba(244,63,94,0.75)]",
    indicatorClass: "bg-rose-400",
  },
  review: {
    label: "На проверке",
    badgeClass:
      "bg-amber-500/15 text-amber-200 border border-amber-400/20 shadow-[0_0_18px_-6px_rgba(245,158,11,0.75)]",
    indicatorClass: "bg-amber-400",
  },
};

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const formatTaskDueDate = (iso: string | null): string => {
  if (!iso) return "Без срока";
  try {
    const date = new Date(iso);
    return dateFormatter.format(date);
  } catch {
    return "Без срока";
  }
};

export const TaskCard = ({ task }: { task: Task }) => {
  const meta = TASK_STATUS_META[task.status] ?? {
    label: task.status,
    badgeClass:
      "bg-slate-500/15 text-slate-200 border border-slate-400/20 shadow-[0_0_18px_-6px_rgba(148,163,184,0.75)]",
    indicatorClass: "bg-slate-400",
  };

  const dueLabel = formatTaskDueDate(task.dueAt);
  const updatedLabel = formatTaskDueDate(task.updatedAt);

  return (
    <article className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-4 shadow-[0_10px_40px_-24px_rgba(15,118,110,0.6)] backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold leading-snug text-slate-50">
          {task.title}
        </h3>
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${meta.badgeClass}`}
        >
          {meta.label}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-400">
        <span className="inline-flex items-center gap-1">
          <span className={`inline-flex h-2 w-2 rounded-full ${meta.indicatorClass}`} />
          {dueLabel}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-slate-500" />
          Обновлено: {updatedLabel}
        </span>
      </div>
    </article>
  );
};

