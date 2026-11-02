import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../../lib/db";
import { registerSchema } from "../../lib/validate";
import { createUser, createSession, sessionCookie } from "../../lib/auth";
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
    if (!rateLimit(`register:${ip}`, 5, 15 * 60 * 1000)) {
      throw new HttpError(429, "rate_limited", "Too many sign-up attempts — try again later.");
    }
    const body = registerSchema.parse(await readJson(req));
    const q = getDb();

    let user: any;
    try {
      user = await createUser(q, body.email, body.password);
    } catch (err: any) {
      if (err?.code === "23505" || String(err?.message ?? "").includes("users_email_key")) {
        throw new HttpError(
          409,
          "email_taken",
          "An account with this email already exists — sign in instead."
        );
      }
      throw err;
    }

    const token = await createSession(q, user.id, String(req.headers["user-agent"] ?? ""));
    res.setHeader("Set-Cookie", sessionCookie(token));
    await audit(q, { userId: user.id, action: "user.register", ip });
    json(res, 201, { user: { id: user.id, email: user.email } });
  } catch (err) {
    errorResponse(res, err);
  }
}
