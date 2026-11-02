import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../../lib/db";
import { requireUser } from "../../lib/auth";
import { requiredEnv } from "../../lib/env";
import { errorResponse, json, readJson, clientIp, originAllowed, HttpError } from "../../lib/http";
import { audit } from "../../lib/audit";
import { importWindow, loadConnectionForUser } from "../../lib/ctrader/import";
import { CtraderApiError } from "../../lib/ctrader/protocol";

export const maxDuration = 60;

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
    const ctid = String(body.ctidTraderAccountId ?? "");
    if (!/^\d{1,15}$/.test(ctid)) {
      throw new HttpError(400, "invalid_input", "ctidTraderAccountId must be numeric");
    }
    const conn = await loadConnectionForUser(q, user.id, ctid);

    const toMs = body.toMs != null ? Number(body.toMs) : Date.now();
    const fromMs =
      body.fromMs != null
        ? Number(body.fromMs)
        : conn.last_sync_at
          ? Math.max(0, new Date(conn.last_sync_at).getTime() - 86_400_000)
          : 0;
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
      return json(res, 200, {
        imported: 0,
        skipped: 0,
        totalDeals: 0,
        lastTimestampMs: toMs,
        hasMore: false
      });
    }

    const deps = {
      clientId: requiredEnv("CTRADER_CLIENT_ID"),
      clientSecret: requiredEnv("CTRADER_CLIENT_SECRET")
    };
    const result = await importWindow(q, deps, conn, { fromMs, toMs });
    await audit(q, {
      userId: user.id,
      action: "ctrader.import",
      detail: { ctid, imported: result.imported, hasMore: result.hasMore },
      ip: clientIp(req)
    });
    json(res, 200, result);
  } catch (err: any) {
    if (err instanceof CtraderApiError) {
      return json(res, 502, {
        error: "ctrader_api",
        message:
          err.maintenanceEndMs && err.maintenanceEndMs > Date.now()
            ? `cTrader is under maintenance until ${new Date(err.maintenanceEndMs).toISOString().slice(0, 16).replace("T", " ")} UTC. Try again after that.`
            : err.retryAfterMs
              ? `cTrader rate limit reached — the import will slow down and continue. (${err.errorCode})`
              : `cTrader API error: ${err.errorCode}. ${err.message}`,
        retryAfterMs: err.retryAfterMs,
        maintenanceEndMs: err.maintenanceEndMs
      });
    }
    if (err?.code === "reauth_required" && err instanceof HttpError === false) {
      return json(res, 409, { error: "reauth_required", message: "Re-link this account in Settings." });
    }
    errorResponse(res, err);
  }
}
