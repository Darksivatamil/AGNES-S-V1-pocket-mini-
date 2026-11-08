import { assertEquals } from "jsr:@std/assert@1";
import { decryptSecret, encryptSecret } from "./crypto.ts";

Deno.test("provider credential round-trips with AES-GCM and is user-bound", async () => {
  Deno.env.set("AGNES_CREDENTIAL_ENC_KEY", btoa(String.fromCharCode(...new Uint8Array(32).fill(7))));
  const encrypted = await encryptSecret("sk-or-v1-secret-value", "user-a", "openrouter");
  assertEquals(encrypted.ciphertext.length > 20, true);
  assertEquals(encrypted.iv.length > 8, true);
  const decrypted = await decryptSecret(
    encrypted.ciphertext,
    encrypted.iv,
    "user-a",
    "openrouter",
  );
  assertEquals(decrypted, "sk-or-v1-secret-value");

  let failed = false;
  try {
    await decryptSecret(encrypted.ciphertext, encrypted.iv, "user-b", "openrouter");
  } catch {
    failed = true;
  }
  assertEquals(failed, true);
});
