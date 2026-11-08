import { admin } from "../db.ts";
import { ApiError } from "../http.ts";
import type { AuthContext } from "../auth.ts";
import type { ChatRequest } from "../validation.ts";
import { aiReplySchema, type AiReply } from "../validation.ts";
import { getProviderKey, requireProviderKey } from "../credentials.ts";
import {
  assertFallbackBilling,
  assertModelBilling,
  ensureFreshCatalogue,
  findModel,
  pickAutomaticFreeModel,
  refreshProviderCatalogue,
} from "../catalogue.ts";
import { getAdapter } from "../providers/registry.ts";
import {
  type ChatMessage,
  type ChatResult,
  type CatalogueModel,
  ProviderError,
  type ProviderId,
} from "../providers/types.ts";
import { buildRepairTurn, buildStartTurn, buildSystemPrompt } from "./prompt.ts";
import { parseAiReply } from "./response.ts";
import { applyChatMood, decayPetState, type PetState } from "../pet.ts";

const SENSITIVE_MEMORY_PATTERN =
  /(password|passcode|api[\s_-]?key|secret|access[\s_-]?token|credit[\s_-]?card|social security|\bssn\b|bank account|routing number|private key|seed phrase)/i;

type SettingsRow = {
  personality: string;
  cloud_memory_enabled: boolean;
};

type PreferencesRow = {
  active_provider: ProviderId;
  active_model_id: string | null;
  fallback_provider: ProviderId | null;
  fallback_model_id: string | null;
  automatic_free_model: boolean;
  allow_paid: boolean;
  temperature: number;
  max_response_tokens: number;
  context_messages: number;
  request_timeout_ms: number;
};

type ConversationRow = {
  id: string;
  user_id: string;
  device_id: string | null;
  title: string;
  deleted_at: string | null;
};

type PendingQuestionRow = {
  id: string;
  conversation_id: string;
  user_id: string;
  device_id: string | null;
  question: {
    type: "choice";
    text: string;
    options: { id: string; label: string }[];
  };
  status: string;
  expires_at: string;
};

type ModelRun = {
  provider: ProviderId;
  model: CatalogueModel;
  result: ChatResult;
  keySource: "user" | "environment";
};

export type ChatEngineResult = {
  request_id: string;
  conversation_id: string;
  conversation_title: string;
  message_id: string;
  user_message_id: string | null;
  reply: string;
  emotion: string;
  animation: string;
  intensity: number;
  mood_delta: number;
  question: {
    id: string;
    type: "choice";
    text: string;
    options: { id: string; label: string }[];
    expires_at: string;
  } | null;
  provider: ProviderId;
  model: string;
  fallback_used: boolean;
  fallback_reason: string | null;
  selection_reason: string | null;
  usage: ChatResult["usage"];
  warning: string | null;
  pet: { happiness: number; level: number; friendship_xp: number };
  achievements: string[];
  created_at: string;
};

function safeTitle(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New conversation";
  return cleaned.slice(0, 60);
}

function toChatHistory(rows: Record<string, unknown>[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const row of rows) {
    const role = row.role;
    if (role !== "user" && role !== "assistant") continue;
    let content = String(row.content ?? "").trim().slice(0, 1200);
    if (!content) continue;
    const metadata = (row.metadata && typeof row.metadata === "object")
      ? row.metadata as Record<string, unknown>
      : {};
    if (role === "assistant" && metadata.question && typeof metadata.question === "object") {
      const question = metadata.question as Record<string, unknown>;
      if (typeof question.text === "string" && Array.isArray(question.options)) {
        const labels = question.options
          .map((option) => (option && typeof option === "object" ? String((option as Record<string, unknown>).label ?? "") : ""))
          .filter(Boolean)
          .join(" / ");
        content += `\n[AGNES asked: ${question.text.slice(0, 80)} — options: ${labels.slice(0, 140)}]`;
      }
    }
    result.push({ role, content });
  }
  return result;
}

async function loadSettings(userId: string): Promise<SettingsRow> {
  const { data, error } = await admin()
    .from("agnes_settings")
    .select("personality, cloud_memory_enabled")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new ApiError("settings_failed", "Could not load settings", 500);
  if (!data) return { personality: "friendly", cloud_memory_enabled: true };
  return data as SettingsRow;
}

async function loadPreferences(userId: string): Promise<PreferencesRow> {
  const { data, error } = await admin()
    .from("agnes_model_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new ApiError("provider_config_error", "Could not load AI preferences", 500);
  if (!data) {
    const { data: created, error: createError } = await admin()
      .from("agnes_model_preferences")
      .insert({ user_id: userId })
      .select("*")
      .single();
    if (createError) throw new ApiError("provider_config_error", "Could not create AI preferences", 500);
    return created as PreferencesRow;
  }
  return data as PreferencesRow;
}

async function loadApprovedMemories(
  userId: string,
  cloudMemoryEnabled: boolean,
  query: string,
): Promise<{ category: string; content: string }[]> {
  if (!cloudMemoryEnabled) return [];
  const { data, error } = await admin()
    .from("agnes_memories")
    .select("category, content, pinned, updated_at")
    .eq("user_id", userId)
    .eq("status", "approved")
    .is("deleted_at", null)
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(40);
  if (error) {
    console.error("Memory context load failed", error.code);
    return [];
  }
  const words = query.toLowerCase().split(/\W+/).filter((word) => word.length >= 4).slice(0, 5);
  const scored = (data ?? []).map((row) => {
    const content = String(row.content ?? "");
    const category = String(row.category ?? "fact");
    let score = row.pinned ? 2 : 0;
    for (const word of words) {
      if (content.toLowerCase().includes(word)) score += 3;
    }
    return { category, content, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 8).map(({ category, content }) => ({ category, content }));
}

async function loadConversation(userId: string, conversationId: string): Promise<ConversationRow> {
  const { data, error } = await admin()
    .from("agnes_conversations")
    .select("id, user_id, device_id, title, deleted_at")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new ApiError("conversation_failed", "Could not load conversation", 500);
  if (!data || data.deleted_at) {
    throw new ApiError("conversation_not_found", "Conversation not found", 404);
  }
  return data as ConversationRow;
}

async function latestConversation(userId: string): Promise<ConversationRow | null> {
  const { data, error } = await admin()
    .from("agnes_conversations")
    .select("id, user_id, device_id, title, deleted_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ApiError("conversation_failed", "Could not load conversations", 500);
  return (data as ConversationRow | null) ?? null;
}

async function createConversation(
  userId: string,
  deviceId: string | null,
  title: string,
): Promise<ConversationRow> {
  const { data, error } = await admin()
    .from("agnes_conversations")
    .insert({ user_id: userId, device_id: deviceId, title })
    .select("id, user_id, device_id, title, deleted_at")
    .single();
  if (error) throw new ApiError("conversation_failed", "Could not create conversation", 500);
  return data as ConversationRow;
}

async function loadHistory(conversationId: string, limit: number): Promise<Record<string, unknown>[]> {
  const { data, error } = await admin()
    .from("agnes_messages")
    .select("id, role, content, metadata, provider, model, emotion, animation, intensity, mood_delta, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new ApiError("history_failed", "Could not load conversation history", 500);
  return (data ?? []).reverse();
}

async function loadPendingQuestion(
  conversationId: string,
  userId: string,
): Promise<PendingQuestionRow | null> {
  const { data, error } = await admin()
    .from("agnes_pending_questions")
    .select("id, conversation_id, user_id, device_id, question, status, expires_at")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ApiError("question_failed", "Could not load pending question", 500);
  return (data as PendingQuestionRow | null) ?? null;
}

async function conversationHasMessages(conversationId: string): Promise<boolean> {
  const { count, error } = await admin()
    .from("agnes_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId);
  if (error) throw new ApiError("history_failed", "Could not check conversation", 500);
  return (count ?? 0) > 0;
}

async function findCompletedRequest(
  userId: string,
  requestId: string,
): Promise<ChatEngineResult | null> {
  const { data, error } = await admin()
    .from("agnes_messages")
    .select("id, content, metadata, created_at, conversation_id")
    .eq("user_id", userId)
    .eq("role", "assistant")
    .eq("metadata->>request_id", requestId)
    .maybeSingle();
  if (error) return null;
  if (!data) return null;
  const metadata = (data.metadata && typeof data.metadata === "object")
    ? data.metadata as Record<string, unknown>
    : {};
  if (metadata.response && typeof metadata.response === "object") {
    return metadata.response as ChatEngineResult;
  }
  return null;
}

function providerFailure(error: unknown, fallbackProvider?: string): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ProviderError) {
    const details = {
      provider: error.provider,
      kind: error.kind,
      fallback_provider: fallbackProvider ?? null,
    };
    switch (error.kind) {
      case "auth":
        return new ApiError("provider_auth_failed", "The provider rejected its API key. Update it in Model Center.", 409, details);
      case "rate_limit":
        return new ApiError("provider_rate_limited", "The selected provider is rate limiting requests. Try again shortly or change models.", 429, details);
      case "timeout":
        return new ApiError("provider_timeout", "The AI provider timed out. Try again.", 504, details);
      case "model_unavailable":
        return new ApiError("model_unavailable", "The selected model is not available from this provider.", 409, details);
      case "invalid_request":
        return new ApiError("provider_invalid_request", "The provider rejected the request parameters. Choose a compatible model.", 400, details);
      case "server":
      case "network":
        return new ApiError("provider_unavailable", "The AI provider is temporarily unavailable.", 502, details);
      default:
        return new ApiError("provider_error", "The AI provider returned an error.", 502, details);
    }
  }
  console.error("AI engine failure", error instanceof Error ? error.name : "unknown");
  return new ApiError("ai_failed", "Could not complete the AI request", 500);
}

async function resolveModel(
  userId: string,
  provider: ProviderId,
  modelId: string,
  allowPaid: boolean,
  apiKey: string,
): Promise<CatalogueModel> {
  let model = await findModel(provider, modelId);
  if (!model) {
    await refreshProviderCatalogue(provider, apiKey);
    model = await findModel(provider, modelId);
  }
  if (!model) {
    throw new ApiError(
      "model_not_in_catalogue",
      "The selected model is not in the live catalogue. Refresh Model Center and choose again.",
      409,
    );
  }
  assertModelBilling(model, allowPaid);
  return model;
}

async function chooseInitialModel(
  userId: string,
  prefs: PreferencesRow,
): Promise<CatalogueModel> {
  const providerKey = await requireProviderKey(userId, prefs.active_provider);
  if (prefs.active_model_id) {
    return await resolveModel(
      userId,
      prefs.active_provider,
      prefs.active_model_id,
      prefs.allow_paid,
      providerKey.apiKey,
    );
  }
  if (!prefs.automatic_free_model) {
    throw new ApiError("model_not_selected", "Choose an AI model in Model Center first.", 409);
  }
  if (prefs.active_provider !== "openrouter") {
    throw new ApiError(
      "model_not_selected",
      "Automatic free-model routing is available for OpenRouter only; choose a model for this provider.",
      409,
    );
  }
  await ensureFreshCatalogue("openrouter", providerKey.apiKey);
  const model = await pickAutomaticFreeModel();
  if (!model) {
    throw new ApiError("no_free_model", "No free OpenRouter text model is currently available.", 503);
  }
  assertModelBilling(model, false);
  return model;
}

async function callModel(
  userId: string,
  model: CatalogueModel,
  messages: ChatMessage[],
  prefs: PreferencesRow,
  timeoutMs: number,
): Promise<ModelRun> {
  const key = await requireProviderKey(userId, model.provider);
  return await runModel(model, messages, prefs, timeoutMs, key.apiKey, key.source);
}

async function runModel(
  model: CatalogueModel,
  messages: ChatMessage[],
  prefs: PreferencesRow,
  timeoutMs: number,
  apiKey: string,
  keySource: "user" | "environment",
  jsonMode = true,
): Promise<ModelRun> {
  assertModelBilling(model, prefs.allow_paid);
  const result = await getAdapter(model.provider).chat({
    apiKey,
    model: model.id,
    messages,
    temperature: Number(prefs.temperature),
    maxTokens: prefs.max_response_tokens,
    timeoutMs,
    jsonMode: jsonMode && model.supportsStructuredOutput,
  });
  return { provider: model.provider, model, result, keySource };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithFallback(
  userId: string,
  prefs: PreferencesRow,
  messages: ChatMessage[],
  jsonMode = true,
): Promise<{ run: ModelRun; fallbackUsed: boolean; reason: string | null; selectionReason: string | null }> {
  const deadline = Date.now() + 90_000;
  const primary = await chooseInitialModel(userId, prefs);
  const primaryKey = await requireProviderKey(userId, primary.provider);
  const primaryTimeout = Math.min(prefs.request_timeout_ms, Math.max(deadline - Date.now() - 2000, 5000));

  const tryOne = async (
    model: CatalogueModel,
    apiKey: string,
    keySource: "user" | "environment",
    timeout: number,
  ): Promise<ModelRun> => {
    try {
      return await runModel(model, messages, prefs, timeout, apiKey, keySource, jsonMode);
    } catch (error) {
      if (
        error instanceof ProviderError &&
        error.retryable &&
        Date.now() + 1500 < deadline &&
        !(error.kind === "rate_limit" && (error.retryAfterMs ?? 0) > 8000)
      ) {
        if (error.retryAfterMs && error.retryAfterMs > 0) {
          await sleep(Math.min(error.retryAfterMs, 1500));
        } else {
          await sleep(700);
        }
        const retryTimeout = Math.min(prefs.request_timeout_ms, Math.max(deadline - Date.now() - 2000, 4000));
        return await runModel(model, messages, prefs, retryTimeout, apiKey, keySource, jsonMode);
      }
      throw error;
    }
  };

  try {
    return {
      run: await tryOne(primary, primaryKey.apiKey, primaryKey.source, primaryTimeout),
      fallbackUsed: false,
      reason: null,
      selectionReason: prefs.active_model_id ? null : "automatic free model",
    };
  } catch (primaryError) {
    if (
      primaryError instanceof ProviderError &&
      (primaryError.kind === "auth" || primaryError.kind === "invalid_request")
    ) {
      throw providerFailure(primaryError);
    }
    if (primaryError instanceof ApiError && primaryError.code === "provider_disabled") {
      throw primaryError;
    }
    if (!(primaryError instanceof ProviderError) || !primaryError.retryable) {
      throw providerFailure(primaryError);
    }

    let fallbackModel: CatalogueModel | null = null;
    if (
      prefs.fallback_provider &&
      prefs.fallback_model_id &&
      !(prefs.fallback_provider === primary.provider && prefs.fallback_model_id === primary.id)
    ) {
      const fallbackKey = await requireProviderKey(userId, prefs.fallback_provider);
      fallbackModel = await resolveModel(
        userId,
        prefs.fallback_provider,
        prefs.fallback_model_id,
        prefs.allow_paid,
        fallbackKey.apiKey,
      );
    } else if (prefs.automatic_free_model && primary.provider !== "openrouter") {
      const openRouterKey = await getProviderKey(userId, "openrouter");
      if (openRouterKey) {
        await ensureFreshCatalogue("openrouter", openRouterKey.apiKey);
        fallbackModel = await pickAutomaticFreeModel([primary.id]);
        if (fallbackModel) assertModelBilling(fallbackModel, false);
      }
    } else if (prefs.automatic_free_model && primary.provider === "openrouter") {
      await ensureFreshCatalogue("openrouter", primaryKey.apiKey);
      fallbackModel = await pickAutomaticFreeModel([primary.id]);
      if (fallbackModel) assertModelBilling(fallbackModel, false);
    }

    if (!fallbackModel) {
      throw providerFailure(primaryError);
    }

    assertFallbackBilling(primary, fallbackModel);

    const reason = `Primary ${primary.provider}/${primary.id} failed (${(primaryError as ProviderError).kind}); used fallback`;
    try {
      const fallbackKey = await requireProviderKey(userId, fallbackModel.provider);
      const remaining = Math.max(deadline - Date.now() - 1000, 5000);
      const run = await runModel(
        fallbackModel,
        messages,
        prefs,
        Math.min(prefs.request_timeout_ms, remaining),
        fallbackKey.apiKey,
        fallbackKey.source,
        jsonMode,
      );
      return {
        run,
        fallbackUsed: true,
        reason,
        selectionReason: "automatic free fallback",
      };
    } catch (fallbackError) {
      if (fallbackError instanceof ProviderError) {
        throw providerFailure(fallbackError, fallbackModel.provider);
      }
      throw providerFailure(fallbackError, fallbackModel.provider);
    }
  }
}

async function maybeSuggestMemory(
  userId: string,
  cloudMemoryEnabled: boolean,
  suggestion: AiReply["memory_suggestion"],
): Promise<boolean> {
  if (!cloudMemoryEnabled || !suggestion) return false;
  if (SENSITIVE_MEMORY_PATTERN.test(suggestion.content)) return false;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: duplicate } = await admin()
    .from("agnes_memories")
    .select("id")
    .eq("user_id", userId)
    .eq("content", suggestion.content)
    .gte("created_at", since)
    .limit(1)
    .maybeSingle();
  if (duplicate) return false;
  const { error } = await admin().from("agnes_memories").insert({
    user_id: userId,
    category: suggestion.category,
    content: suggestion.content,
    status: "pending",
    source: "ai_suggested",
  });
  if (error) {
    console.error("Memory suggestion insert failed", error.code);
    return false;
  }
  return true;
}

async function loadPetForPrompt(userId: string): Promise<PetState> {
  return await decayPetState(userId);
}

function petEmotion(pet: PetState): string {
  if (pet.hunger > 75) return "concerned";
  if (pet.energy < 25) return "sleepy";
  if (pet.happiness > 75) return "happy";
  if (pet.happiness < 30) return "sad";
  return "normal";
}

async function finalize(
  params: Record<string, unknown>,
): Promise<{
  user_message_id: string | null;
  assistant_message_id: string;
  question_id: string | null;
  created_at: string;
}> {
  const { data, error } = await admin().rpc("agnes_finalize_chat", params);
  if (error) {
    console.error("Chat finalize RPC failed", error.code);
    throw new ApiError("chat_store_failed", "Could not store the conversation turn", 500);
  }
  const result = data as Record<string, unknown> | null;
  if (!result || typeof result.assistant_message_id !== "string") {
    throw new ApiError("chat_store_failed", "Conversation turn was not stored", 500);
  }
  return result as {
    user_message_id: string | null;
    assistant_message_id: string;
    question_id: string | null;
    created_at: string;
  };
}

export async function handleChat(
  auth: AuthContext,
  request: ChatRequest,
): Promise<ChatEngineResult> {
  const userId = auth.userId;
  const deviceId = auth.kind === "device" ? auth.deviceId : null;
  const source = auth.kind === "device" ? "device" : "web";
  if (request.input_source && request.input_source !== source) {
    throw new ApiError("input_source_mismatch", "input_source does not match the authenticated transport", 400);
  }

  const completed = await findCompletedRequest(userId, request.request_id);
  if (completed) return completed;

  const settings = await loadSettings(userId);
  const prefs = await loadPreferences(userId);

  // Resolve conversation first.
  let conversation: ConversationRow | null = null;
  if (request.conversation_id) {
    conversation = await loadConversation(userId, request.conversation_id);
  } else if (request.action === "message" || request.action === "select") {
    conversation = await latestConversation(userId);
  }

  if (request.action === "resume") {
    if (!conversation) {
      throw new ApiError("conversation_not_found", "No conversation to resume", 404);
    }
    return await resumeConversation(userId, conversation);
  }

  if (request.action === "start" && conversation && await conversationHasMessages(conversation.id)) {
    return await resumeConversation(userId, conversation);
  }

  let createdConversation = false;
  if (!conversation) {
    const title = request.action === "message" ? safeTitle(request.message) : "New conversation";
    conversation = await createConversation(userId, deviceId, title);
    createdConversation = true;
  }

  try {
    let pendingQuestion: PendingQuestionRow | null = null;
    let selectedLabel: string | null = null;
    let userContent: string | null = null;
    let userMetadata: Record<string, unknown> = {};

    if (request.action === "select") {
      const { data, error } = await admin()
        .from("agnes_pending_questions")
        .select("id, conversation_id, user_id, device_id, question, status, expires_at")
        .eq("id", request.question_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new ApiError("question_failed", "Could not load question", 500);
      if (!data) throw new ApiError("question_not_found", "That question no longer exists", 404);
      const row = data as PendingQuestionRow;
      if (row.conversation_id !== conversation.id) {
        throw new ApiError("question_mismatch", "Question belongs to another conversation", 409);
      }
      if (row.status !== "pending") {
        throw new ApiError("question_answered", "That question has already been answered", 409);
      }
      if (Date.parse(row.expires_at) <= Date.now()) {
        await admin().from("agnes_pending_questions").update({ status: "expired" }).eq("id", row.id);
        throw new ApiError("question_expired", "That question expired; ask AGNES for another", 409);
      }
      const option = row.question.options.find((item) => item.id === request.selected_option_id);
      if (!option) {
        throw new ApiError("invalid_option", "Selected option is not part of the question", 400);
      }
      pendingQuestion = row;
      selectedLabel = option.label;
      userContent = option.label;
      userMetadata = {
        question_id: row.id,
        question_text: row.question.text,
        selected_option_id: option.id,
      };
    } else if (request.action === "message") {
      userContent = request.message.trim();
      userMetadata = {};
    }

    const historyLimit = prefs.context_messages;
    const historyRows = await loadHistory(conversation.id, historyLimit);
    const history = toChatHistory(historyRows);
    const pet = await loadPetForPrompt(userId);
    const memories = await loadApprovedMemories(
      userId,
      settings.cloud_memory_enabled,
      userContent ?? "",
    );
    const displayName = await (async () => {
      const { data } = await admin()
        .from("agnes_profiles")
        .select("display_name")
        .eq("user_id", userId)
        .maybeSingle();
      return (data?.display_name as string | null) ?? null;
    })();

    const systemPrompt = buildSystemPrompt({
      personality: settings.personality,
      displayName,
      emotion: petEmotion(pet),
      pet: {
        name: pet.name,
        happiness: pet.happiness,
        energy: pet.energy,
        hunger: pet.hunger,
        level: pet.level,
        friendship_xp: pet.friendship_xp,
        stage: pet.stage,
      },
      memories,
      pendingQuestionText: pendingQuestion?.question.text ?? null,
      isStart: request.action === "start",
      selectedLabel,
    });

    const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }, ...history];
    if (request.action === "start") {
      messages.push(buildStartTurn());
    } else if (request.action === "message") {
      messages.push({ role: "user", content: userContent ?? "" });
    } else if (request.action === "select") {
      messages.push({ role: "user", content: userContent ?? "" });
    }

    const { run, fallbackUsed, reason, selectionReason } = await runWithFallback(
      userId,
      prefs,
      messages,
    );

    let parsed = parseAiReply(run.result.content);
    if (!parsed.structured) {
      // One bounded repair attempt with the same selected model, never with a
      // paid model that the user did not approve.
      try {
        const repairMessages: ChatMessage[] = [
          ...messages,
          { role: "assistant", content: run.result.content.slice(0, 2000) },
          buildRepairTurn(parsed.warning ?? "invalid structured output"),
        ];
        const repair = await runModel(
          run.model,
          repairMessages,
          prefs,
          Math.min(prefs.request_timeout_ms, 25_000),
          (await requireProviderKey(userId, run.model.provider)).apiKey,
          run.keySource,
        );
        const repaired = parseAiReply(repair.result.content);
        if (repaired.structured) {
          parsed = repaired;
          run.result = repair.result;
        }
      } catch {
        // Keep the original plain-text answer.
      }
    }

    const aiReply = parsed.reply;
    const petUpdate = await applyChatMood(
      userId,
      aiReply.mood_delta,
      deviceId,
      `chat:${request.request_id}`,
    ).catch((error) => {
      console.error("Pet mood update failed", error instanceof ApiError ? error.code : "unknown");
      return null;
    });
    const memorySuggested = await maybeSuggestMemory(
      userId,
      settings.cloud_memory_enabled,
      aiReply.memory_suggestion,
    ).catch(() => false);

    const questionExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const questionForDb = aiReply.ask_question && aiReply.question
      ? {
        type: "choice",
        text: aiReply.question.text,
        options: aiReply.question.options,
      }
      : null;

    const title = request.action === "message" && conversation.title === "New conversation"
      ? safeTitle(request.message)
      : null;

    const responseBase: Omit<ChatEngineResult, "message_id" | "user_message_id" | "question" | "created_at"> = {
      request_id: request.request_id,
      conversation_id: conversation.id,
      conversation_title: title ?? conversation.title,
      reply: aiReply.reply,
      emotion: aiReply.emotion,
      animation: aiReply.animation,
      intensity: aiReply.intensity,
      mood_delta: aiReply.mood_delta,
      provider: run.provider,
      model: run.result.model || run.model.id,
      fallback_used: fallbackUsed,
      fallback_reason: reason,
      selection_reason: selectionReason,
      usage: run.result.usage,
      warning: parsed.warning,
      pet: {
        happiness: petUpdate?.state.happiness ?? pet.happiness,
        level: petUpdate?.state.level ?? pet.level,
        friendship_xp: petUpdate?.state.friendship_xp ?? pet.friendship_xp,
      },
      achievements: petUpdate?.achievements ?? [],
    };

    const assistantMetadata = {
      request_id: request.request_id,
      question: questionForDb,
      fallback_used: fallbackUsed,
      fallback_reason: reason,
      selection_reason: selectionReason,
      usage: run.result.usage,
      warning: parsed.warning,
      memory_suggested: memorySuggested,
      input_source: source,
    };

    const finalized = await finalize({
      p_user_id: userId,
      p_conversation_id: conversation.id,
      p_user_content: userContent,
      p_user_source: source,
      p_user_metadata: userMetadata,
      p_assistant_content: aiReply.reply,
      p_assistant_metadata: assistantMetadata,
      p_provider: run.provider,
      p_model: run.result.model || run.model.id,
      p_emotion: aiReply.emotion,
      p_animation: aiReply.animation,
      p_intensity: aiReply.intensity,
      p_mood_delta: aiReply.mood_delta,
      p_question: questionForDb,
      p_question_expires: questionForDb ? questionExpiresAt : null,
      p_answered_question_id: pendingQuestion?.id ?? null,
      p_selected_option_id: request.action === "select" ? request.selected_option_id : null,
      p_request_id: request.request_id,
      p_usage: run.result.usage,
      p_conversation_title: title,
    });

    const response: ChatEngineResult = {
      ...responseBase,
      message_id: finalized.assistant_message_id,
      user_message_id: finalized.user_message_id,
      created_at: finalized.created_at,
      question: questionForDb && finalized.question_id
        ? {
          id: finalized.question_id,
          type: "choice",
          text: questionForDb.text,
          options: questionForDb.options,
          expires_at: questionExpiresAt,
        }
        : null,
    };

    // Persist the response inside the assistant metadata for crash recovery.
    const responseMetadata = { ...assistantMetadata, response };
    await admin()
      .from("agnes_messages")
      .update({ metadata: responseMetadata })
      .eq("id", finalized.assistant_message_id)
      .eq("user_id", userId);

    return response;
  } catch (error) {
    if (createdConversation && conversation) {
      const hasMessages = await conversationHasMessages(conversation.id).catch(() => true);
      if (!hasMessages) {
        await admin().from("agnes_conversations").delete().eq("id", conversation.id).eq("user_id", userId);
      }
    }
    throw error;
  }
}

async function resumeConversation(
  userId: string,
  conversation: ConversationRow,
): Promise<ChatEngineResult> {
  const historyRows = await loadHistory(conversation.id, 20);
  const lastAssistant = [...historyRows].reverse().find((row) => row.role === "assistant");
  const pending = await loadPendingQuestion(conversation.id, userId);

  if (!lastAssistant) {
    throw new ApiError("conversation_empty", "This conversation has no AGNES reply yet", 404);
  }
  const metadata = (lastAssistant.metadata && typeof lastAssistant.metadata === "object")
    ? lastAssistant.metadata as Record<string, unknown>
    : {};
  const stored = metadata.response && typeof metadata.response === "object"
    ? metadata.response as ChatEngineResult
    : null;
  if (stored) {
    if (pending) return { ...stored, question: pendingToQuestion(pending) };
    return { ...stored, question: null };
  }

  const provider = typeof lastAssistant.provider === "string" ? lastAssistant.provider : "openrouter";
  const model = typeof lastAssistant.model === "string" ? lastAssistant.model : "unknown";
  return {
    request_id: crypto.randomUUID(),
    conversation_id: conversation.id,
    conversation_title: conversation.title,
    message_id: String(lastAssistant.id ?? ""),
    user_message_id: null,
    reply: String(lastAssistant.content ?? ""),
    emotion: String(lastAssistant.emotion ?? "normal"),
    animation: String(lastAssistant.animation ?? "none"),
    intensity: Number(lastAssistant.intensity ?? 1),
    mood_delta: Number(lastAssistant.mood_delta ?? 0),
    question: pending ? pendingToQuestion(pending) : null,
    provider: provider as ProviderId,
    model,
    fallback_used: false,
    fallback_reason: null,
    selection_reason: null,
    usage: { promptTokens: null, completionTokens: null, totalTokens: null, costUsd: null },
    warning: null,
    pet: { happiness: 0, level: 0, friendship_xp: 0 },
    achievements: [],
    created_at: String(lastAssistant.created_at ?? new Date().toISOString()),
  };
}

function pendingToQuestion(pending: PendingQuestionRow): ChatEngineResult["question"] {
  return {
    id: pending.id,
    type: "choice",
    text: pending.question.text,
    options: pending.question.options,
    expires_at: pending.expires_at,
  };
}

export async function listPendingQuestionForDevice(
  userId: string,
  conversationId: string,
): Promise<ChatEngineResult["question"]> {
  const pending = await loadPendingQuestion(conversationId, userId);
  return pending ? pendingToQuestion(pending) : null;
}

/**
 * One-shot plain-text completion for Smart Tools (translation). Uses the same
 * configured primary/fallback models and the same paid-model guardrails, but
 * creates no conversation records and asks for no JSON.
 */
export async function runConfiguredCompletion(
  userId: string,
  messages: ChatMessage[],
): Promise<{
  content: string;
  provider: ProviderId;
  model: string;
  fallback_used: boolean;
}> {
  const prefs = await loadPreferences(userId);
  const { run, fallbackUsed } = await runWithFallback(userId, prefs, messages, false);
  return {
    content: run.result.content.trim().slice(0, 3000),
    provider: run.provider,
    model: run.result.model || run.model.id,
    fallback_used: fallbackUsed,
  };
}
