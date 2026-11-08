"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Mail, Sparkles } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<"password" | "magic" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setBusy("password");
    try {
      const supabase = supabaseBrowser();
      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${window.location.origin}/` },
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setNotice("Account created. Check your email for the confirmation link, then sign in.");
          setMode("signin");
          return;
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;
      }
      router.replace("/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Authentication failed.");
    } finally {
      setBusy(null);
    }
  }

  async function sendMagicLink() {
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError("Enter your email address first.");
      return;
    }
    setBusy("magic");
    try {
      const { error: otpError } = await supabaseBrowser().auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/` },
      });
      if (otpError) throw otpError;
      setNotice("Magic link sent. Open it on this device to sign in.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the magic link.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-white">
        {mode === "signin" ? "Welcome back" : "Create your account"}
      </h1>
      <p className="mt-1.5 text-sm text-muted">
        {mode === "signin"
          ? "Sign in to reach your companion, devices and memories."
          : "One account owns the devices, memories and provider keys."}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-black/25 p-1">
        <button
          type="button"
          className={`btn btn-sm border-transparent ${mode === "signin" ? "bg-white/10 text-white" : "bg-transparent text-muted"}`}
          onClick={() => switchMode("signin")}
        >
          Sign in
        </button>
        <button
          type="button"
          className={`btn btn-sm border-transparent ${mode === "signup" ? "bg-white/10 text-white" : "bg-transparent text-muted"}`}
          onClick={() => switchMode("signup")}
        >
          Create account
        </button>
      </div>

      <form onSubmit={submitPassword} className="mt-5 space-y-4">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <div className="relative">
            <Mail
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#587088]"
            />
            <input
              id="email"
              className="input pl-9"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              className="input pr-10"
              type={showPassword ? "text" : "password"}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              required
              minLength={8}
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[#587088] hover:text-white"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        {error ? (
          <p className="rounded-lg border border-rose/30 bg-rose/10 px-3 py-2 text-xs text-rose-200">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="rounded-lg border border-mint/30 bg-mint/10 px-3 py-2 text-xs text-mint-100">
            {notice}
          </p>
        ) : null}

        <button type="submit" className="btn btn-primary w-full" disabled={busy !== null}>
          {busy === "password" ? <Loader2 size={15} className="animate-spin" /> : null}
          {mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>

      <div className="my-5 flex items-center gap-3 text-[0.68rem] uppercase tracking-[0.14em] text-[#587088]">
        <span className="h-px flex-1 bg-white/10" />
        or
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <button
        type="button"
        className="btn w-full"
        onClick={sendMagicLink}
        disabled={busy !== null}
      >
        {busy === "magic" ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
        Email me a magic link
      </button>

      <p className="mt-5 text-center text-[0.68rem] leading-5 text-[#587088]">
        Authentication is handled by your Supabase project. AGNES never receives your password.
      </p>
    </div>
  );
}
