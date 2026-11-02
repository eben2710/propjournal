import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../../lib/db";
import { requireUser } from "../../lib/auth";
import { errorResponse, json, readJson, clientIp, originAllowed, HttpError } from "../../lib/http";
import { audit } from "../../lib/audit";

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
    const q = getDb();
    const user = await requireUser(q, req);
    const body = await readJson(req);
    const all = body.all === true;
    const ctid = body.ctidTraderAccountId != null ? String(body.ctidTraderAccountId) : null;
    if (!all && !/^\d{1,15}$/.test(ctid ?? "")) {
      throw new HttpError(400, "invalid_input", "Provide ctidTraderAccountId or all=true");
    }

    const rows = all
      ? await q(
          `DELETE FROM ctrader_connections WHERE user_id = $1 RETURNING ctid_trader_account_id`,
          [user.id]
        )
      : await q(
          `DELETE FROM ctrader_connections WHERE user_id = $1 AND ctid_trader_account_id = $2 RETURNING ctid_trader_account_id`,
          [user.id, ctid]
        );

    await audit(q, {
      userId: user.id,
      action: "ctrader.disconnect",
      detail: { count: rows.length, all },
      ip: clientIp(req)
    });
    json(res, 200, {
      disconnected: rows.length,
      note:
        "Stored access credentials were deleted. To revoke this app inside cTrader itself, visit https://id.ctrader.com/my/settings/openapi/grantingaccess/ and remove access."
    });
  } catch (err) {
    errorResponse(res, err);
  }
}
