import type { AiReply } from "../validation.ts";
import { aiReplySchema, emotionSchema, questionSchema, animationSchema } from "../validation.ts";

export type ParseResult = {
  reply: AiReply;
  structured: boolean;
  warning: string | null;
};

const SENSITIVE_MEMORY_PATTERN =
  /(password|passcode|api[\s_-]?key|secret|access[\s_-]?token|credit[\s_-]?card|social security|\bssn\b|bank account|routing number|private key|seed phrase)/i;

function stripCodeFences(value: string): string {
  return value
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function extractObject(value: string): string | null {
  const first = value.indexOf("{");
  const last = value.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  return value.slice(first, last + 1);
}

function baseReply(candidate: Record<string, unknown>): AiReply | null {
  const base = aiReplySchema.omit({ ask_question: true, question: true }).safeParse({
    reply: candidate.reply,
    emotion: candidate.emotion,
    animation: candidate.animation,
    intensity: candidate.intensity,
    mood_delta: candidate.mood_delta,
    memory_suggestion: candidate.memory_suggestion ?? null,
  });
  if (!base.success) return null;
  const question = questionSchema.safeParse(candidate.question);
  const ask = candidate.ask_question === true && question.success;
  return {
    ...base.data,
    ask_question: ask,
    question: ask ? question.data : null,
    memory_suggestion: base.data.memory_suggestion &&
        !SENSITIVE_MEMORY_PATTERN.test(base.data.memory_suggestion.content)
      ? base.data.memory_suggestion
      : null,
  };
}

export function parseAiReply(content: string): ParseResult {
  const cleaned = stripCodeFences(content);
  const candidates = [cleaned, extractObject(cleaned)].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const full = aiReplySchema.safeParse(parsed);
    if (full.success) {
      const safeMemory = full.data.memory_suggestion &&
          !SENSITIVE_MEMORY_PATTERN.test(full.data.memory_suggestion.content)
        ? full.data.memory_suggestion
        : null;
      return {
        reply: { ...full.data, memory_suggestion: safeMemory },
        structured: true,
        warning: null,
      };
    }
    const lenient = baseReply(parsed as Record<string, unknown>);
    if (lenient) {
      return {
        reply: lenient,
        structured: true,
        warning: "Question or optional fields were rejected; reply kept without them",
      };
    }
  }

  // The model answered, but not in the requested structure. Preserve the
  // answer instead of pretending it did not happen; attach conservative face
  // data and no question.
  const plain = cleaned
    .replace(/^assistant\s*:/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
  if (!plain) {
    return {
      reply: {
        reply: "I couldn't form a reply. Try again.",
        emotion: "confused",
        animation: "sway",
        intensity: 1,
        mood_delta: 0,
        ask_question: false,
        question: null,
        memory_suggestion: null,
      },
      structured: false,
      warning: "Empty AI response",
    };
  }
  return {
    reply: {
      reply: plain,
      emotion: "normal",
      animation: "none",
      intensity: 1,
      mood_delta: 0,
      ask_question: false,
      question: null,
      memory_suggestion: null,
    },
    structured: false,
    warning: "AI response was not valid structured JSON; displayed as plain text",
  };
}

export function normalizeEmotion(value: unknown): string {
  return emotionSchema.safeParse(value).success ? String(value) : "normal";
}

export function normalizeAnimation(value: unknown): string {
  return animationSchema.safeParse(value).success ? String(value) : "none";
}
