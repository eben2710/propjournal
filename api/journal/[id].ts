import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../../lib/db";
import { requireUser } from "../../lib/auth";
import { tradeUpdateSchema } from "../../lib/validate";
import { errorResponse, json, readJson, originAllowed, HttpError } from "../../lib/http";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "OPTIONS") {
      res.setHeader("Allow", "PUT, DELETE, OPTIONS");
      return res.status(204).end();
    }
    if (!originAllowed(req)) {
      throw new HttpError(403, "bad_origin", "Cross-origin request rejected");
    }
    const q = getDb();
    const user = await requireUser(q, req);
    const id = String(req.query.id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new HttpError(404, "not_found", "Trade not found");
    }

    if (req.method === "PUT") {
      const t = tradeUpdateSchema.parse(await readJson(req));
      const sets: string[] = [];
      const params: any[] = [id, user.id];
      const add = (col: string, value: unknown) => {
        params.push(value);
        sets.push(`${col} = $${params.length}`);
      };
      if (t.date !== undefined) add("trade_date", t.date);
      if (t.symbol !== undefined) add("symbol", t.symbol.toUpperCase());
      if (t.dir !== undefined) add("dir", t.dir);
      if (t.lots !== undefined) add("lots", t.lots);
      if (t.entry !== undefined) add("entry_price", t.entry);
      if (t.exit !== undefined) add("exit_price", t.exit);
      if (t.pnl !== undefined) add("pnl", t.pnl);
      if (t.smartExit !== undefined) add("smart_exit", t.smartExit);
      if (t.notes !== undefined) add("notes", t.notes);
      sets.push("updated_at = now()");
      if (sets.length === 1) {
        return json(res, 200, { ok: true });
      }
      const rows = await q(
        `UPDATE trades SET ${sets.join(", ")} WHERE id = $1 AND user_id = $2 RETURNING id`,
        params
      );
      if (!rows.length) {
        throw new HttpError(404, "not_found", "Trade not found");
      }
      return json(res, 200, { ok: true });
    }

    if (req.method === "DELETE") {
      const rows = await q(
        `DELETE FROM trades WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, user.id]
      );
      if (!rows.length) {
        throw new HttpError(404, "not_found", "Trade not found");
      }
      return json(res, 200, { ok: true });
    }

    throw new HttpError(405, "method_not_allowed", "Use PUT or DELETE");
  } catch (err) {
    errorResponse(res, err);
  }
}
