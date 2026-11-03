import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { getDb } from "../db";
import { requireUser } from "../auth";
import { requiredEnv, appOrigin, isConfigured } from "../env";
import { parseCookies, errorResponse, json, readJson, clientIp, originAllowed, HttpError } from "../http";
import { encryptSecret } from "../crypto";
import { audit } from "../audit";
import {
  buildAuthorizeUrl,
  maskLogin,
  PT,
  CtraderApiError
} from "../ctrader/protocol";
import { CtraderClient } from "../ctrader/ws";
import { exchangeAuthorizationCode, maskConnection, type ConnectionRow } from "../ctrader/tokens";
import { importWindow, loadConnectionForUser } from "../ctrader/import";

const OAUTH_STATE_COOKIE = "pj_oauth_state";

function fail(res: VercelResponse, reason: string) {
  res.redirect(302, `/?ctrader=error&reason=${encodeURIComponent(reason)}`);
}

export async function handleCtrader(
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

    if (action === "start" && req.method === "GET") {
      const q = getDb();
      await requireUser(q, req);
      if (!isConfigured("CTRADER_CLIENT_ID") || !isConfigured("CTRADER_CLIENT_SECRET")) {
        throw new HttpError(
          501,
          "not_configured",
          "The server has no cTrader API credentials yet. The owner must register an app at openapi.ctrader.com and set CTRADER_CLIENT_ID / CTRADER_CLIENT_SECRET."
        );
      }
      const app = appOrigin();
      if (!app) {
        throw new HttpError(500, "not_configured", "APP_URL is not set on the server.");
      }
      const state = crypto.randomBytes(16).toString("hex");
      const redirectUri = `${app}/api/ctrader/callback`;
      const url = buildAuthorizeUrl(requiredEnv("CTRADER_CLIENT_ID"), redirectUri, state);
      res.setHeader(
        "Set-Cookie",
        `${OAUTH_STATE_COOKIE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
      );
      res.redirect(302, url);
      return;
    }

    if (action === "callback" && req.method === "GET") {
      return await callback(req, res);
    }

    if (action === "accounts" && req.method === "GET") {
      const q = getDb();
      const user = await requireUser(q, req);
      const rows = (await q(
        `SELECT * FROM ctrader_connections WHERE user_id = $1 ORDER BY granted_at`,
        [user.id]
      )) as unknown as ConnectionRow[];
      return json(res, 200, { accounts: rows.map(maskConnection) });
    }

    if (action === "import" && req.method === "POST") {
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
      return json(res, 200, result);
    }

    if (action === "disconnect" && req.method === "POST") {
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
      return json(res, 200, {
        disconnected: rows.length,
        note:
          "Stored access credentials were deleted. To revoke this app inside cTrader itself, visit https://id.ctrader.com/my/settings/openapi/grantingaccess/ and remove access."
      });
    }

    throw new HttpError(404, "not_found", `Unknown cTrader route: ${action}`);
  } catch (err: any) {
    if (err instanceof CtraderApiError) {
      const msg =
        err.maintenanceEndMs && err.maintenanceEndMs > Date.now()
          ? `cTrader is under maintenance until ${new Date(err.maintenanceEndMs).toISOString().slice(0, 16).replace("T", " ")} UTC. Try again after that.`
          : err.retryAfterMs
            ? `cTrader rate limit reached â€” the import will slow down and continue. (${err.errorCode})`
            : `cTrader API error: ${err.errorCode}. ${err.message}`;
      return json(res, 502, {
        error: "ctrader_api",
        message: msg,
        retryAfterMs: err.retryAfterMs,
        maintenanceEndMs: err.maintenanceEndMs
      });
    }
    errorResponse(res, err);
  }
}

async function callback(req: VercelRequest, res: VercelResponse): Promise<void> {
  const fail = (reason: string) => failRedirect(res, reason);
  try {
    const q = getDb();
    let user: any;
    try {
      user = await requireUser(q, req);
    } catch {
      return failRedirect(res, "Your session expired â€” sign in again, then connect cTrader.");
    }

    const cookies = parseCookies(req);
    const cookieState = cookies[OAUTH_STATE_COOKIE];
    const queryState = String(req.query.state ?? "");
    if (!cookieState || !queryState || cookieState !== queryState) {
      return failRedirect(
        res,
        "Authorization could not be verified (state mismatch). Start again from Settings."
      );
    }
    const code = String(req.query.code ?? "");
    if (!code) {
      return failRedirect(res, "cTrader did not return an authorization code. Start again from Settings.");
    }

    const clientId = requiredEnv("CTRADER_CLIENT_ID");
    const clientSecret = requiredEnv("CTRADER_CLIENT_SECRET");
    const redirectUri = `${appOrigin()}/api/ctrader/callback`;

    const tokens = await exchangeAuthorizationCode(
      q,
      { clientId, clientSecret },
      { code, redirectUri }
    );

    const client = await CtraderClient.connect({
      url: "wss://demo.ctraderapi.com:5035",
      clientId,
      clientSecret,
      requestTimeoutMs: 20000
    });
    let accounts: any[] = [];
    try {
      const res2: any = await client.request(PT.GET_ACCOUNT_LIST_BY_ACCESS_TOKEN_REQ, {
        accessToken: tokens.accessToken
      });
      accounts = Array.isArray(res2.ctidTraderAccount) ? res2.ctidTraderAccount : [];
    } finally {
      await client.close();
    }
    if (!accounts.length) {
      return failRedirect(res, "No cTrader accounts were granted â€” approve at least one account and try again.");
    }

    const accessTokenEnc = encryptSecret(tokens.accessToken);
    const refreshTokenEnc = encryptSecret(tokens.refreshToken);
    const expiresAt = tokens.expiresAt.toISOString();

    for (const a of accounts) {
      const ctid = String(a.ctidTraderAccountId);
      await q(
        `INSERT INTO ctrader_connections
           (user_id, ctid_trader_account_id, access_token_enc, refresh_token_enc, token_expires_at,
            status, broker_title, trader_login, is_live)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8)
         ON CONFLICT (user_id, ctid_trader_account_id) DO UPDATE SET
           access_token_enc = EXCLUDED.access_token_enc,
           refresh_token_enc = EXCLUDED.refresh_token_enc,
           token_expires_at = EXCLUDED.token_expires_at,
           status = 'active',
           broker_title = EXCLUDED.broker_title,
           trader_login = EXCLUDED.trader_login,
           is_live = EXCLUDED.is_live`,
        [
          user.id,
          ctid,
          accessTokenEnc,
          refreshTokenEnc,
          expiresAt,
          a.brokerTitleShort ?? null,
          a.traderLogin != null ? String(a.traderLogin) : null,
          !!a.isLive
        ]
      );
    }

    await audit(q, {
      userId: user.id,
      action: "ctrader.connect",
      detail: { accounts: accounts.length }
    });

    res.setHeader(
      "Set-Cookie",
      `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
    );
    res.redirect(302, `/?ctrader=connected&accounts=${accounts.length}`);
  } catch (err: any) {
    console.error("ctrader callback failed:", err?.message ?? err);
    try {
      await audit(getDb(), {
        action: "ctrader.connect_failed",
        detail: { message: String(err?.message ?? err).slice(0, 300) }
      });
    } catch {}
    failRedirect(
      res,
      err?.code === "ctrader_token_rejected"
        ? "cTrader rejected the authorization (codes expire after 1 minute). Start again."
        : "Could not complete the cTrader connection. Start again from Settings."
    );
  }
}

function failRedirect(res: VercelResponse, reason: string): void {
  res.redirect(302, `/?ctrader=error&reason=${encodeURIComponent(reason)}`);
}
