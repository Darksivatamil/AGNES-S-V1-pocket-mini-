"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Brain,
  Check,
  Loader2,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { EmptyState, PageHeader, SectionCard } from "@/components/ui";
import { callAgnes, errorMessage, newRequestId } from "@/lib/api";
import { memoryCategories } from "@/lib/constants";
import { relativeTime, titleCase } from "@/lib/format";
import type { Memory, MemoryCategory, MemoryStatus } from "@/lib/types";

const statusBadge: Record<MemoryStatus, string> = {
  pending: "badge-amber",
  approved: "badge-mint",
  rejected: "badge-rose",
};

const sourceLabel: Record<Memory["source"], string> = {
  user: "written by you",
  ai_suggested: "suggested by AI",
  device: "from device",
};

export function MemoriesClient({
  initialMemories,
  initialCloudMemoryEnabled,
}: {
  initialMemories: Memory[];
  initialCloudMemoryEnabled: boolean;
}) {
  const [memories, setMemories] = useState(initialMemories);
  const [cloudMemoryEnabled, setCloudMemoryEnabled] = useState(initialCloudMemoryEnabled);
  const [statusFilter, setStatusFilter] = useState<"" | MemoryStatus>("");
  const [categoryFilter, setCategoryFilter] = useState<"" | MemoryCategory>("");
  const [query, setQuery] = useState("");

  const [creating, setCreating] = useState(false);
  const [createCategory, setCreateCategory] = useState<MemoryCategory>("preference");
  const [createContent, setCreateContent] = useState("");
  const [createPinned, setCreatePinned] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editCategory, setEditCategory] = useState<MemoryCategory>("preference");

  const refresh = useCallback(
    async (options?: { status?: string; category?: string; query?: string }) => {
      const nextStatus = options?.status ?? statusFilter;
      const nextCategory = options?.category ?? categoryFilter;
      const nextQuery = options?.query ?? query;
      setError(null);
      try {
        const result = await callAgnes<{ memories: Memory[]; cloud_memory_enabled: boolean }>(
          "agnes-memory",
          {
            action: "list",
            limit: 100,
            offset: 0,
            ...(nextStatus ? { status: nextStatus } : {}),
            ...(nextCategory ? { category: nextCategory } : {}),
            ...(nextQuery.trim() ? { query: nextQuery.trim() } : {}),
          },
        );
        setMemories(result.memories);
        setCloudMemoryEnabled(result.cloud_memory_enabled);
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [statusFilter, categoryFilter, query],
  );

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function createMemory(event: React.FormEvent) {
    event.preventDefault();
    if (!createContent.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await callAgnes("agnes-memory", {
        action: "create",
        request_id: newRequestId(),
        category: createCategory,
        content: createContent.trim(),
        pinned: createPinned,
      });
      setCreateContent("");
      setCreatePinned(false);
      setNotice("Memory saved and approved. It is now available to the companion.");
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setCreating(false);
    }
  }

  async function updateMemory(memory: Memory, changes: Record<string, unknown>) {
    setBusyId(memory.id);
    setError(null);
    try {
      await callAgnes("agnes-memory", {
        action: "update",
        id: memory.id,
        ...changes,
      });
      setEditingId(null);
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function deleteMemory(memory: Memory) {
    if (!window.confirm("Delete this memory? The device will stop receiving it on the next sync.")) {
      return;
    }
    setBusyId(memory.id);
    setError(null);
    try {
      await callAgnes("agnes-memory", { action: "delete", id: memory.id });
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      setNotice("Memory deleted.");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  }

  function beginEdit(memory: Memory) {
    setEditingId(memory.id);
    setEditContent(memory.content);
    setEditCategory(memory.category);
  }

  async function applyFilters(next: {
    status?: string;
    category?: string;
    query?: string;
  }) {
    setLoading(true);
    await refresh(next);
    setLoading(false);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Dual memory"
        title="Memories"
        description="The companion only remembers what you approve. AI-suggested memories stay pending until you accept them."
        action={
          <button
            type="button"
            className="btn"
            onClick={() => applyFilters({})}
            disabled={loading}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </button>
        }
      />

      {!cloudMemoryEnabled ? (
        <div className="mb-4 rounded-xl border border-rose/25 bg-rose/[0.08] px-4 py-3 text-xs leading-5 text-rose-200">
          Cloud memory is disabled, so new memories cannot be written. Viewing and deleting still
          work. <Link href="/settings" className="font-semibold underline">Enable it in settings</Link>.
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <SectionCard title="Filter" description="Filters are applied by the server.">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="memory-search">
                  Search
                </label>
                <div className="relative">
                  <Search
                    size={13}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#587088]"
                  />
                  <input
                    id="memory-search"
                    className="input pl-8"
                    value={query}
                    maxLength={120}
                    placeholder="Content contains…"
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void applyFilters({});
                      }
                    }}
                  />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="memory-status">
                  Status
                </label>
                <select
                  id="memory-status"
                  className="select"
                  value={statusFilter}
                  onChange={(event) => {
                    const value = event.target.value as "" | MemoryStatus;
                    setStatusFilter(value);
                    void applyFilters({ status: value });
                  }}
                >
                  <option value="">All statuses</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="memory-category">
                  Category
                </label>
                <select
                  id="memory-category"
                  className="select"
                  value={categoryFilter}
                  onChange={(event) => {
                    const value = event.target.value as "" | MemoryCategory;
                    setCategoryFilter(value);
                    void applyFilters({ category: value });
                  }}
                >
                  <option value="">All categories</option>
                  {memoryCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-sm mt-3"
              onClick={() => applyFilters({})}
              disabled={loading}
            >
              Apply filters
            </button>
          </SectionCard>

          {memories.length === 0 ? (
            <EmptyState
              title="No memories match"
              description="Chat with AGNES or write a memory manually. Pending AI suggestions appear here for approval."
            />
          ) : (
            <div className="space-y-2.5">
              {memories.map((memory) => (
                <article key={memory.id} className="card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="badge badge-violet">{titleCase(memory.category)}</span>
                      <span className={`badge ${statusBadge[memory.status]}`}>{memory.status}</span>
                      {memory.pinned ? (
                        <span className="badge badge-amber">
                          <Pin size={9} /> pinned
                        </span>
                      ) : null}
                      <span className="text-[0.62rem] text-[#587088]">{sourceLabel[memory.source]}</span>
                    </div>
                    <span className="text-[0.62rem] text-[#587088]">
                      updated {relativeTime(memory.updated_at)}
                    </span>
                  </div>

                  {editingId === memory.id ? (
                    <div className="mt-3 space-y-2">
                      <textarea
                        className="textarea"
                        value={editContent}
                        maxLength={1000}
                        onChange={(event) => setEditContent(event.target.value)}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          className="select max-w-[220px]"
                          value={editCategory}
                          onChange={(event) => setEditCategory(event.target.value as MemoryCategory)}
                        >
                          {memoryCategories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() =>
                            updateMemory(memory, {
                              content: editContent.trim(),
                              category: editCategory,
                            })
                          }
                          disabled={busyId === memory.id || !editContent.trim()}
                        >
                          {busyId === memory.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Check size={12} />
                          )}
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => setEditingId(null)}
                          disabled={busyId === memory.id}
                        >
                          <X size={12} /> Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm leading-6 text-[#dbe8f3]">{memory.content}</p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {memory.status === "pending" ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => updateMemory(memory, { status: "approved" })}
                          disabled={busyId === memory.id}
                        >
                          <Check size={12} /> Approve
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => updateMemory(memory, { status: "rejected" })}
                          disabled={busyId === memory.id}
                        >
                          <X size={12} /> Reject
                        </button>
                      </>
                    ) : null}
                    {memory.status !== "pending" ? (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => updateMemory(memory, { status: "pending" })}
                        disabled={busyId === memory.id}
                      >
                        Mark pending
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => updateMemory(memory, { pinned: !memory.pinned })}
                      disabled={busyId === memory.id}
                    >
                      {memory.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                      {memory.pinned ? "Unpin" : "Pin"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => beginEdit(memory)}
                      disabled={busyId === memory.id || !cloudMemoryEnabled}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => deleteMemory(memory)}
                      disabled={busyId === memory.id}
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <SectionCard title="Add a memory" description="Manual memories are approved immediately.">
            <form onSubmit={createMemory} className="space-y-3">
              <div>
                <label className="label" htmlFor="new-memory-category">
                  Category
                </label>
                <select
                  id="new-memory-category"
                  className="select"
                  value={createCategory}
                  onChange={(event) => setCreateCategory(event.target.value as MemoryCategory)}
                >
                  {memoryCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="new-memory-content">
                  Content
                </label>
                <textarea
                  id="new-memory-content"
                  className="textarea"
                  value={createContent}
                  maxLength={1000}
                  placeholder="e.g. I prefer concise answers in the morning."
                  onChange={(event) => setCreateContent(event.target.value)}
                  disabled={!cloudMemoryEnabled}
                />
                <p className="mt-1 text-right text-[0.62rem] text-[#587088]">
                  {createContent.length}/1000
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs text-[#c3d3e4]">
                <input
                  type="checkbox"
                  checked={createPinned}
                  onChange={(event) => setCreatePinned(event.target.checked)}
                  className="accent-teal-300"
                />
                Pin this memory
              </label>
              <button
                type="submit"
                className="btn btn-primary w-full"
                disabled={creating || !createContent.trim() || !cloudMemoryEnabled}
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Save memory
              </button>
            </form>
          </SectionCard>

          <SectionCard title="How memory works" description="Two layers, one approval gate.">
            <ul className="space-y-2 text-[0.72rem] leading-5 text-muted">
              <li>
                <span className="font-semibold text-white">Local:</span> the device keeps a small
                cache of recent memories for offline display.
              </li>
              <li>
                <span className="font-semibold text-white">Cloud:</span> approved memories are
                retrieved during chat to personalise replies.
              </li>
              <li>
                <span className="font-semibold text-white">Approval:</span> AI suggestions are created
                as pending and never used until approved here.
              </li>
              <li>
                <span className="font-semibold text-white">Deletion:</span> removing a memory hides it
                from both layers; the dashboard list is capped at 100 rows.
              </li>
            </ul>
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
        </div>
      </div>
    </div>
  );
}
