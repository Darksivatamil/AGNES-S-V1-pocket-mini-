import { assertEquals } from "jsr:@std/assert@1";
import { commandRequestSchema, questionSchema, aiReplySchema } from "./validation.ts";

Deno.test("question schema requires exactly three unique options", () => {
  const good = questionSchema.safeParse({
    type: "choice",
    text: "What now?",
    options: [{ id: "a", label: "Chat" }, { id: "b", label: "Play" }, { id: "c", label: "Rest" }],
  });
  assertEquals(good.success, true);

  const tooFew = questionSchema.safeParse({
    type: "choice",
    text: "What now?",
    options: [{ id: "a", label: "Chat" }, { id: "b", label: "Play" }],
  });
  assertEquals(tooFew.success, false);

  const duplicateIds = questionSchema.safeParse({
    type: "choice",
    text: "What now?",
    options: [{ id: "a", label: "Chat" }, { id: "a", label: "Play" }, { id: "c", label: "Rest" }],
  });
  assertEquals(duplicateIds.success, false);
});

Deno.test("command request rejects unknown fields and types", () => {
  const requestId = crypto.randomUUID();
  const deviceId = crypto.randomUUID();
  const good = commandRequestSchema.safeParse({
    request_id: requestId,
    device_id: deviceId,
    type: "UPDATE_BRIGHTNESS",
    payload: { brightness: 120 },
  });
  assertEquals(good.success, true);

  const badType = commandRequestSchema.safeParse({
    request_id: requestId,
    device_id: deviceId,
    type: "EXEC_SHELL",
    payload: {},
  });
  assertEquals(badType.success, false);

  const extra = commandRequestSchema.safeParse({
    request_id: requestId,
    device_id: deviceId,
    type: "WIFI_RECONNECT",
    payload: {},
    shell: "reboot",
  });
  assertEquals(extra.success, false);
});

Deno.test("ai reply rejects out-of-range emotion/intensity", () => {
  const result = aiReplySchema.safeParse({
    reply: "Hello",
    emotion: "not-an-emotion",
    animation: "blink",
    intensity: 9,
    mood_delta: 0,
    ask_question: false,
    question: null,
  });
  assertEquals(result.success, false);
});
