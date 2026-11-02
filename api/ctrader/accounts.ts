import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../../lib/db";
import { requireUser } from "../../lib/auth";
import { errorResponse, json, HttpError } from "../../lib/http";
import { maskConnection, type ConnectionRow } from "../../lib/ctrader/tokens";

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
    const rows = (await q(
      `SELECT * FROM ctrader_connections WHERE user_id = $1 ORDER BY granted_at`,
      [user.id]
    )) as unknown as ConnectionRow[];
    json(res, 200, { accounts: rows.map(maskConnection) });
  } catch (err) {
    errorResponse(res, err);
  }
}
