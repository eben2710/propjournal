// PropJournal <-> cTrader bridge (Node.js, zero dependencies).
//
// Serves the trading journal at http://127.0.0.1:8787 and receives closed
// trades POSTed by the JournalBridge cBot running in cTrader.
//
// Run:  node ctrader_bridge.js
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const HOST = "127.0.0.1";
const PORT = 8787;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "ctrader-trades.json");
const JOURNAL = path.join(ROOT, "index.html");
const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function loadTrades() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch (e) { return []; }
}
function saveTrades(trades) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(trades, null, 2));
}
function normalize(t) {
  return {
    positionId: t.positionId == null ? null : t.positionId,
    closeTime: t.closeTime || "",
    symbol: t.symbol || "",
    dir: t.dir === "sell" ? "sell" : "buy",
    lots: t.lots == null ? null : t.lots,
    entry: t.entry == null ? null : t.entry,
    exit: t.exit == null ? null : t.exit,
    pnl: t.pnl == null ? null : t.pnl,
    label: t.label || "",
    comment: t.comment || ""
  };
}
function mergeTrades(incoming) {
  const trades = loadTrades();
  const index = new Map(trades.map((t, i) => [t.positionId + "|" + t.closeTime, i]));
  let added = 0;
  for (const raw of incoming) {
    const t = normalize(raw);
    const key = t.positionId + "|" + t.closeTime;
    if (index.has(key)) trades[index.get(key)] = t;
    else { index.set(key, trades.length); trades.push(t); added++; }
  }
  trades.sort((a, b) => String(a.closeTime).localeCompare(String(b.closeTime)));
  saveTrades(trades);
  return { added, total: trades.length };
}

function sendJSON(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, Object.assign({ "Content-Type": "application/json", "Content-Length": body.length }, BASE_HEADERS));
  res.end(body);
}

const server = http.createServer((req, res) => {
  const p = (req.url || "/").split("?")[0];

  if (req.method === "OPTIONS") {
    res.writeHead(204, BASE_HEADERS);
    return res.end();
  }

  if (req.method === "GET" && (p === "/" || p === "/index.html" || p === "/journal")) {
    fs.readFile(JOURNAL, (err, buf) => {
      if (err) return sendJSON(res, 404, { error: "trading-journal.html not found next to the bridge" });
      res.writeHead(200, Object.assign({ "Content-Type": "text/html; charset=utf-8", "Content-Length": buf.length }, BASE_HEADERS));
      res.end(buf);
    });
    return;
  }
  if (req.method === "GET" && p === "/api/trades") return sendJSON(res, 200, loadTrades());
  if (req.method === "GET" && p === "/api/health") return sendJSON(res, 200, { ok: true, trades: loadTrades().length });

  if (req.method === "POST" && p === "/api/trades") {
    const chunks = [];
    let size = 0;
    req.on("data", c => { size += c.length; if (size > 5e6) req.destroy(); else chunks.push(c); });
    req.on("end", () => {
      try {
        let data = JSON.parse(Buffer.concat(chunks).toString("utf8") || "[]");
        if (!Array.isArray(data)) data = [data];
        sendJSON(res, 200, Object.assign({ ok: true }, mergeTrades(data)));
      } catch (e) {
        sendJSON(res, 400, { ok: false, error: String((e && e.message) || e) });
      }
    });
    return;
  }
  sendJSON(res, 404, { error: "not found" });
});

server.on("error", e => {
  if (e.code === "EADDRINUSE") {
    console.log("Port 8787 busy - the bridge is probably already running. Open http://127.0.0.1:8787/");
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  console.log("PropJournal bridge running at http://" + HOST + ":" + PORT + "/");
  console.log("cBot must POST to:  http://" + HOST + ":" + PORT + "/api/trades");
  exec('start "" "http://' + HOST + ':' + PORT + '/"');
});
