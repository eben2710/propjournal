import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../db";
import { createUser, createSession, sessionCookie, clearSessionCookie, destroySession, requireUser, verifyPassword } from "../auth";
import { registerSchema, loginSchema } from "../validate";
import { errorResponse, json, readJson, clientIp, originAllowed, HttpError } from "../http";
import { audit } from "../audit";
import { rateLimit } from "../ratelimit";
import type { Row } from "../db";

export async function handleAuth(
  req: VercelRequest,
  res: VercelResponse,
  args: string[]
): Promise<void> {
  const action = args[0] ?? "";
  try {
    if (req.method === "OPTIONS") {
      res.setHeader("Allow", "GET, POST, OPTIONS");
      res.status(204).end(); return;
    }
    if (!originAllowed(req)) {
      throw new HttpError(403, "bad_origin", "Cross-origin request rejected");
    }
    const q = getDb();

    if (action === "register" && req.method === "POST") {
      const ip = clientIp(req);
      if (!rateLimit(`register:${ip}`, 5, 15 * 60 * 1000)) {
        throw new HttpError(429, "rate_limited", "Too many sign-up attempts â€” try again later.");
      }
      const body = registerSchema.parse(await readJson(req));
      let user: Row;
      try {
        user = await createUser(q, body.email, body.password);
      } catch (err: any) {
        if (err?.code === "23505" || String(err?.message ?? "").includes("users_email_key")) {
          throw new HttpError(
            409,
            "email_taken",
            "An account with this email already exists â€” sign in instead."
          );
        }
        throw err;
      }
      const token = await createSession(q, user.id, String(req.headers["user-agent"] ?? ""));
      res.setHeader("Set-Cookie", sessionCookie(token));
      await audit(q, { userId: user.id, action: "user.register", ip });
      return json(res, 201, { user: { id: user.id, email: user.email } });
    }

    if (action === "login" && req.method === "POST") {
      const ip = clientIp(req);
      const body = loginSchema.parse(await readJson(req));
      if (!rateLimit(`login:${ip}`, 10, 15 * 60 * 1000)) {
        throw new HttpError(429, "rate_limited", "Too many sign-in attempts â€” try again later.");
      }
      let user: Row;
      try {
        user = await verifyPassword(q, body.email, body.password);
      } catch (err) {
        await audit(q, { action: "user.login_failed", detail: { email: body.email }, ip });
        throw err;
      }
      const token = await createSession(q, user.id, String(req.headers["user-agent"] ?? ""));
      await q(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
      res.setHeader("Set-Cookie", sessionCookie(token));
      await audit(q, { userId: user.id, action: "user.login", ip });
      return json(res, 200, { user: { id: user.id, email: user.email } });
    }

    if (action === "logout" && req.method === "POST") {
      await destroySession(q, req);
      res.setHeader("Set-Cookie", clearSessionCookie());
      return json(res, 200, { ok: true });
    }

    if (action === "me" && req.method === "GET") {
      const user = await requireUser(q, req);
      return json(res, 200, { user: { id: user.id, email: user.email } });
    }

    throw new HttpError(404, "not_found", `Unknown auth route: ${action}`);
  } catch (err) {
    errorResponse(res, err);
  }
}
