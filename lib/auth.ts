import type { Query, Row } from "./db";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { HttpError, parseCookies } from "./http";

export const SESSION_COOKIE = "pj_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 3600;

export function newSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createUser(q: Query, email: string, password: string): Promise<Row> {
  const hash = await bcrypt.hash(password, 11);
  const rows = await q(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at`,
    [email, hash]
  );
  return rows[0];
}

export async function createSession(q: Query, userId: string, userAgent?: string): Promise<string> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await q(
    `INSERT INTO sessions (user_id, token_hash, user_agent, expires_at) VALUES ($1, $2, $3, $4)`,
    [userId, hashSessionToken(token), userAgent ?? null, expiresAt]
  );
  return token;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function requireUser(q: Query, req: any): Promise<Row> {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    throw new HttpError(401, "unauthenticated", "Sign in required");
  }
  const rows = await q(
    `SELECT u.id, u.email, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashSessionToken(token)]
  );
  if (!rows.length) {
    throw new HttpError(401, "unauthenticated", "Session invalid or expired");
  }
  return rows[0];
}

export async function destroySession(q: Query, req: any): Promise<void> {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return;
  await q(`DELETE FROM sessions WHERE token_hash = $1`, [hashSessionToken(token)]);
}

export async function verifyPassword(q: Query, email: string, password: string): Promise<Row> {
  const rows = await q(`SELECT id, email, password_hash FROM users WHERE email = $1`, [email]);
  if (!rows.length) {
    throw new HttpError(401, "invalid_credentials", "Email or password is incorrect");
  }
  const ok = await bcrypt.compare(password, rows[0].password_hash);
  if (!ok) {
    throw new HttpError(401, "invalid_credentials", "Email or password is incorrect");
  }
  return rows[0];
}
