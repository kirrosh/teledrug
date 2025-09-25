"use client";

import type { JournalEntry } from "@/types/api";

const MOOD_LABELS: Record<string, { label: string; className: string }> = {
  very_positive: {
    label: "Отличное настроение",
    className: "bg-emerald-500/15 text-emerald-200 border border-emerald-400/30",
  },
  positive: {
    label: "Хорошее настроение",
    className: "bg-sky-500/15 text-sky-200 border border-sky-400/30",
  },
  neutral: {
    label: "Нейтрально",
    className: "bg-slate-500/15 text-slate-200 border border-slate-400/30",
  },
  negative: {
    label: "Негативное настроение",
    className: "bg-amber-500/15 text-amber-200 border border-amber-400/30",
  },
  very_negative: {
    label: "Очень тяжело",
    className: "bg-rose-500/15 text-rose-200 border border-rose-400/30",
  },
  mixed: {
    label: "Смешанные чувства",
    className: "bg-purple-500/15 text-purple-200 border border-purple-400/30",
  },
};

const ENERGY_LABELS: Record<string, { label: string; className: string }> = {
  very_high: {
    label: "Очень высокая энергия",
    className: "bg-emerald-500/10 text-emerald-200 border border-emerald-400/20",
  },
  high: {
    label: "Высокая энергия",
    className: "bg-sky-500/10 text-sky-200 border border-sky-400/20",
  },
  medium: {
    label: "Средняя энергия",
    className: "bg-slate-500/10 text-slate-200 border border-slate-400/20",
  },
  low: {
    label: "Низкая энергия",
    className: "bg-amber-500/10 text-amber-200 border border-amber-400/20",
  },
  very_low: {
    label: "Очень низкая энергия",
    className: "bg-rose-500/10 text-rose-200 border border-rose-400/20",
  },
};

const dayFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
});

const timeFormatter = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
});

const formatEntryDate = (iso: string): string => {
  try {
    const date = new Date(iso);
    return `${dayFormatter.format(date)} · ${timeFormatter.format(date)}`;
  } catch {
    return iso;
  }
};

export const JournalEntryCard = ({ entry }: { entry: JournalEntry }) => {
  const mood = MOOD_LABELS[entry.mood] ?? {
    label: entry.mood,
    className: "bg-slate-500/10 text-slate-200 border border-slate-400/20",
  };
  const energy = ENERGY_LABELS[entry.energy] ?? {
    label: entry.energy,
    className: "bg-slate-500/10 text-slate-200 border border-slate-400/20",
  };

  const entryDateLabel = formatEntryDate(entry.entryDate || entry.createdAt);

  return (
    <article className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-4 shadow-[0_10px_40px_-24px_rgba(59,130,246,0.6)] backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold leading-snug text-slate-50">
            {entry.title}
          </h3>
          <span className="text-xs text-slate-400">{entryDateLabel}</span>
        </div>
        <div className="flex flex-col items-end gap-2 text-xs">
          <span className={`inline-flex items-center rounded-full px-3 py-1 font-medium ${mood.className}`}>
            {mood.label}
          </span>
          <span className={`inline-flex items-center rounded-full px-3 py-1 font-medium ${energy.className}`}>
            {energy.label}
          </span>
        </div>
      </div>
      <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-200">
        {entry.content}
      </p>
      {entry.tags && entry.tags.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {entry.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full border border-slate-700/60 bg-slate-800/60 px-3 py-1 text-xs font-medium text-slate-200"
            >
              #{tag}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
};

