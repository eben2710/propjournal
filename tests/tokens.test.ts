import { describe, it, expect, beforeAll } from "vitest";
import { refreshConnectionTokens, getFreshAccessToken } from "../lib/ctrader/tokens";
import { encryptSecret, decryptSecret } from "../lib/crypto";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "dGhpcy1pcy1hLTMyLWJ5dGUta2V5LWZvci10ZXN0cyEhIQ==";
});

const CONN = () => ({
  id: "11111111-1111-1111-1111-111111111111",
  user_id: "22222222-2222-2222-2222-222222222222",
  ctid_trader_account_id: "123456",
  access_token_enc: encryptSecret("oldAT"),
  refresh_token_enc: encryptSecret("oldRT"),
  token_expires_at: new Date(Date.now() - 1000).toISOString(),
  status: "active",
  broker_title: "TestBroker",
  trader_login: "5211234",
  is_live: false,
  granted_at: new Date().toISOString(),
  last_sync_at: null
});

const DEPS = { clientId: "cid", clientSecret: "secret" };

function makeFakeQ(state: { row: any; claimCount: number; fetchCalls: number }) {
  return async (text: string, params: any[] = []) => {
    if (text.includes("RETURNING id") && text.includes("token_expires_at = $2")) {
      state.claimCount += 1;
      if (state.claimCount === 1) {
        state.row.token_expires_at = params[1];
        return [{ id: state.row.id }];
      }
      return [];
    }
    if (text.includes("status = 'reauth_required'")) {
      state.row.status = "reauth_required";
      return [];
    }
    if (text.includes("access_token_enc = $2")) {
      state.row.access_token_enc = params[1];
      state.row.refresh_token_enc = params[2];
      state.row.token_expires_at = params[3];
      state.row.status = "active";
      return [];
    }
    if (text.startsWith("SELECT access_token_enc")) {
      return [
        {
          access_token_enc: state.row.access_token_enc,
          token_expires_at: state.row.token_expires_at,
          status: state.row.status
        }
      ];
    }
    if (text.includes("SELECT u.id, u.email")) return [{ id: state.row.user_id, email: "x@y.z" }];
    return [];
  };
}

function makeFakeFetch(state: { fetchCalls: number }, fail = false) {
  return (async () => {
    state.fetchCalls += 1;
    if (fail) {
      return { json: async () => ({ errorCode: "REFRESH_FAILED", description: "revoked" }) };
    }
    return {
      json: async () => ({ accessToken: "newAT", refreshToken: "newRT", expiresIn: 2628000 })
    };
  }) as unknown as typeof fetch;
}

describe("refreshConnectionTokens", () => {
  it("rotates both tokens via a single upstream call", async () => {
    const state = { row: CONN(), claimCount: 0, fetchCalls: 0 };
    const q = makeFakeQ(state);
    const pair = await refreshConnectionTokens(q, { ...DEPS, fetchImpl: makeFakeFetch(state) }, state.row);
    expect(state.fetchCalls).toBe(1);
    expect(pair.accessToken).toBe("newAT");
    expect(pair.refreshToken).toBe("newRT");
    expect(decryptSecret(String(state.row.access_token_enc))).toBe("newAT");
    expect(decryptSecret(String(state.row.refresh_token_enc))).toBe("newRT");
  });

  it("single-flights concurrent refreshes (one upstream call, both get the token)", async () => {
    const state = { row: CONN(), claimCount: 0, fetchCalls: 0 };
    const q = makeFakeQ(state);
    const [a, b] = await Promise.all([
      refreshConnectionTokens(q, { ...DEPS, fetchImpl: makeFakeFetch(state) }, { ...state.row }),
      refreshConnectionTokens(q, { ...DEPS, fetchImpl: makeFakeFetch(state) }, { ...state.row })
    ]);
    expect(state.fetchCalls).toBe(1);
    expect(a.accessToken).toBe("newAT");
    expect(b.accessToken).toBe("newAT");
  });

  it("marks the connection reauth_required when cTrader rejects the refresh", async () => {
    const state = { row: CONN(), claimCount: 0, fetchCalls: 0 };
    const q = makeFakeQ(state);
    await expect(
      refreshConnectionTokens(q, { ...DEPS, fetchImpl: makeFakeFetch(state, true) }, state.row)
    ).rejects.toMatchObject({ code: "reauth_required" });
    expect(state.row.status).toBe("reauth_required");
  });
});

describe("getFreshAccessToken", () => {
  it("returns the stored token without refreshing while it is still fresh", async () => {
    const conn = CONN();
    conn.token_expires_at = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
    const state = { row: conn, claimCount: 0, fetchCalls: 0 };
    const q = makeFakeQ(state);
    const token = await getFreshAccessToken(q, { ...DEPS, fetchImpl: makeFakeFetch(state) }, conn);
    expect(token).toBe("oldAT");
    expect(state.fetchCalls).toBe(0);
  });

  it("throws reauth_required for a revoked connection", async () => {
    const conn = CONN();
    conn.status = "reauth_required";
    const state = { row: conn, claimCount: 0, fetchCalls: 0 };
    await expect(
      getFreshAccessToken(makeFakeQ(state), { ...DEPS, fetchImpl: makeFakeFetch(state) }, conn)
    ).rejects.toMatchObject({ code: "reauth_required" });
  });
});
