"use client";

import { useMemo, useState } from "react";
import {
  Check,
  Loader2,
  NotebookPen,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { EmptyState, PageHeader, SectionCard } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Note } from "@/lib/types";

type Draft = {
  id: string | null;
  title: string;
  body: string;
  pinned: boolean;
  version: number;
};

const emptyDraft: Draft = { id: null, title: "", body: "", pinned: false, version: 0 };

export function NotesClient({ initialNotes, userId }: { initialNotes: Note[]; userId: string }) {
  const [notes, setNotes] = useState(initialNotes);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = term
      ? notes.filter(
          (note) =>
            note.title.toLowerCase().includes(term) || note.body.toLowerCase().includes(term),
        )
      : notes;
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return Date.parse(b.updated_at) - Date.parse(a.updated_at);
    });
  }, [notes, search]);

  function startNew() {
    setDraft(emptyDraft);
    setError(null);
    setNotice(null);
  }

  function editNote(note: Note) {
    setDraft({
      id: note.id,
      title: note.title,
      body: note.body,
      pinned: note.pinned,
      version: note.version,
    });
    setError(null);
    setNotice(null);
  }

  async function saveNote(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.title.trim() && !draft.body.trim()) {
      setError("A note needs a title or body.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const supabase = supabaseBrowser();
      if (draft.id === null) {
        const { data, error: insertError } = await supabase
          .from("agnes_notes")
          .insert({
            user_id: userId,
            title: draft.title.trim().slice(0, 160),
            body: draft.body.slice(0, 8000),
            pinned: draft.pinned,
          })
          .select("id, title, body, pinned, version, created_at, updated_at")
          .single();
        if (insertError) throw new Error(insertError.message);
        const created = data as Note;
        setNotes((current) => [created, ...current]);
        setDraft({
          id: created.id,
          title: created.title,
          body: created.body,
          pinned: created.pinned,
          version: created.version,
        });
        setNotice("Note created. It appears on the device after its next sync.");
      } else {
        const { data, error: updateError } = await supabase
          .from("agnes_notes")
          .update({
            title: draft.title.trim().slice(0, 160),
            body: draft.body.slice(0, 8000),
            pinned: draft.pinned,
            version: draft.version + 1,
          })
          .eq("id", draft.id)
          .eq("version", draft.version)
          .is("deleted_at", null)
          .select("id, title, body, pinned, version, created_at, updated_at")
          .maybeSingle();
        if (updateError) throw new Error(updateError.message);
        if (!data) {
          throw new Error("This note changed elsewhere (probably the device). Reload and try again.");
        }
        const updated = data as Note;
        setNotes((current) => current.map((note) => (note.id === updated.id ? updated : note)));
        setDraft((current) => ({ ...current, version: updated.version }));
        setNotice("Note saved. The device receives the new version on its next sync.");
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function togglePinned(note: Note) {
    setBusyId(note.id);
    setError(null);
    try {
      const { data, error: updateError } = await supabaseBrowser()
        .from("agnes_notes")
        .update({ pinned: !note.pinned, version: note.version + 1 })
        .eq("id", note.id)
        .eq("version", note.version)
        .is("deleted_at", null)
        .select("id, title, body, pinned, version, created_at, updated_at")
        .maybeSingle();
      if (updateError) throw new Error(updateError.message);
      if (!data) throw new Error("Note changed elsewhere. Reload before changing it.");
      const updated = data as Note;
      setNotes((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      if (draft.id === updated.id) {
        setDraft((current) => ({ ...current, pinned: updated.pinned, version: updated.version }));
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function deleteNote(note: Note) {
    if (!window.confirm(`Delete “${note.title || "Untitled note"}”? This also removes it from the device.`)) {
      return;
    }
    setBusyId(note.id);
    setError(null);
    try {
      const { error: deleteError } = await supabaseBrowser()
        .from("agnes_notes")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", note.id);
      if (deleteError) throw new Error(deleteError.message);
      setNotes((current) => current.filter((item) => item.id !== note.id));
      if (draft.id === note.id) setDraft(emptyDraft);
      setNotice("Note deleted.");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Knowledge"
        title="Notes"
        description="Notes are authored here and shown read-only on the device. The device receives up to 20 notes per sync."
        action={
          <button type="button" className="btn btn-primary" onClick={startNew}>
            <Plus size={14} /> New note
          </button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-3">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#587088]"
            />
            <input
              className="input pl-9"
              value={search}
              placeholder="Search notes…"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title={notes.length === 0 ? "No notes yet" : "No matches"}
              description={
                notes.length === 0
                  ? "Write a note on the right. It will be available on the device after the next sync."
                  : "Try a different search term."
              }
              action={
                notes.length === 0 ? (
                  <button type="button" className="btn btn-sm" onClick={startNew}>
                    <Plus size={12} /> New note
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-2">
              {filtered.map((note) => (
                <article
                  key={note.id}
                  className={`card cursor-pointer p-4 transition hover:border-white/20 ${
                    draft.id === note.id ? "border-mint/35" : ""
                  }`}
                  onClick={() => editNote(note)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-bold text-white">
                        {note.title || "Untitled note"}
                      </h2>
                      <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-muted">
                        {note.body || "No body"}
                      </p>
                    </div>
                    {note.pinned ? <Pin size={13} className="mt-0.5 shrink-0 text-amber" /> : null}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[0.62rem] text-[#587088]">
                    <span>updated {relativeTime(note.updated_at)}</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="btn btn-sm border-transparent bg-transparent px-1.5"
                        onClick={(event) => {
                          event.stopPropagation();
                          void togglePinned(note);
                        }}
                        disabled={busyId === note.id}
                        aria-label={note.pinned ? "Unpin note" : "Pin note"}
                      >
                        {busyId === note.id ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : note.pinned ? (
                          <PinOff size={11} />
                        ) : (
                          <Pin size={11} />
                        )}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm border-transparent bg-transparent px-1.5 text-rose-300"
                        onClick={(event) => {
                          event.stopPropagation();
                          void deleteNote(note);
                        }}
                        disabled={busyId === note.id}
                        aria-label="Delete note"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <SectionCard
            title={draft.id ? "Edit note" : "New note"}
            description="Saving bumps the version; the device syncs it later."
          >
            <form onSubmit={saveNote} className="space-y-3">
              <div>
                <label className="label" htmlFor="note-title">
                  Title
                </label>
                <input
                  id="note-title"
                  className="input"
                  maxLength={160}
                  value={draft.title}
                  placeholder="Optional title"
                  onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                />
              </div>
              <div>
                <label className="label" htmlFor="note-body">
                  Body
                </label>
                <textarea
                  id="note-body"
                  className="textarea min-h-[220px]"
                  maxLength={8000}
                  value={draft.body}
                  placeholder="Write something worth keeping…"
                  onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
                />
                <p className="mt-1 text-right text-[0.62rem] text-[#587088]">
                  {draft.body.length}/8000
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs text-[#c3d3e4]">
                <input
                  type="checkbox"
                  checked={draft.pinned}
                  onChange={(event) => setDraft((current) => ({ ...current, pinned: event.target.checked }))}
                  className="accent-teal-300"
                />
                Pin to the top
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving || (!draft.title.trim() && !draft.body.trim())}
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {draft.id ? "Save changes" : "Create note"}
                </button>
                {draft.id ? (
                  <button type="button" className="btn" onClick={startNew} disabled={saving}>
                    New note
                  </button>
                ) : null}
              </div>
            </form>
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

          <SectionCard title="Device limits" description="Deliberately small, because the OLED is 128×64.">
            <ul className="space-y-1.5 text-[0.72rem] leading-5 text-muted">
              <li>• Device sync returns at most 20 notes.</li>
              <li>• Device view truncates titles to 48 characters and bodies to 400.</li>
              <li>• Notes are read-only on the device; editing happens in this dashboard.</li>
              <li>• Soft-deleted notes disappear from both surfaces.</li>
            </ul>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
