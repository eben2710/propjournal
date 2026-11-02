import { decryptSecret, encryptSecret } from "../crypto";
import { HttpError } from "../http";
import { maskLogin, TOKEN_ENDPOINT } from "./protocol";
import { sleep } from "./util";
import type { Query, Row } from "../db";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface ConnectionRow extends Row {
  id: string;
  user_id: string;
  ctid_trader_account_id: string | number;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: Date | string | null;
  status: string;
  broker_title: string | null;
  trader_login: string | null;
  is_live: boolean | null;
  granted_at: Date | string | null;
  last_sync_at: Date | string | null;
}

export interface TokenDeps {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}

const REFRESH_MARGIN_MS = 24 * 3600 * 1000;
const CLAIM_TTL_MS = 60_000;

export function maskConnection(row: ConnectionRow) {
  return {
    id: row.id,
    ctidTraderAccountId: String(row.ctid_trader_account_id),
    brokerTitle: row.broker_title ?? "—",
    loginMasked: maskLogin(row.trader_login),
    isLive: !!row.is_live,
    status: row.status,
    grantedAt: row.granted_at ?? null,
    lastSyncAt: row.last_sync_at ?? null
  };
}

async function tokenRequest(
  fetchImpl: typeof fetch,
  params: Record<string, string>
): Promise<TokenPair> {
  const url = TOKEN_ENDPOINT + "?" + new URLSearchParams(params).toString();
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { Accept: "application/json" }
    });
  } catch {
    throw new HttpError(
      502,
      "ctrader_unreachable",
      "Could not reach the cTrader token service. Check your connection and try again shortly."
    );
  }
  const data: any = await res.json().catch(() => ({}));
  if (!data.accessToken || data.errorCode) {
    throw new HttpError(
      401,
      "ctrader_token_rejected",
      data.description || "cTrader rejected the token request",
      { errorCode: data.errorCode ?? null }
    );
  }
  return {
    accessToken: String(data.accessToken),
    refreshToken: String(data.refreshToken),
    expiresAt: new Date(Date.now() + Number(data.expiresIn ?? 2628000) * 1000)
  };
}

export async function exchangeAuthorizationCode(
  q: Query,
  deps: TokenDeps,
  opts: { code: string; redirectUri: string }
): Promise<TokenPair> {
  return tokenRequest(deps.fetchImpl ?? fetch, {
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: deps.clientId,
    client_secret: deps.clientSecret
  });
}

export async function refreshConnectionTokens(
  q: Query,
  deps: TokenDeps,
  conn: ConnectionRow
): Promise<TokenPair> {
  if (!conn.refresh_token_enc) {
    throw new HttpError(409, "reauth_required", "No stored refresh token for this connection.");
  }
  const currentExpiresIso = conn.token_expires_at
    ? new Date(conn.token_expires_at).toISOString()
    : null;
  const claimed = await q(
    `UPDATE ctrader_connections
        SET token_expires_at = $2
      WHERE id = $1 AND token_expires_at IS NOT DISTINCT FROM $3
      RETURNING id`,
    [conn.id, new Date(Date.now() + CLAIM_TTL_MS).toISOString(), currentExpiresIso]
  );
  if (!claimed.length) {
    for (let i = 0; i < 10; i++) {
      await sleep(400);
      const rows: Row[] = await q(
        `SELECT access_token_enc, token_expires_at, status FROM ctrader_connections WHERE id = $1`,
        [conn.id]
      );
      if (!rows.length) break;
      if (rows[0].status === "reauth_required") {
        throw new HttpError(
          409,
          "reauth_required",
          "This cTrader connection was revoked or expired. Re-link it in Settings."
        );
      }
      const exp = rows[0].token_expires_at ? new Date(rows[0].token_expires_at).getTime() : 0;
      if (exp > Date.now() + REFRESH_MARGIN_MS) {
        return {
          accessToken: decryptSecret(String(rows[0].access_token_enc)),
          refreshToken: "",
          expiresAt: new Date(exp)
        };
      }
    }
    throw new HttpError(
      503,
      "refresh_contention",
      "Another request is refreshing this token — retry in a moment."
    );
  }

  let pair: TokenPair;
  try {
    pair = await tokenRequest(deps.fetchImpl ?? fetch, {
      grant_type: "refresh_token",
      refresh_token: decryptSecret(String(conn.refresh_token_enc)),
      client_id: deps.clientId,
      client_secret: deps.clientSecret
    });
  } catch (err) {
    await q(`UPDATE ctrader_connections SET status = 'reauth_required' WHERE id = $1`, [conn.id]);
    if (err instanceof HttpError) {
      throw new HttpError(
        409,
        "reauth_required",
        "cTrader revoked or expired this connection. Re-link the account to continue.",
        { cause: err.code }
      );
    }
    throw err;
  }

  await q(
    `UPDATE ctrader_connections
        SET access_token_enc = $2, refresh_token_enc = $3, token_expires_at = $4, status = 'active'
      WHERE id = $1`,
    [
      conn.id,
      encryptSecret(pair.accessToken),
      encryptSecret(pair.refreshToken),
      pair.expiresAt.toISOString()
    ]
  );
  return pair;
}

export async function getFreshAccessToken(
  q: Query,
  deps: TokenDeps,
  conn: ConnectionRow
): Promise<string> {
  if (conn.status === "reauth_required") {
    throw new HttpError(
      409,
      "reauth_required",
      "This cTrader connection needs to be re-linked. Open Settings → Connect cTrader."
    );
  }
  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (conn.access_token_enc && Date.now() < expiresAt - REFRESH_MARGIN_MS) {
    return decryptSecret(String(conn.access_token_enc));
  }
  const pair = await refreshConnectionTokens(q, deps, conn);
  return pair.accessToken;
}
