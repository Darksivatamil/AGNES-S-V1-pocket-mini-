"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bone,
  Check,
  Coffee,
  Gamepad2,
  HandHeart,
  Heart,
  Loader2,
  Pencil,
  RefreshCw,
  Sparkles,
  Trophy,
} from "lucide-react";
import { AgnesFace } from "@/components/agnes-face";
import { EmptyState, PageHeader, SectionCard } from "@/components/ui";
import { callAgnes, errorMessage, newRequestId } from "@/lib/api";
import { achievementLabel } from "@/lib/constants";
import { clamp, relativeTime, titleCase } from "@/lib/format";
import type { Achievement, PetEvent, PetState } from "@/lib/types";

type Interaction = "feed" | "play" | "rest" | "pet";

const interactions: {
  id: Interaction;
  label: string;
  icon: typeof Bone;
  cooldown: number;
  effect: string;
}[] = [
  { id: "feed", label: "Feed", icon: Bone, cooldown: 300, effect: "+3 happy · −18 hunger · +5 XP" },
  { id: "play", label: "Play", icon: Gamepad2, cooldown: 180, effect: "+8 happy · −7 energy · +10 XP" },
  { id: "rest", label: "Rest", icon: Coffee, cooldown: 600, effect: "+15 energy · +2 happy · +4 XP" },
  { id: "pet", label: "Pet", icon: HandHeart, cooldown: 60, effect: "+5 happy · +3 XP" },
];

function moodFor(pet: PetState | null): string {
  if (!pet) return "normal";
  if (pet.energy < 25) return "sleepy";
  if (pet.hunger > 70) return "concerned";
  if (pet.happiness > 80) return "happy";
  if (pet.happiness < 30) return "sad";
  return "normal";
}

export function PetClient({
  initialPet,
  initialEvents,
  initialAchievements,
}: {
  initialPet: PetState | null;
  initialEvents: PetEvent[];
  initialAchievements: Achievement[];
}) {
  const [pet, setPet] = useState(initialPet);
  const [events, setEvents] = useState(initialEvents);
  const [achievements, setAchievements] = useState(initialAchievements);
  const [busy, setBusy] = useState<Interaction | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(initialPet?.name ?? "Agnes");
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const cooldowns = useMemo(() => {
    const result: Record<Interaction, number> = { feed: 0, play: 0, rest: 0, pet: 0 };
    for (const interaction of interactions) {
      const last = events.find((event) => event.event_type === interaction.id);
      if (!last) continue;
      const elapsed = Math.floor((now - Date.parse(last.created_at)) / 1000);
      result[interaction.id] = Math.max(0, interaction.cooldown - elapsed);
    }
    return result;
  }, [events, now]);

  const level = pet?.level ?? 1;
  const xp = pet?.friendship_xp ?? 0;
  const currentFloor = 40 * Math.pow(level - 1, 2);
  const nextFloor = 40 * Math.pow(level, 2);
  const xpProgress = clamp(Math.round(((xp - currentFloor) / Math.max(1, nextFloor - currentFloor)) * 100), 0, 100);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const result = await callAgnes<{
        pet_state: PetState;
        events: PetEvent[];
        achievements: Achievement[];
      }>("agnes-pet", { action: "list_events", limit: 30 });
      setPet(result.pet_state);
      setEvents(result.events);
      setAchievements(result.achievements);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setRefreshing(false);
    }
  }

  async function interact(interaction: Interaction) {
    if (cooldowns[interaction] > 0) return;
    setBusy(interaction);
    setError(null);
    setNotice(null);
    try {
      const result = await callAgnes<{
        pet_state: PetState;
        event: PetEvent | null;
        achievements: string[];
      }>("agnes-pet", {
        action: "interact",
        request_id: newRequestId(),
        interaction,
      });
      setPet(result.pet_state);
      if (result.event) {
        setEvents((current) => [result.event as PetEvent, ...current].slice(0, 30));
      }
      if (result.achievements.length > 0) {
        setAchievements((current) => [
          ...result.achievements.map((id) => ({ achievement_id: id, unlocked_at: new Date().toISOString() })),
          ...current,
        ]);
        setNotice(`Achievement unlocked: ${result.achievements.map(achievementLabel).join(", ")}`);
      } else {
        setNotice(`${titleCase(interaction)} recorded.`);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    if (!nameDraft.trim()) return;
    setSavingName(true);
    setError(null);
    try {
      const result = await callAgnes<{ pet_state: PetState }>("agnes-profile", {
        action: "update_pet_name",
        name: nameDraft.trim(),
      });
      setPet(result.pet_state);
      setRenaming(false);
      setNotice("Pet renamed.");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSavingName(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Virtual companion"
        title={pet?.name ?? "Your pet"}
        description="The pet reacts to care and to chat mood deltas. The server is authoritative; offline device actions sync later."
        action={
          <>
            <button type="button" className="btn" onClick={refresh} disabled={refreshing}>
              {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Refresh
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setRenaming(true);
                setNameDraft(pet?.name ?? "Agnes");
              }}
            >
              <Pencil size={13} /> Rename
            </button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
        <section className="card relative overflow-hidden p-5">
          <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-violet/[0.08] blur-2xl" />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <AgnesFace size={84} mood={moodFor(pet)} />
              <div>
                <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-mint/70">
                  {pet?.stage ?? "newborn"} stage
                </p>
                <h2 className="text-2xl font-bold text-white">{pet?.name ?? "Agnes"}</h2>
                <p className="text-xs text-muted">
                  Level {level} · {xp} friendship XP
                </p>
              </div>
            </div>
            {renaming ? (
              <form onSubmit={saveName} className="flex items-center gap-2">
                <input
                  className="input max-w-[160px]"
                  value={nameDraft}
                  maxLength={40}
                  onChange={(event) => setNameDraft(event.target.value)}
                  placeholder="Pet name"
                  autoFocus
                />
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={savingName || !nameDraft.trim()}
                >
                  {savingName ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                </button>
              </form>
            ) : null}
          </div>

          <div className="mt-6 space-y-3">
            {[
              { label: "Happiness", value: pet?.happiness ?? 0, color: "from-mint to-teal-400" },
              { label: "Energy", value: pet?.energy ?? 0, color: "from-violet to-indigo-400" },
              { label: "Hunger", value: pet?.hunger ?? 0, color: "from-amber to-orange-400" },
            ].map((stat) => (
              <div key={stat.label}>
                <div className="flex items-center justify-between text-[0.72rem]">
                  <span className="font-semibold text-[#c3d3e4]">{stat.label}</span>
                  <span className="text-white">{stat.value}/100</span>
                </div>
                <div className="bar mt-1.5">
                  <span
                    className={`bg-gradient-to-r ${stat.color}`}
                    style={{ width: `${stat.value}%` }}
                  />
                </div>
              </div>
            ))}
            <div>
              <div className="flex items-center justify-between text-[0.72rem]">
                <span className="font-semibold text-[#c3d3e4]">Next level</span>
                <span className="text-white">{xpProgress}%</span>
              </div>
              <div className="bar mt-1.5">
                <span style={{ width: `${xpProgress}%` }} />
              </div>
              <p className="mt-1 text-[0.62rem] text-[#587088]">
                Level {level} → {level + 1} needs {Math.max(0, nextFloor - xp)} more XP.
              </p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-2">
            {interactions.map((interaction) => {
              const Icon = interaction.icon;
              const remaining = cooldowns[interaction.id];
              const isBusy = busy === interaction.id;
              return (
                <button
                  key={interaction.id}
                  type="button"
                  className="btn justify-start"
                  onClick={() => interact(interaction.id)}
                  disabled={isBusy || remaining > 0 || busy !== null || !pet}
                  title={interaction.effect}
                >
                  {isBusy ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Icon size={14} className="text-mint" />
                  )}
                  <span className="text-left">
                    <span className="block">{interaction.label}</span>
                    <span className="block text-[0.58rem] font-normal text-[#6f879e]">
                      {remaining > 0 ? `ready in ${remaining}s` : interaction.effect}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {!pet ? (
            <p className="mt-3 rounded-lg border border-amber/25 bg-amber/[0.07] px-3 py-2 text-xs text-amber-100/80">
              Pet state has not been created yet. It is created on the first profile request or chat
              from the dashboard.
            </p>
          ) : null}
        </section>

        <div className="space-y-4">
          <SectionCard title="Achievements" description="Unlocked by real pet and chat activity.">
            {achievements.length === 0 ? (
              <p className="text-xs text-muted">No achievements yet. Keep interacting.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {achievements.map((achievement) => (
                  <span key={achievement.achievement_id} className="badge badge-amber">
                    <Trophy size={10} /> {achievementLabel(achievement.achievement_id)}
                  </span>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Recent pet activity"
            description="Includes web, device and system events."
            action={
              <button type="button" className="btn btn-sm" onClick={refresh} disabled={refreshing}>
                <RefreshCw size={11} />
              </button>
            }
          >
            {events.length === 0 ? (
              <p className="text-xs text-muted">No pet events yet.</p>
            ) : (
              <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {events.map((event) => (
                  <li
                    key={event.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-2 text-[0.7rem]"
                  >
                    <span className="flex items-center gap-1.5 text-[#c3d3e4]">
                      <Sparkles size={10} className="text-violet" />
                      {titleCase(event.event_type)}
                      <span className="text-[#587088]">· {event.source}</span>
                    </span>
                    <span className="flex items-center gap-2 text-[0.64rem] text-[#6f879e]">
                      {event.xp_delta ? <span className="text-mint">+{event.xp_delta} XP</span> : null}
                      {event.delta_happiness ? (
                        <span>
                          <Heart size={9} className="inline" /> {event.delta_happiness > 0 ? "+" : ""}
                          {event.delta_happiness}
                        </span>
                      ) : null}
                      <span>{relativeTime(event.created_at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {notice ? (
            <p className="rounded-xl border border-mint/25 bg-mint/[0.07] px-3 py-2 text-xs text-mint-100">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p className="rounded-xl border border-rose/30 bg-rose/10 px-3 py-2 text-xs text-rose-200">
              {error}
            </p>
          ) : null}

          <EmptyState
            title="How the pet stays honest"
            description="Care actions have server-side cooldowns. Chat mood deltas are clamped to ±3 per reply. Time-based decay is capped at 7 days, and the dashboard never fakes a level-up."
          />
        </div>
      </div>
    </div>
  );
}
