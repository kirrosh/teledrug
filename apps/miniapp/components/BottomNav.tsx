"use client";

import { usePathname } from "next/navigation";
import { useTransitionRouter } from "next-view-transitions";

const NAV_ITEMS = [
  { href: "/tasks", label: "Задачи", icon: "🗂" },
];

export const BottomNav = () => {
  const router = useTransitionRouter();
  const pathname = usePathname();

  const handleNavigate = (href: string) => {
    if (pathname === href) return;
    router.push(href);
  };

  return (
    <nav className="pointer-events-none sticky bottom-5 z-50 flex justify-center">
      <div className="pointer-events-auto flex w-full max-w-2xl items-center justify-between gap-2 rounded-3xl border border-slate-800/60 bg-slate-900/90 px-3 py-2 shadow-[0_20px_60px_-35px_rgba(148,163,184,0.65)] backdrop-blur">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <button
              key={item.href}
              type="button"
              onClick={() => handleNavigate(item.href)}
              className={`flex flex-1 flex-col items-center gap-1 rounded-2xl px-3 py-2 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 ${
                isActive
                  ? "bg-sky-500/15 text-white shadow-[0_10px_40px_-24px_rgba(56,189,248,0.75)]"
                  : "text-slate-400 hover:text-slate-100"
              }`}
              aria-current={isActive ? "page" : undefined}
              data-active={isActive ? "true" : "false"}
            >
              <span className="text-lg" aria-hidden>
                {item.icon}
              </span>
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

