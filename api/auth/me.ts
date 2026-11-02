import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../../lib/db";
import { requireUser } from "../../lib/auth";
import { errorResponse, json, HttpError } from "../../lib/http";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "OPTIONS") {
      res.setHeader("Allow", "GET, OPTIONS");
      return res.status(204).end();
    }
    if (req.method !== "GET") {
      throw new HttpError(405, "method_not_allowed", "Use GET");
    }
    const q = getDb();
    const user = await requireUser(q, req);
    json(res, 200, { user: { id: user.id, email: user.email } });
  } catch (err) {
    errorResponse(res, err);
  }
}
