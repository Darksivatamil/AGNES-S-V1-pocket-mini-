"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  Cpu,
  Globe2,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import { AgnesFace } from "@/components/agnes-face";
import { PageHeader } from "@/components/ui";
import { callAgnes, errorMessage, newRequestId } from "@/lib/api";
import { emotionEmoji } from "@/lib/constants";
import { relativeTime } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import type {
  ChatResult,
  Conversation,
  Message,
  PendingQuestion,
} from "@/lib/types";

type DeviceRef = { id: string; name: string };

function mergeMessages(previous: Message[], next: Message[]): Message[] {
  if (previous.length === next.length && previous.at(-1)?.id === next.at(-1)?.id) return previous;
  return next;
}

export function ChatClient({
  initialConversations,
  initialActiveId,
  initialMessages,
  initialPending,
  devices,
  signedInEmail,
}: {
  initialConversations: Conversation[];
  initialActiveId: string | null;
  initialMessages: Message[];
  initialPending: PendingQuestion | null;
  devices: DeviceRef[];
  signedInEmail: string;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState<string | null>(initialActiveId);
  const [messages, setMessages] = useState(initialMessages);
  const [pending, setPending] = useState<PendingQuestion | null>(initialPending);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [lastSync, setLastSync] = useState(() => Date.now());

  const sendingRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const activeConversation = conversations.find((conversation) => conversation.id === activeId) ?? null;
  const deviceNames = new Map(devices.map((device) => [device.id, device.name]));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length, sending, pending]);

  const loadThread = useCallback(async (conversationId: string) => {
    const supabase = supabaseBrowser();
    const [messagesResult, pendingResult] = await Promise.all([
      supabase
        .from("agnes_messages")
        .select(
          "id, conversation_id, role, content, input_source, provider, model, emotion, animation, intensity, selected_option_id, metadata, created_at",
        )
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(200),
      supabase
        .from("agnes_pending_questions")
        .select("id, conversation_id, question, status, expires_at, created_at")
        .eq("conversation_id", conversationId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (messagesResult.error) throw new Error(messagesResult.error.message);
    setMessages((previous) => mergeMessages(previous, (messagesResult.data ?? []) as Message[]));
    setPending((pendingResult.data ?? null) as PendingQuestion | null);
    setLastSync(Date.now());
  }, []);

  const refreshConversations = useCallback(async () => {
    const { data, error: listError } = await supabaseBrowser()
      .from("agnes_conversations")
      .select("id, title, device_id, archived, last_message_at, created_at")
      .is("deleted_at", null)
      .order("last_message_at", { ascending: false })
      .limit(60);
    if (listError) throw new Error(listError.message);
    setConversations((data ?? []) as Conversation[]);
  }, []);

  useEffect(() => {
    if (!activeId) return;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible" || sendingRef.current) return;
      try {
        await loadThread(activeId);
      } catch {
        // Polling is best-effort; explicit actions surface errors.
      }
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [activeId, loadThread]);

  function applyResultNotice(result: ChatResult) {
    if (result.warning) {
      setNotice(`The model returned plain text instead of the structured contract: ${result.warning}`);
    } else if (result.fallback_used) {
      setNotice(
        `Fallback model used${result.fallback_reason ? `: ${result.fallback_reason}` : "."} Provider: ${result.provider}.`,
      );
    } else {
      setNotice(null);
    }
  }

  async function afterResult(result: ChatResult) {
    setActiveId(result.conversation_id);
    window.history.replaceState(null, "", `/chat?c=${result.conversation_id}`);
    applyResultNotice(result);
    await Promise.all([loadThread(result.conversation_id), refreshConversations()]);
  }

  async function startConversation() {
    setSending(true);
    setError(null);
    setNotice(null);
    setPending(null);
    setMessages([]);
    try {
      const result = await callAgnes<ChatResult>("agnes-chat", {
        request_id: newRequestId(),
        action: "start",
        input_source: "web",
      });
      await afterResult(result);
      setInput("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  async function sendMessage(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || sending) return;
    if (!activeId) {
      setError("Start a conversation first.");
      return;
    }
    if (text.length > 1000) {
      setError("Messages are limited to 1000 characters.");
      return;
    }

    const previousInput = input;
    setInput("");
    setSending(true);
    setError(null);
    try {
      const result = await callAgnes<ChatResult>("agnes-chat", {
        request_id: newRequestId(),
        action: "message",
        conversation_id: activeId,
        message: text,
        input_source: "web",
      });
      await afterResult(result);
    } catch (caught) {
      setInput(previousInput);
      setError(errorMessage(caught));
    } finally {
      setSending(false);
    }
  }

  async function selectOption(optionId: string) {
    if (!pending || !activeId || sending) return;
    if (Date.parse(pending.expires_at) <= Date.now()) {
      setError("That question expired. Send a normal message or ask AGNES to continue.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const result = await callAgnes<ChatResult>("agnes-chat", {
        request_id: newRequestId(),
        action: "select",
        conversation_id: activeId,
        question_id: pending.id,
        selected_option_id: optionId,
        input_source: "web",
      });
      setPending(null);
      await afterResult(result);
    } catch (caught) {
      setError(errorMessage(caught));
      try {
        await loadThread(activeId);
      } catch {
        // Keep the original error.
      }
    } finally {
      setSending(false);
    }
  }

  async function switchConversation(conversationId: string) {
    if (conversationId === activeId) return;
    setActiveId(conversationId);
    setMessages([]);
    setPending(null);
    setError(null);
    setNotice(null);
    setLoadingThread(true);
    window.history.replaceState(null, "", `/chat?c=${conversationId}`);
    try {
      await loadThread(conversationId);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoadingThread(false);
    }
  }

  async function refreshThread() {
    if (!activeId) return;
    try {
      await loadThread(activeId);
      await refreshConversations();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  const questionExpired = pending ? Date.parse(pending.expires_at) <= now : false;
  const questionSecondsLeft = pending
    ? Math.max(0, Math.floor((Date.parse(pending.expires_at) - now) / 1000))
    : 0;

  return (
    <div>
      <PageHeader
        eyebrow="Shared thread"
        title="Conversation"
        description="Messages from the OLED device and this dashboard live in one thread. The device receives three short AI-generated choices after each reply."
        action={
          <>
            <button type="button" className="btn" onClick={refreshThread} disabled={!activeId || sending}>
              <RefreshCw size={14} /> Refresh
            </button>
            <button type="button" className="btn btn-primary" onClick={startConversation} disabled={sending}>
              {sending ? <Loader2 size={14} className="animate-spin" /> : <MessageSquarePlus size={14} />}
              New conversation
            </button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[286px_1fr]">
        <aside className="card flex max-h-[300px] flex-col p-2.5 lg:max-h-[calc(100vh-190px)]">
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="text-[0.62rem] font-bold uppercase tracking-[0.16em] text-[#7f97b0]">
              Threads
            </p>
            <span className="badge badge-muted">{conversations.length}</span>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {conversations.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted">
                No conversations yet. Start one to receive AGNES&apos;s first reply.
              </p>
            ) : (
              conversations.map((conversation) => {
                const selected = conversation.id === activeId;
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => switchConversation(conversation.id)}
                    className={`w-full rounded-xl border px-2.5 py-2 text-left transition ${
                      selected
                        ? "border-mint/35 bg-mint/[0.08]"
                        : "border-transparent hover:border-white/10 hover:bg-white/[0.04]"
                    }`}
                  >
                    <p className={`truncate text-xs font-semibold ${selected ? "text-white" : "text-[#c3d3e4]"}`}>
                      {conversation.title}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 text-[0.62rem] text-[#6f879e]">
                      {conversation.device_id ? <Cpu size={9} /> : <Globe2 size={9} />}
                      {conversation.device_id
                        ? deviceNames.get(conversation.device_id) ?? "device"
                        : "web"}{" "}
                      · {relativeTime(conversation.last_message_at)}
                    </p>
                  </button>
                );
              })
            )}
          </div>
          <p className="mt-2 border-t border-white/[0.07] px-2 pt-2 text-[0.6rem] leading-4 text-[#587088]">
            Thread refreshes every 15s while visible. Signed in as {signedInEmail}.
          </p>
        </aside>

        <section className="card flex min-h-[560px] flex-col overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <AgnesFace size={30} />
              <div className="min-w-0">
                <h2 className="truncate text-sm font-bold text-white">
                  {activeConversation?.title ?? "No conversation selected"}
                </h2>
                <p className="flex items-center gap-1 text-[0.62rem] text-[#6f879e]">
                  <span className="dot dot-online" />
                  cloud AI · last refresh {relativeTime(new Date(lastSync).toISOString())}
                </p>
              </div>
            </div>
            {activeConversation?.device_id ? (
              <span className="badge badge-violet">
                <Cpu size={10} /> {deviceNames.get(activeConversation.device_id) ?? "device"} thread
              </span>
            ) : (
              <span className="badge">
                <Globe2 size={10} /> web thread
              </span>
            )}
          </header>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {!activeId ? (
              <div className="flex h-full min-h-[380px] flex-col items-center justify-center text-center">
                <AgnesFace size={72} />
                <p className="mt-4 text-sm font-semibold text-white">No conversation selected</p>
                <p className="mt-1 max-w-sm text-xs leading-5 text-muted">
                  Start a new conversation to receive a greeting and the first three-choice question.
                  Every reply is generated by the configured cloud model.
                </p>
                <button
                  type="button"
                  className="btn btn-primary mt-4"
                  onClick={startConversation}
                  disabled={sending}
                >
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  Start conversation
                </button>
              </div>
            ) : loadingThread ? (
              <div className="flex items-center justify-center gap-2 py-20 text-xs text-muted">
                <Loader2 size={14} className="animate-spin" /> Loading thread…
              </div>
            ) : messages.length === 0 && !sending ? (
              <div className="py-16 text-center text-xs text-muted">
                This conversation is empty. Send a message below.
              </div>
            ) : (
              messages.map((message) => {
                const isUser = message.role === "user";
                if (message.role === "system") {
                  return (
                    <p key={message.id} className="text-center text-[0.68rem] text-[#6f879e]">
                      {message.content}
                    </p>
                  );
                }
                return (
                  <div key={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] ${isUser ? "text-right" : "text-left"}`}>
                      <div
                        className={`inline-block rounded-2xl px-3.5 py-2.5 text-left text-[0.82rem] leading-6 whitespace-pre-wrap ${
                          isUser
                            ? "rounded-br-md border border-mint/25 bg-mint/[0.1] text-[#dcfff9]"
                            : "rounded-bl-md border border-white/10 bg-[#0c1421] text-[#dbe8f3]"
                        }`}
                      >
                        {message.content}
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 px-1 text-[0.6rem] text-[#587088]">
                        {isUser ? (
                          message.input_source === "device" ? (
                            <Cpu size={9} />
                          ) : (
                            <Globe2 size={9} />
                          )
                        ) : (
                          <Bot size={9} />
                        )}
                        {isUser
                          ? message.input_source === "device"
                            ? "from device"
                            : "from web"
                          : `${message.emotion ?? "normal"} ${emotionEmoji[message.emotion ?? "normal"] ?? ""}`}
                        {!isUser && message.model ? ` · ${message.provider}/${message.model}` : ""}
                        <span>· {relativeTime(message.created_at)}</span>
                        {message.metadata && (message.metadata as Record<string, unknown>).fallback_used ? (
                          <span className="text-amber-300/80">· fallback</span>
                        ) : null}
                      </p>
                    </div>
                  </div>
                );
              })
            )}

            {sending ? (
              <div className="flex items-center gap-2 text-xs text-mint/80">
                <span className="flex gap-1">
                  <span className="dot dot-online" />
                </span>
                AGNES is thinking…
              </div>
            ) : null}

            {pending && activeId ? (
              <div className="rounded-2xl border border-violet/25 bg-violet/[0.06] p-3.5">
                <p className="flex items-center gap-1.5 text-[0.62rem] font-bold uppercase tracking-[0.14em] text-violet-200/80">
                  <Sparkles size={11} /> Three-choice question
                </p>
                <p className="mt-1.5 text-sm font-semibold text-white">{pending.question.text}</p>
                <div className="mt-3 grid gap-1.5">
                  {pending.question.options.map((option, index) => (
                    <button
                      key={option.id}
                      type="button"
                      className="btn w-full justify-start border-violet/25 bg-black/25 hover:border-violet/50 hover:bg-violet/10"
                      onClick={() => selectOption(option.id)}
                      disabled={sending || questionExpired}
                    >
                      <span className="mono flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-violet/30 bg-violet/10 text-[0.66rem] font-bold text-violet-200">
                        {String.fromCharCode(65 + index)}
                      </span>
                      <span className="truncate">{option.label}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[0.62rem] text-[#8fa6bd]">
                  {questionExpired
                    ? "This question expired. Use the continuation button or type a normal message."
                    : `Expires in ${Math.floor(questionSecondsLeft / 60)}:${String(questionSecondsLeft % 60).padStart(2, "0")}. You can also type your own answer.`}
                </p>
                {questionExpired ? (
                  <button
                    type="button"
                    className="btn btn-sm mt-2 w-full"
                    onClick={() => sendMessage("Please continue from where we left off.")}
                    disabled={sending}
                  >
                    Ask AGNES to continue (canned message)
                  </button>
                ) : null}
              </div>
            ) : null}

            {notice ? (
              <p className="flex items-start gap-2 rounded-xl border border-amber/25 bg-amber/[0.07] px-3 py-2 text-[0.7rem] leading-5 text-amber-100/90">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {notice}
              </p>
            ) : null}

            {error ? (
              <div className="rounded-xl border border-rose/30 bg-rose/10 px-3 py-2.5 text-[0.72rem] leading-5 text-rose-200">
                <p>{error}</p>
                <Link href="/providers" className="mt-1 inline-block font-semibold underline">
                  Check provider and model settings
                </Link>
              </div>
            ) : null}

            <div ref={bottomRef} />
          </div>

          <footer className="border-t border-white/[0.07] px-4 py-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                className="textarea min-h-[44px] flex-1 resize-none"
                rows={1}
                maxLength={1000}
                placeholder={
                  activeId
                    ? "Type a message… (Enter to send, Shift+Enter for a new line)"
                    : "Start a conversation first"
                }
                value={input}
                disabled={!activeId || sending}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-primary h-[44px] px-4"
                onClick={() => sendMessage()}
                disabled={!activeId || sending || !input.trim()}
                aria-label="Send message"
              >
                {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              </button>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[0.6rem] text-[#587088]">
              <span>
                {activeId
                  ? "Shared with the device. Device replies appear after the next refresh."
                  : "New conversations begin with an AI greeting."}
              </span>
              <span className={input.length > 950 ? "text-amber-300" : ""}>{input.length}/1000</span>
            </div>
          </footer>
        </section>
      </div>

      <div className="mt-4 grid gap-2 text-[0.66rem] leading-5 text-[#6f879e] sm:grid-cols-3">
        <p className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
          <span className="font-semibold text-[#c3d3e4]">Structured replies:</span> the server validates
          emotion, animation, intensity and exactly three unique options before saving.
        </p>
        <p className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
          <span className="font-semibold text-[#c3d3e4]">No fabricated structure:</span> plain-text
          model output is shown honestly with a warning instead of inventing buttons.
        </p>
        <p className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
          <span className="font-semibold text-[#c3d3e4]">Offline:</span> cloud replies require internet.
          The device caches its last reply and options, not a language model.
        </p>
      </div>
    </div>
  );
}
