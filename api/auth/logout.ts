import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../../lib/db";
import { clearSessionCookie, destroySession } from "../../lib/auth";
import { errorResponse, json, HttpError } from "../../lib/http";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "OPTIONS") {
      res.setHeader("Allow", "POST, OPTIONS");
      return res.status(204).end();
    }
    if (req.method !== "POST") {
      throw new HttpError(405, "method_not_allowed", "Use POST");
    }
    const q = getDb();
    await destroySession(q, req);
    res.setHeader("Set-Cookie", clearSessionCookie());
    json(res, 200, { ok: true });
  } catch (err) {
    errorResponse(res, err);
  }
}
