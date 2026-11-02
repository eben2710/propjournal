import { describe, it, expect } from "vitest";
import { aggregateDeals } from "../lib/ctrader/import";

const ACC = "123456";
const names = (id: number) => (id === 5 ? "EURUSD" : "#" + id);
const lotSize = (id: number) => (id === 5 ? 10_000_000 : null);

const entryDeal = (over: Partial<any> = {}) =>
  Object.assign(
    {
      dealId: 1,
      orderId: 1,
      positionId: 100,
      symbolId: 5,
      volume: 2_000_000,
      filledVolume: 2_000_000,
      tradeSide: 1,
      dealActionType: 2,
      executionTimestamp: 1_700_000_000_000,
      executionPrice: 1.08,
      moneyDigits: 2
    },
    over
  );

const closeDeal = (over: Partial<any> = {}) =>
  Object.assign(
    {
      dealId: 2,
      orderId: 2,
      positionId: 100,
      symbolId: 5,
      volume: 2_000_000,
      filledVolume: 2_000_000,
      tradeSide: 2,
      dealActionType: 2,
      executionTimestamp: 1_700_086_400_000,
      executionPrice: 1.085,
      moneyDigits: 2,
      closePositionDetail: {
        entryPrice: 1.08,
        grossProfit: 50_000,
        swap: -200,
        commission: -800,
        closedVolume: 2_000_000,
        moneyDigits: 2
      }
    },
    over
  );

describe("aggregateDeals", () => {
  it("builds one journal trade per closed position with net pnl", () => {
    const { trades, skippedOpen } = aggregateDeals([entryDeal(), closeDeal()], ACC, names, lotSize);
    expect(skippedOpen).toBe(0);
    expect(trades).toHaveLength(1);
    const t = trades[0];
    expect(t.ext).toBe("123456#100");
    expect(t.symbol).toBe("EURUSD");
    expect(t.dir).toBe("buy");
    expect(t.lots).toBe(0.2);
    expect(t.entry).toBe(1.08);
    expect(t.exit).toBe(1.085);
    expect(t.pnl).toBe(490);
    expect(t.tradeDate).toBe(new Date(1_700_086_400_000).toISOString().slice(0, 10));
  });

  it("skips open positions (no closing deal)", () => {
    const { trades, skippedOpen } = aggregateDeals([entryDeal()], ACC, names, lotSize);
    expect(trades).toHaveLength(0);
    expect(skippedOpen).toBe(1);
  });

  it("filters non-filled deals (deposits, swaps)", () => {
    const deposit = Object.assign(entryDeal(), { dealId: 9, dealActionType: 6, positionId: 0 });
    const { trades } = aggregateDeals([deposit, entryDeal(), closeDeal()], ACC, names, lotSize);
    expect(trades).toHaveLength(1);
  });

  it("aggregates multiple partial closes into one trade with VWAP exit", () => {
    const c1 = closeDeal({
      dealId: 2,
      filledVolume: 1_000_000,
      executionPrice: 1.084,
      closePositionDetail: Object.assign({}, closeDeal().closePositionDetail, {
        closedVolume: 1_000_000,
        grossProfit: 20_000
      })
    });
    const c2 = closeDeal({
      dealId: 3,
      filledVolume: 1_000_000,
      executionTimestamp: 1_700_095_000_000,
      executionPrice: 1.086,
      closePositionDetail: Object.assign({}, closeDeal().closePositionDetail, {
        closedVolume: 1_000_000,
        grossProfit: 30_000
      })
    });
    const { trades } = aggregateDeals([entryDeal(), c1, c2], ACC, names, lotSize);
    expect(trades).toHaveLength(1);
    const t = trades[0];
    expect(t.exit).toBe(1.085);
    expect(t.pnl).toBe((20_000 - 200 - 800 + 30_000 - 200 - 800) / 100);
  });

  it("derives direction from the closing side when only closing deals are present", () => {
    const onlyClose = closeDeal(); // tradeSide SELL(2) closing a LONG? no: closing side SELL means position was BUY
    const { trades } = aggregateDeals([onlyClose], ACC, names, lotSize);
    expect(trades[0].dir).toBe("buy");
    const onlyCloseSell = closeDeal({ tradeSide: 1 }); // closing with BUY means position was SELL
    const { trades: t2 } = aggregateDeals([onlyCloseSell], ACC, names, lotSize);
    expect(t2[0].dir).toBe("sell");
  });

  it("uses symbol id placeholder when the symbol name is unknown", () => {
    const { trades } = aggregateDeals(
      [entryDeal({ symbolId: 777 }), closeDeal({ symbolId: 777 })],
      ACC,
      names,
      lotSize
    );
    expect(trades[0].symbol).toBe("#777");
  });
});
