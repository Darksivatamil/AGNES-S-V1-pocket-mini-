"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  Bell,
  Boxes,
  Brain,
  Cpu,
  Heart,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  NotebookPen,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { AgnesFace } from "@/components/agnes-face";
import { supabaseBrowser } from "@/lib/supabase/client";

const navGroups = [
  {
    label: "Companion",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard },
      { href: "/chat", label: "Conversation", icon: MessageSquare },
      { href: "/devices", label: "Devices", icon: Cpu },
      { href: "/pet", label: "Pet", icon: Heart },
    ],
  },
  {
    label: "Memory",
    items: [
      { href: "/memories", label: "Memories", icon: Brain },
      { href: "/notes", label: "Notes", icon: NotebookPen },
      { href: "/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/providers", label: "Providers", icon: Sparkles },
      { href: "/models", label: "Model center", icon: Boxes },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/settings", label: "Settings", icon: SlidersHorizontal },
      { href: "/diagnostics", label: "Diagnostics", icon: Activity },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-5">
      {navGroups.map((group) => (
        <div key={group.label}>
          <p className="mb-1.5 px-2 text-[0.62rem] font-bold uppercase tracking-[0.16em] text-[#587088]">
            {group.label}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={`nav-link ${isActive(pathname, item.href) ? "nav-link-active" : ""}`}
                >
                  <Icon size={16} strokeWidth={1.9} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await supabaseBrowser().auth.signOut();
      router.replace("/login");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[256px_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-white/[0.07] bg-[#050a12]/80 px-4 py-5 backdrop-blur lg:flex">
        <Link href="/" className="mb-8 flex items-center gap-3 px-1">
          <AgnesFace size={38} />
          <div>
            <p className="text-[0.95rem] font-bold tracking-[0.18em] text-white">AGNES</p>
            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-mint/70">
              OS 2.0
            </p>
          </div>
        </Link>

        <div className="flex-1 overflow-y-auto pr-1">
          <NavContent pathname={pathname} />
        </div>

        <div className="mt-5 border-t border-white/[0.07] pt-4">
          <p className="truncate px-2 text-xs text-muted" title={email}>
            {email}
          </p>
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="btn btn-sm mt-2 w-full justify-start border-transparent bg-transparent text-muted hover:text-white"
          >
            <LogOut size={14} /> {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/[0.07] bg-[#050a12]/85 px-4 py-3 backdrop-blur lg:hidden">
          <Link href="/" className="flex items-center gap-2.5">
            <AgnesFace size={30} />
            <span className="text-sm font-bold tracking-[0.18em]">AGNES</span>
          </Link>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={16} />
          </button>
        </header>

        {mobileOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-black/70"
              aria-label="Close navigation"
              onClick={() => setMobileOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-white/10 bg-[#070d17] px-4 py-5">
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <AgnesFace size={32} />
                  <span className="text-sm font-bold tracking-[0.18em]">AGNES</span>
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close navigation"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <NavContent pathname={pathname} onNavigate={() => setMobileOpen(false)} />
              </div>
              <button type="button" onClick={signOut} className="btn btn-sm mt-4 justify-start">
                <LogOut size={14} /> Sign out
              </button>
            </div>
          </div>
        ) : null}

        <main className="page-enter mx-auto w-full max-w-[1180px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>

        <footer className="mx-auto w-full max-w-[1180px] px-4 pb-6 text-[0.68rem] text-[#587088] sm:px-6 lg:px-8">
          AGNES OS 2.0 · Pocket companion dashboard · Cloud AI requires an internet connection.
        </footer>
      </div>
    </div>
  );
}
