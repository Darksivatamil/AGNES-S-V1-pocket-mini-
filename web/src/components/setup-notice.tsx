import { AgnesFace } from "@/components/agnes-face";

export function SetupNotice() {
  return (
    <div className="card w-full p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <AgnesFace size={44} />
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-mint/80">AGNES OS 2.0</p>
          <h1 className="text-xl font-bold text-white">Dashboard not configured yet</h1>
        </div>
      </div>

      <p className="mt-5 text-sm leading-6 text-muted">
        This dashboard talks directly to your own Supabase project. It refuses to pretend it is
        connected, so the UI stays offline until these values exist.
      </p>

      <div className="mt-5 rounded-xl border border-white/10 bg-black/30 p-4">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8fa6bd]">
          Create web/.env.local
        </p>
        <pre className="mono mt-2 overflow-x-auto text-[0.78rem] leading-6 text-[#b8f5ea]">
{`NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-or-publishable-key>`}
        </pre>
      </div>

      <ol className="mt-5 space-y-2 text-sm text-muted">
        <li>
          <span className="font-semibold text-white">1.</span> Create a Supabase project and apply
          the migrations in <code className="mono text-mint">supabase/migrations</code>.
        </li>
        <li>
          <span className="font-semibold text-white">2.</span> Deploy the Edge Functions in{" "}
          <code className="mono text-mint">supabase/functions</code>.
        </li>
        <li>
          <span className="font-semibold text-white">3.</span> Copy{" "}
          <code className="mono text-mint">web/.env.example</code> to{" "}
          <code className="mono text-mint">web/.env.local</code> and restart the dev server.
        </li>
      </ol>

      <p className="mt-5 text-xs text-[#587088]">
        The anon/publishable key is safe in the browser because every table is protected by
        row-level security. Never put a service-role key or AI provider key here.
      </p>
    </div>
  );
}
