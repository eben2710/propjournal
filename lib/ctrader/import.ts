import type { Query } from "../db";
import { HttpError } from "../http";
import { DEAL_ACTION_FILLED, PT, TRADE_SIDE_SELL } from "./protocol";
import { openAccountSession } from "./ws";
import { getFreshAccessToken, type ConnectionRow, type TokenDeps } from "./tokens";
import { sleep } from "./util";

const MAX_ROWS = 400;
const HISTORICAL_DELAY_MS = 250;
const MAX_UPSTREAM_PAGES = 40;
const DEFAULT_LOT_CENTS = 10_000_000;

export interface JournalTradeUpsert {
  tradeDate: string;
  symbol: string;
  dir: "buy" | "sell";
  lots: number | null;
  entry: number | null;
  exit: number | null;
  pnl: number | null;
  ext: string;
}

export interface ImportWindowResult {
  imported: number;
  skipped: number;
  totalDeals: number;
  lastTimestampMs: number;
  hasMore: boolean;
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function aggregateDeals(
  deals: any[],
  accountId: string | number,
  symbolName: (symbolId: number) => string,
  lotSize: (symbolId: number) => number | null
): { trades: JournalTradeUpsert[]; lastTimestampMs: number; skippedOpen: number } {
  const byPosition = new Map<string, any[]>();
  let lastTs = 0;

  for (const d of deals) {
    if (toNum(d.dealActionType) !== DEAL_ACTION_FILLED) continue;
    const posId = d.positionId == null ? "" : String(d.positionId);
    if (!posId || posId === "0") continue;
    const list = byPosition.get(posId) ?? [];
    list.push(d);
    byPosition.set(posId, list);
    lastTs = Math.max(lastTs, toNum(d.executionTimestamp));
  }

  const trades: JournalTradeUpsert[] = [];
  let skippedOpen = 0;

  for (const [posId, ds] of byPosition) {
    const closings = ds.filter((d) => d.closePositionDetail);
    if (!closings.length) {
      skippedOpen += 1;
      continue;
    }
    const symbolId = toNum(ds[0].symbolId);
    const symbol = symbolName(symbolId);

    const entryDeals = ds.filter((d) => !d.closePositionDetail);
    let dir: "buy" | "sell" = "buy";
    if (entryDeals.length) {
      dir = toNum(entryDeals[0].tradeSide) === TRADE_SIDE_SELL ? "sell" : "buy";
    } else {
      dir = toNum(closings[0].tradeSide) === TRADE_SIDE_SELL ? "buy" : "sell";
    }

    let entry: number | null = null;
    const detailEntry = toNum(closings[0].closePositionDetail?.entryPrice);
    if (detailEntry > 0) {
      entry = detailEntry;
    } else if (entryDeals.length) {
      const totalVol = entryDeals.reduce((s, d) => s + toNum(d.filledVolume), 0);
      if (totalVol > 0) {
        entry =
          entryDeals.reduce(
            (s, d) => s + toNum(d.executionPrice) * toNum(d.filledVolume),
            0
          ) / totalVol;
      }
    }

    const closedVolCents = closings.reduce(
      (s, d) => s + toNum(d.closePositionDetail?.closedVolume ?? d.filledVolume),
      0
    );
    const ls = lotSize(symbolId);
    const lots = Math.round((closedVolCents / (ls || DEFAULT_LOT_CENTS)) * 100) / 100;

    let exit: number | null = null;
    if (closedVolCents > 0) {
      const vwap = closings.reduce(
        (s, d) =>
          s +
          toNum(d.executionPrice) *
            toNum(d.closePositionDetail?.closedVolume ?? d.filledVolume),
        0
      ) / closedVolCents;
      exit = Math.round(vwap * 1e5) / 1e5;
    }

    let pnl = 0;
    for (const d of closings) {
      const c = d.closePositionDetail ?? {};
      const scale = Math.pow(10, toNum(c.moneyDigits ?? d.moneyDigits ?? 2));
      pnl +=
        (toNum(c.grossProfit) + toNum(c.swap) + toNum(c.commission ?? d.commission)) / scale;
    }
    pnl = Math.round(pnl * 100) / 100;

    const lastClose = closings.reduce((a, b) =>
      toNum(a.executionTimestamp) >= toNum(b.executionTimestamp) ? a : b
    );
    const ts = toNum(lastClose.executionTimestamp) || lastTs;
    const tradeDate = new Date(ts).toISOString().slice(0, 10);

    trades.push({
      tradeDate,
      symbol,
      dir,
      lots,
      entry: entry != null ? Math.round(entry * 1e5) / 1e5 : null,
      exit,
      pnl,
      ext: `${accountId}#${posId}`
    });
  }

  return { trades, lastTimestampMs: lastTs, skippedOpen };
}

async function loadSymbolMeta(
  client: any,
  conn: ConnectionRow,
  deals: any[]
): Promise<{ names: Map<number, string>; lotSizes: Map<number, number> }> {
  const names = new Map<number, string>();
  const lotSizes = new Map<number, number>();
  const ids = [...new Set(deals.map((d) => toNum(d.symbolId)).filter((n) => n > 0))];
  if (!ids.length) return { names, lotSizes };

  const accountId = String(conn.ctid_trader_account_id);
  try {
    const listRes: any = await client.request(PT.SYMBOLS_LIST_REQ, {
      ctidTraderAccountId: accountId
    });
    for (const s of listRes.lightSymbol ?? listRes.symbol ?? []) {
      names.set(toNum(s.symbolId), String(s.name ?? s.symbolName ?? `#${s.symbolId}`));
    }
  } catch {
    for (const id of ids) names.set(id, `#${id}`);
  }
  await sleep(HISTORICAL_DELAY_MS);

  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try {
      const res: any = await client.request(PT.SYMBOL_BY_ID_REQ, {
        ctidTraderAccountId: accountId,
        symbolId: chunk
      });
      for (const s of res.symbol ?? []) {
        if (s.lotSize != null) lotSizes.set(toNum(s.symbolId), toNum(s.lotSize));
      }
    } catch {
      for (const id of chunk) {
        if (!lotSizes.has(id)) lotSizes.set(id, DEFAULT_LOT_CENTS);
      }
    }
    if (i + 50 < ids.length) await sleep(HISTORICAL_DELAY_MS);
  }
  return { names, lotSizes };
}

export async function importWindow(
  q: Query,
  deps: TokenDeps,
  conn: ConnectionRow,
  opts: { fromMs: number; toMs?: number }
): Promise<ImportWindowResult> {
  const accessToken = await getFreshAccessToken(q, deps, conn);
  const client = await openAccountSession({
    isLive: !!conn.is_live,
    clientId: deps.clientId,
    clientSecret: deps.clientSecret,
    accessToken,
    ctidTraderAccountId: String(conn.ctid_trader_account_id)
  });

  try {
    const toMs = opts.toMs ?? Date.now();
    let cursor = Math.max(0, opts.fromMs);
    const seen = new Set<string>();
    const allDeals: any[] = [];
    let hasMore = true;
    let pages = 0;
    let serverHasMore = false;

    while (hasMore && pages < MAX_UPSTREAM_PAGES && cursor < toMs) {
      const res: any = await client.request(PT.DEAL_LIST_REQ, {
        ctidTraderAccountId: String(conn.ctid_trader_account_id),
        fromTimestamp: cursor,
        toTimestamp: toMs,
        maxRows: MAX_ROWS
      });
      pages += 1;
      const deals = Array.isArray(res.deal) ? res.deal : [];
      for (const d of deals) {
        const id = String(d.dealId);
        if (!seen.has(id)) {
          seen.add(id);
          allDeals.push(d);
        }
      }
      hasMore = !!res.hasMore;
      serverHasMore = hasMore;
      if (hasMore && deals.length) {
        const maxTs = deals.reduce((m: number, d: any) => Math.max(m, toNum(d.executionTimestamp)), 0);
        if (maxTs <= cursor) break;
        cursor = maxTs;
        await sleep(HISTORICAL_DELAY_MS);
      }
    }

    const { names, lotSizes } = await loadSymbolMeta(client, conn, allDeals);
    const { trades, lastTimestampMs } = aggregateDeals(
      allDeals,
      String(conn.ctid_trader_account_id),
      (id) => names.get(id) ?? `#${id}`,
      (id) => lotSizes.get(id) ?? null
    );

    let imported = 0;
    for (const t of trades) {
      const rows = await q(
        `INSERT INTO trades
           (user_id, source, external_ref, trade_date, symbol, dir, lots, entry_price, exit_price, pnl, notes)
         VALUES ($1, 'ctrader', $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (user_id, source, external_ref) WHERE external_ref IS NOT NULL
         DO NOTHING
         RETURNING id`,
        [
          conn.user_id,
          t.ext,
          t.tradeDate,
          t.symbol,
          t.dir,
          t.lots,
          t.entry,
          t.exit,
          t.pnl,
          `Imported from cTrader account ${conn.ctid_trader_account_id}`
        ]
      );
      if (rows.length) imported += 1;
    }

    await q(
      `UPDATE ctrader_connections
          SET last_sync_at = GREATEST(COALESCE(last_sync_at, to_timestamp(0)), $2)
        WHERE id = $1`,
      [conn.id, new Date(toMs).toISOString()]
    );

    const lastTs = allDeals.length ? lastTimestampMs : opts.fromMs;
    return {
      imported,
      skipped: trades.length - imported,
      totalDeals: allDeals.length,
      lastTimestampMs: serverHasMore && lastTs > opts.fromMs ? lastTs : toMs,
      hasMore: serverHasMore
    };
  } finally {
    await client.close();
  }
}

export async function loadConnectionForUser(
  q: Query,
  userId: string,
  ctidTraderAccountId: string | number
): Promise<ConnectionRow> {
  const rows: any[] = await q(
    `SELECT * FROM ctrader_connections WHERE user_id = $1 AND ctid_trader_account_id = $2`,
    [userId, String(ctidTraderAccountId)]
  );
  if (!rows.length) {
    throw new HttpError(404, "not_found", "No linked cTrader account with that ID");
  }
  return rows[0] as ConnectionRow;
}
