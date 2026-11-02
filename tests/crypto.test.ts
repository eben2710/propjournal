import { describe, it, expect, beforeAll } from "vitest";
import { encryptSecret, decryptSecret, sha256Hex } from "../lib/crypto";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "dGhpcy1pcy1hLTMyLWJ5dGUta2V5LWZvci10ZXN0cyEhIQ==";
});

describe("token encryption", () => {
  it("round-trips a secret", () => {
    const secret = "access-token-abc-123";
    const enc = encryptSecret(secret);
    expect(enc).toMatch(/^v1\./);
    expect(enc).not.toContain(secret);
    expect(decryptSecret(enc)).toBe(secret);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("fails when ciphertext is tampered with", () => {
    const enc = encryptSecret("sensitive");
    const parts = enc.split(".");
    const ct = Buffer.from(parts[3], "base64");
    ct[0] = ct[0] ^ 0xff;
    parts[3] = ct.toString("base64");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("rejects malformed payloads", () => {
    expect(() => decryptSecret("not-encrypted")).toThrow();
    expect(() => decryptSecret("v1.abc.def")).toThrow();
  });

  it("accepts non-base64 key material by hashing", () => {
    process.env.ENCRYPTION_KEY = "a plain long passphrase";
    const enc = encryptSecret("x");
    expect(decryptSecret(enc)).toBe("x");
  });
});

describe("sha256Hex", () => {
  it("is deterministic and hex", () => {
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
    expect(sha256Hex("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});
