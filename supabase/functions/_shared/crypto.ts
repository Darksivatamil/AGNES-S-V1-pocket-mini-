import { ApiError } from "./http.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function randomHex(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomPairingCode(): string {
  // Crockford-style alphabet, no ambiguous characters. 10 chars ~ 49 bits.
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let raw = "";
  for (const byte of bytes) raw += alphabet[byte % alphabet.length];
  return `AGN-${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export function normalizePairingCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function keyMaterial(): Uint8Array {
  const raw = Deno.env.get("AGNES_CREDENTIAL_ENC_KEY") ?? "";
  if (!raw) {
    throw new ApiError(
      "server_misconfigured",
      "AGNES_CREDENTIAL_ENC_KEY is not configured; provider keys cannot be stored",
      500,
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(raw);
  } catch {
    throw new ApiError("server_misconfigured", "AGNES_CREDENTIAL_ENC_KEY is not valid base64", 500);
  }
  if (bytes.length !== 32) {
    throw new ApiError(
      "server_misconfigured",
      "AGNES_CREDENTIAL_ENC_KEY must decode to exactly 32 bytes",
      500,
    );
  }
  return bytes;
}

async function importAesKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    asArrayBuffer(keyMaterial()),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptSecret(
  plaintext: string,
  userId: string,
  provider: string,
): Promise<{ ciphertext: string; iv: string; keyVersion: number }> {
  const key = await importAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = encoder.encode(`agnes:v1:${userId}:${provider}`);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asArrayBuffer(iv), additionalData: asArrayBuffer(aad) },
    key,
    asArrayBuffer(encoder.encode(plaintext)),
  );
  return {
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    iv: toBase64(iv),
    keyVersion: 1,
  };
}

export async function decryptSecret(
  ciphertextB64: string,
  ivB64: string,
  userId: string,
  provider: string,
): Promise<string> {
  const key = await importAesKey();
  const aad = encoder.encode(`agnes:v1:${userId}:${provider}`);
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asArrayBuffer(fromBase64(ivB64)),
        additionalData: asArrayBuffer(aad),
      },
      key,
      asArrayBuffer(fromBase64(ciphertextB64)),
    );
    return decoder.decode(plaintext);
  } catch {
    throw new ApiError(
      "credential_decrypt_failed",
      "Stored provider credential could not be decrypted; re-save it in Model Center",
      500,
    );
  }
}
