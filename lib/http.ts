import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sha256Hex } from "./crypto";

export class HttpError extends Error {
  status: number;
  code: string;
  extra?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function json(
  res: VercelResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  for (const [k, v] of Object.entries(headers)) {
    res.setHeader(k, v);
  }
  res.status(status).json(body);
}

export function errorResponse(res: VercelResponse, err: unknown): void {
  if (err instanceof HttpError) {
    json(res, err.status, { error: err.code, message: err.message, ...(err.extra ?? {}) });
    return;
  }
  const anyErr = err as any;
  if (anyErr && anyErr.name === "ZodError" && Array.isArray(anyErr.issues)) {
    json(res, 400, { error: "invalid_input", message: anyErr.issues[0]?.message ?? "Invalid input" });
    return;
  }
  console.error("Unhandled error:", err);
  json(res, 500, { error: "internal", message: "Unexpected server error" });
}

export async function readJson(req: VercelRequest): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 2_000_000) {
      throw new HttpError(413, "payload_too_large", "Request body too large");
    }
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid_json", "Request body is not valid JSON");
  }
}

export function parseCookies(req: VercelRequest): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function clientIp(req: VercelRequest): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) {
    return fwd.split(",")[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

export function ipHash(ip: string): string {
  return sha256Hex(ip + (process.env.SESSION_SECRET || "pj")).slice(0, 16);
}

export function originAllowed(req: VercelRequest): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const app = (process.env.APP_URL || "").replace(/\/+$/, "");
  if (!app) return true;
  return origin.replace(/\/+$/, "") === app;
}
