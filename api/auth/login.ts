import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../../lib/db";
import { loginSchema } from "../../lib/validate";
import { createSession, sessionCookie, verifyPassword } from "../../lib/auth";
import { errorResponse, json, readJson, clientIp, originAllowed, HttpError } from "../../lib/http";
import { audit } from "../../lib/audit";
import { rateLimit } from "../../lib/ratelimit";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "OPTIONS") {
      res.setHeader("Allow", "POST, OPTIONS");
      return res.status(204).end();
    }
    if (req.method !== "POST") {
      throw new HttpError(405, "method_not_allowed", "Use POST");
    }
    if (!originAllowed(req)) {
      throw new HttpError(403, "bad_origin", "Cross-origin request rejected");
    }
    const ip = clientIp(req);
    const body = loginSchema.parse(await readJson(req));
    if (!rateLimit(`login:${ip}`, 10, 15 * 60 * 1000)) {
      throw new HttpError(429, "rate_limited", "Too many sign-in attempts — try again later.");
    }
    const q = getDb();

    let user: any;
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
    json(res, 200, { user: { id: user.id, email: user.email } });
  } catch (err) {
    errorResponse(res, err);
  }
}
