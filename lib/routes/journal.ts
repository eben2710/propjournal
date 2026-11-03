import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { getDb, type Row } from "../db";
import { requireUser } from "../auth";
import { tradeSchema, tradeBatchSchema, tradeUpdateSchema } from "../validate";
import { errorResponse, json, readJson, originAllowed, HttpError } from "../http";

function mapRow(r: Row) {
  const date =
    typeof r.trade_date === "string"
      ? r.trade_date.slice(0, 10)
      : new Date(r.trade_date).toISOString().slice(0, 10);
  return {
    id: r.id,
    source: r.source,
    ext: r.external_ref,
    date,
    symbol: r.symbol,
    dir: r.dir,
    lots: r.lots == null ? null : Number(r.lots),
    entry: r.entry_price == null ? null : Number(r.entry_price),
    exit: r.exit_price == null ? null : Number(r.exit_price),
    pnl: r.pnl == null ? null : Number(r.pnl),
    smartExit: !!r.smart_exit,
    notes: r.notes ?? ""
  };
}

export async function handleJournal(
  req: VercelRequest,
  res: VercelResponse,
  args: string[]
): Promise<void> {
  try {
    if (req.method === "OPTIONS") {
      res.setHeader("Allow", "GET, POST, PUT, DELETE, OPTIONS");
      res.status(204).end(); return;
    }
    if (!originAllowed(req)) {
      throw new HttpError(403, "bad_origin", "Cross-origin request rejected");
    }
    const q = getDb();
    const user = await requireUser(q, req);

    if (!args.length && req.method === "GET") {
      const rows = await q(
        `SELECT id, source, external_ref, trade_date, symbol, dir, lots, entry_price, exit_price, pnl, smart_exit, notes, created_at
           FROM trades WHERE user_id = $1
          ORDER BY trade_date DESC, created_at DESC`,
        [user.id]
      );
      return json(res, 200, { trades: rows.map(mapRow) });
    }

    if (!args.length && req.method === "POST") {
      const body = await readJson(req);
      if (body.trades) {
        const parsed = tradeBatchSchema.parse(body);
        let imported = 0;
        for (const t of parsed.trades) {
          const rows = await q(
            `INSERT INTO trades
               (user_id, source, external_ref, trade_date, symbol, dir, lots, entry_price, exit_price, pnl, smart_exit, notes)
             VALUES ($1, 'local', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (user_id, source, external_ref) WHERE external_ref IS NOT NULL
             DO NOTHING
             RETURNING id`,
            [
              user.id,
              t.ext ?? crypto.randomUUID(),
              t.date,
              t.symbol.toUpperCase(),
              t.dir,
              t.lots ?? null,
              t.entry ?? null,
              t.exit ?? null,
              t.pnl ?? null,
              t.smartExit ?? false,
              t.notes ?? null
            ]
          );
          if (rows.length) imported += 1;
        }
        return json(res, 200, { imported, skipped: parsed.trades.length - imported });
      }

      const t = tradeSchema.parse(body.trade ?? body);
      const ext = t.ext ?? crypto.randomUUID();
      const rows = await q(
        `INSERT INTO trades
           (user_id, source, external_ref, trade_date, symbol, dir, lots, entry_price, exit_price, pnl, smart_exit, notes)
         VALUES ($1, 'local', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (user_id, source, external_ref) WHERE external_ref IS NOT NULL
         DO UPDATE SET trade_date = EXCLUDED.trade_date, symbol = EXCLUDED.symbol, dir = EXCLUDED.dir,
              lots = EXCLUDED.lots, entry_price = EXCLUDED.entry_price, exit_price = EXCLUDED.exit_price,
              pnl = EXCLUDED.pnl, smart_exit = EXCLUDED.smart_exit, notes = EXCLUDED.notes, updated_at = now()
         RETURNING id, source, external_ref, trade_date, symbol, dir, lots, entry_price, exit_price, pnl, smart_exit, notes`,
        [
          user.id,
          ext,
          t.date,
          t.symbol.toUpperCase(),
          t.dir,
          t.lots ?? null,
          t.entry ?? null,
          t.exit ?? null,
          t.pnl ?? null,
          t.smartExit ?? false,
          t.notes ?? null
        ]
      );
      return json(res, 201, { trade: mapRow(rows[0]) });
    }

    const id = String(args[0] ?? "");
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

    throw new HttpError(405, "method_not_allowed", "Unsupported method for this route");
  } catch (err) {
    errorResponse(res, err);
  }
}
