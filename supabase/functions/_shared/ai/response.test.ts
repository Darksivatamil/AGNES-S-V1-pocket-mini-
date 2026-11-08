import { assertEquals } from "jsr:@std/assert@1";
import { parseAiReply } from "./response.ts";

const valid = {
  reply: "That's wonderful!",
  emotion: "excited",
  animation: "bounce",
  intensity: 2,
  mood_delta: 2,
  ask_question: true,
  question: {
    type: "choice",
    text: "How are you?",
    options: [
      { id: "good", label: "Good" },
      { id: "okay", label: "Okay" },
      { id: "bad", label: "Bad" },
    ],
  },
  memory_suggestion: { category: "preference", content: "Likes tea" },
};

Deno.test("parseAiReply accepts valid structured output", () => {
  const result = parseAiReply(JSON.stringify(valid));
  assertEquals(result.structured, true);
  assertEquals(result.reply.emotion, "excited");
  assertEquals(result.reply.question?.options.length, 3);
  assertEquals(result.reply.memory_suggestion?.content, "Likes tea");
});

Deno.test("parseAiReply strips markdown fences", () => {
  const result = parseAiReply("```json\n" + JSON.stringify(valid) + "\n```");
  assertEquals(result.structured, true);
  assertEquals(result.reply.reply, "That's wonderful!");
});

Deno.test("parseAiReply drops a question with the wrong number of options", () => {
  const invalidQuestion = {
    ...valid,
    question: {
      type: "choice",
      text: "Pick",
      options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    },
  };
  const result = parseAiReply(JSON.stringify(invalidQuestion));
  assertEquals(result.structured, true);
  assertEquals(result.reply.question, null);
  assertEquals(result.reply.ask_question, false);
  assertEquals(result.warning !== null, true);
});

Deno.test("parseAiReply keeps plain text answers without inventing structure", () => {
  const result = parseAiReply("Hello there, I am here.");
  assertEquals(result.structured, false);
  assertEquals(result.reply.reply, "Hello there, I am here.");
  assertEquals(result.reply.ask_question, false);
  assertEquals(result.reply.emotion, "normal");
});

Deno.test("parseAiReply rejects sensitive memory suggestions", () => {
  const sensitive = {
    ...valid,
    memory_suggestion: { category: "fact", content: "My password is hunter2" },
  };
  const result = parseAiReply(JSON.stringify(sensitive));
  assertEquals(result.reply.memory_suggestion, null);
});
