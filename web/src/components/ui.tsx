import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        {eyebrow ? (
          <p className="mb-1 text-[0.65rem] font-bold uppercase tracking-[0.2em] text-mint/70">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl font-bold tracking-[-0.01em] text-white sm:text-[1.7rem]">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">{description}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="card-tight px-5 py-10 text-center">
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-muted">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  accent = "mint",
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "mint" | "violet" | "amber" | "rose";
}) {
  const bars: Record<string, string> = {
    mint: "from-mint/70 to-mint/10",
    violet: "from-violet/70 to-violet/10",
    amber: "from-amber/70 to-amber/10",
    rose: "from-rose/70 to-rose/10",
  };
  return (
    <div className="card relative overflow-hidden p-4">
      <span className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${bars[accent]}`} />
      <p className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-[#7f97b0]">{label}</p>
      <p className="mt-2 text-2xl font-bold tracking-tight text-white">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[#6f879e]">{hint}</p> : null}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card p-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-white">{title}</h2>
          {description ? <p className="mt-0.5 text-xs leading-5 text-muted">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function HonestyNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-amber/20 bg-amber/[0.06] px-3.5 py-2.5 text-xs leading-5 text-amber-100/80">
      {children}
    </p>
  );
}

export function InlineLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-semibold text-mint underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}
