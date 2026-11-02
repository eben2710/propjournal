import { describe, it, expect } from "vitest";

describe.skipIf(!process.env.DATABASE_URL_TEST)(
  "database integration (requires DATABASE_URL_TEST)",
  () => {
    let q: any;
    let userIdA: string;
    let userIdB: string;
    let sessionCookieA: string;
    let tradeId: string;

  it("sets up isolated users", async () => {
    const { getDb } = await import("../lib/db");
      const { createUser } = await import("../lib/auth");
      q = getDb();
      const a = await createUser(q, `a-${Date.now()}@test.local`, "password123");
      const b = await createUser(q, `b-${Date.now()}@test.local`, "password123");
      userIdA = a.id;
      userIdB = b.id;
      expect(userIdA).not.toBe(userIdB);
    });

    it("creates and lists trades scoped to the owner", async () => {
      const rows = await q(
        `INSERT INTO trades (user_id, source, external_ref, trade_date, symbol, dir, lots, pnl)
         VALUES ($1, 'local', 'mig-1', '2026-01-05', 'EURUSD', 'buy', 0.5, 120)
         RETURNING id`,
        [userIdA]
      );
      tradeId = rows[0].id;
      const list = await q(`SELECT * FROM trades WHERE user_id = $1`, [userIdA]);
      expect(list).toHaveLength(1);
      const listB = await q(`SELECT * FROM trades WHERE user_id = $1`, [userIdB]);
      expect(listB).toHaveLength(0);
    });

    it("dedupes on (user, source, external_ref)", async () => {
      const rows = await q(
        `INSERT INTO trades (user_id, source, external_ref, trade_date, symbol, dir, pnl)
         VALUES ($1, 'local', 'mig-1', '2026-01-05', 'EURUSD', 'buy', 120)
         ON CONFLICT (user_id, source, external_ref) WHERE external_ref IS NOT NULL
         DO NOTHING RETURNING id`,
        [userIdA]
      );
      expect(rows).toHaveLength(0);
    });

    it("blocks cross-owner trade modification", async () => {
      const rows = await q(
        `UPDATE trades SET pnl = 999 WHERE id = $1 AND user_id = $2 RETURNING id`,
        [tradeId, userIdB]
      );
      expect(rows).toHaveLength(0);
    });

    it("deletes a cTrader connection without touching journal trades", async () => {
      const conn = await q(
        `INSERT INTO ctrader_connections (user_id, ctid_trader_account_id, access_token_enc, refresh_token_enc, token_expires_at, is_live)
         VALUES ($1, 999, 'enc', 'enc', now() + interval '1 day', false) RETURNING id`,
        [userIdA]
      );
      const del = await q(`DELETE FROM ctrader_connections WHERE id = $1 RETURNING id`, [conn[0].id]);
      expect(del).toHaveLength(1);
      const trades = await q(`SELECT * FROM trades WHERE user_id = $1`, [userIdA]);
      expect(trades.length).toBeGreaterThan(0);
    });

    it("cascades trades when a user is deleted", async () => {
      await q(`DELETE FROM users WHERE id = $1`, [userIdA]);
      const left = await q(`SELECT * FROM trades WHERE user_id = $1`, [userIdA]);
      expect(left).toHaveLength(0);
      await q(`DELETE FROM users WHERE id = $1`, [userIdB]);
    });
  }
);
