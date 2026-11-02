import crypto from "node:crypto";

function encryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("ENCRYPTION_KEY is not configured");
  }
  const direct = Buffer.from(raw, "base64");
  if (direct.length === 32) {
    return direct;
  }
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Invalid encrypted payload");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(parts[1], "base64")
  );
  decipher.setAuthTag(Buffer.from(parts[2], "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(parts[3], "base64")),
    decipher.final()
  ]).toString("utf8");
}

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}
