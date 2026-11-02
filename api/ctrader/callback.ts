import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../../lib/db";
import { requireUser } from "../../lib/auth";
import { requiredEnv, appOrigin } from "../../lib/env";
import { parseCookies } from "../../lib/http";
import { encryptSecret } from "../../lib/crypto";
import { audit } from "../../lib/audit";
import { exchangeAuthorizationCode } from "../../lib/ctrader/tokens";
import { CtraderClient, OAUTH_STATE_COOKIE } from "../../lib/ctrader/ws";
import { PT } from "../../lib/ctrader/protocol";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const fail = (reason: string) =>
    res.redirect(302, `/?ctrader=error&reason=${encodeURIComponent(reason)}`);

  try {
    if (req.method !== "GET") {
      return fail("Unexpected request method");
    }
    const q = getDb();
    let user: any;
    try {
      user = await requireUser(q, req);
    } catch {
      return fail("Your session expired — sign in again, then connect cTrader.");
    }

    const cookies = parseCookies(req);
    const cookieState = cookies[OAUTH_STATE_COOKIE];
    const queryState = String(req.query.state ?? "");
    if (!cookieState || !queryState || cookieState !== queryState) {
      return fail("Authorization could not be verified (state mismatch). Start again from Settings.");
    }
    const code = String(req.query.code ?? "");
    if (!code) {
      return fail("cTrader did not return an authorization code. Start again from Settings.");
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
      const res: any = await client.request(PT.GET_ACCOUNT_LIST_BY_ACCESS_TOKEN_REQ, {
        accessToken: tokens.accessToken
      });
      accounts = Array.isArray(res.ctidTraderAccount) ? res.ctidTraderAccount : [];
    } finally {
      await client.close();
    }
    if (!accounts.length) {
      return fail("No cTrader accounts were granted — approve at least one account and try again.");
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
    fail(
      err?.code === "ctrader_token_rejected"
        ? "cTrader rejected the authorization (codes expire after 1 minute). Start again."
        : "Could not complete the cTrader connection. Start again from Settings."
    );
  }
}
