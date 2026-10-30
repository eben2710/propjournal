# PropJournal — cTrader Trading Journal Integration

[![Vercel Deployed](https://img.shields.io/badge/Deployed%20on-Vercel-000000?logo=vercel&logoColor=white)](https://prop-firm-risk-ledger.vercel.app/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![cTrader Automate](https://img.shields.io/badge/cTrader-Automate-00A8E8?logo=ctrader&logoColor=white)](https://ctrader.com/automate/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Automated synchronization of trading data from cTrader to your Prop Firm Risk Ledger journal.**  
> One-step challenge tracking, risk metrics, and performance analytics — all in real-time.

---

## 🎯 Overview

PropJournal bridges your **cTrader Automate** environment with a production-grade trading journal hosted on Vercel. The system consists of three components:

| Component | Technology | Purpose |
|-----------|------------|---------|
| **JournalBridge cBot** | C# (cAlgo) | Runs inside cTrader, detects closed trades, POSTs to local bridge |
| **Local Bridge Server** | Node.js (zero deps) | Receives trades, persists to JSON, serves journal UI at `http://127.0.0.1:8787` |
| **Vercel Journal App** | Vanilla JS + Chart.js | Hosted at `prop-firm-risk-ledger.vercel.app` — fetches data from local bridge via secure tunnel |

---

## 🏗 Architecture

```
┌─────────────────┐     HTTP POST      ┌─────────────────────┐
│   cTrader       │ ─────────────────▶ │  Local Bridge       │
│   (JournalBridge│  closed trades     │  (Node.js :8787)    │
│    cBot)        │                    │  - Receives trades  │
└─────────────────┘                    │  - Persists JSON    │
                                       │  - Serves index.html│
                                       └──────────┬──────────┘
                                                  │
                                                  │ ngrok / Cloudflare Tunnel
                                                  ▼
                                       ┌─────────────────────┐
                                       │  Vercel Deployment  │
                                       │  (prop-firm-risk-   │
                                       │   ledger.vercel.app)│
                                       │  - Fetches via API  │
                                       │  - Renders charts   │
                                       └─────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

- **cTrader Desktop** with Automate (Algo) tab access
- **Node.js 18+** installed
- **ngrok** or **Cloudflare Tunnel** for secure public HTTPS endpoint
- **Git** and **GitHub account**
- **Vercel account** (free tier works)

---

### Step 1: Clone & Install

```bash
git clone https://github.com/<your-username>/propjournal.git
cd propjournal
npm install  # Only needed if you add dependencies later (currently zero-dep)
```

### Step 2: Configure cTrader Bridge

1. Open **cTrader Desktop → Automate (Algo) tab**
2. Click **New → cBot** → Name it `JournalBridge`
3. Replace all code with contents of `ctrader-bot/JournalBridge.cs`
4. Click **Build** (F7) — ensure "Build succeeded"
5. Drag the bot onto **any chart** of the account you want to journal
6. In the parameters panel:
   - **Bridge URL**: `http://127.0.0.1:8787/api/trades` (default)
   - **Poll Seconds**: `5` (default)
   - **Send Full History On Start**: `true` (recommended)
   - **Notes Tag**: `cTrader` (appears in journal)
7. Check **FullAccess** permission → Click **Play** ▶️
8. Keep cTrader running while trading

### Step 3: Start Local Bridge

```bash
# Windows
start-bridge.bat

# Or manually (any OS)
node ctrader_bridge.js
```

The bridge starts at `http://127.0.0.1:8787/` and will auto-open in your browser.

### Step 4: Expose Bridge to Internet (Required for Vercel)

**Option A: ngrok (easiest)**

```bash
# Install ngrok if needed: https://ngrok.com/download
ngrok http 8787
```

Copy the HTTPS URL (e.g., `https://abc123.ngrok-free.app`)

**Option B: Cloudflare Tunnel (production-grade)**

```bash
# Install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/
cloudflared tunnel --url http://127.0.0.1:8787
```

### Step 5: Deploy to Vercel

1. Push this repo to GitHub (see [Repository Setup](#-repository-setup))
2. Go to [Vercel Dashboard](https://vercel.com/dashboard) → **Add New → Project**
3. Import your GitHub repo
4. **Framework Preset**: Other
5. **Build Command**: (leave empty)
6. **Output Directory**: (leave empty / `.`)
7. Add Environment Variable:
   - `BRIDGE_URL` = `https://your-ngrok-url.ngrok-free.app` (from Step 4)
8. Click **Deploy**

Your journal will be live at `https://prop-firm-risk-ledger.vercel.app/` (or your custom domain).

---

## 📁 Repository Structure

```
propjournal/
├── .github/
│   └── workflows/
│       └── deploy.yml          # Auto-deploy to Vercel on push
├── ctrader-bot/
│   └── JournalBridge.cs        # cTrader cBot (copy to cTrader Automate)
├── public/                     # Static assets served by Vercel
│   └── index.html              # Main journal UI (copied from root)
├── ctrader_bridge.js           # Local Node.js bridge server
├── ctrader-trades.json         # Local trade storage (gitignored)
├── package.json                # Node.js project config
├── vercel.json                 # Vercel deployment config
├── start-bridge.bat            # Windows launcher
└── README.md                   # This file
```

---

## ⚙️ Configuration

### Environment Variables (Vercel)

| Variable | Required | Description |
|----------|----------|-------------|
| `BRIDGE_URL` | ✅ | Public HTTPS URL of your local bridge (e.g., `https://abc123.ngrok-free.app`) |
| `JOURNAL_TITLE` | ❌ | Custom title (default: "PropJournal") |
| `CHALLENGE_TYPE` | ❌ | `one-step` \| `two-step` \| `instant` (default: `one-step`) |

### cBot Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `BridgeUrl` | string | `http://127.0.0.1:8787/api/trades` | Local bridge endpoint |
| `PollSeconds` | int | `5` | How often to check for new closed trades |
| `SendFullHistoryOnStart` | bool | `true` | Send all historical trades on startup |
| `NotesTag` | string | `cTrader` | Tag appended to each trade's comment |

---

## 🔌 API Reference

### Local Bridge (`http://127.0.0.1:8787`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Serves `index.html` (journal UI) |
| `/api/trades` | GET | Returns all trades as JSON array |
| `/api/trades` | POST | Accepts trade array from cBot |
| `/api/health` | GET | Health check: `{ ok: true, trades: N }` |

**POST `/api/trades` payload:**
```json
[
  {
    "positionId": 3709484,
    "closeTime": "2026-10-26T13:40:19.0760000Z",
    "symbol": "NAS100",
    "dir": "buy",
    "lots": 4.76,
    "entry": 29131.45,
    "exit": 29109,
    "pnl": -106.86,
    "label": "",
    "comment": "",
    "tag": "cTrader"
  }
]
```

---

## 📊 Journal Features

- **Challenge Tracking**: One-step / Two-step / Instant funding rules
- **Risk Metrics**: Daily/weekly drawdown, max drawdown, risk per trade
- **Performance Analytics**: Win rate, R-multiple, expectancy, profit factor
- **Visual Charts**: Equity curve, daily P&L bars, weekly heatmap
- **Trade Table**: Sortable, filterable, exportable (CSV)
- **Dark Theme**: Optimized for long trading sessions

---

## 🛡 Security Considerations

1. **Local bridge only binds to `127.0.0.1`** — not accessible from network
2. **ngrok/Cloudflare Tunnel** provides HTTPS + authentication options
3. **No credentials stored** — bridge only receives trade data
4. **Trade data stays local** — only JSON file on your machine
5. **Vercel fetches via your tunnel** — you control the connection

For production: enable ngrok auth (`ngrok http 8787 --auth="user:pass"`) or Cloudflare Access policies.

---

## 🔧 Development

### Run Bridge Locally

```bash
node ctrader_bridge.js
# Open http://127.0.0.1:8787/
```

### Test cBot Connection

```bash
curl -X POST http://127.0.0.1:8787/api/trades \
  -H "Content-Type: application/json" \
  -d '[{"positionId":999,"closeTime":"2026-01-01T12:00:00Z","symbol":"EURUSD","dir":"buy","lots":1.0,"entry":1.0800,"exit":1.0850,"pnl":50,"label":"test","comment":""}]'
```

### Verify Vercel Fetch

```bash
curl https://prop-firm-risk-ledger.vercel.app/api/trades
# Should return your trade data via the tunnel
```

---

## 🚢 CI/CD Pipeline

The `.github/workflows/deploy.yml` automatically deploys to Vercel on every push to `main`:

```yaml
name: Deploy to Vercel
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
```

**Required GitHub Secrets:**
- `VERCEL_TOKEN` — from [Vercel Account Settings](https://vercel.com/account/tokens)
- `VERCEL_ORG_ID` — `vercel inspect` your project
- `VERCEL_PROJECT_ID` — `vercel inspect` your project

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| cBot "Bridge unreachable" | Ensure `node ctrader_bridge.js` is running; check port 8787 |
| ngrok URL changes on restart | Use ngrok static domain (paid) or Cloudflare Tunnel |
| Vercel shows no trades | Verify `BRIDGE_URL` env var; check tunnel is running |
| "Port 8787 busy" | Another bridge instance running; close it or kill process |
| cTrader builds fail | Ensure .NET Framework 4.8+ / cAlgo.API reference |

---

## 📝 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/<your-username>/propjournal/issues)
- **cTrader Automate**: [ctrader.com/automate](https://ctrader.com/automate/)
- **Vercel Docs**: [vercel.com/docs](https://vercel.com/docs)

---

**Built with ❤️ for prop traders who want professional journaling without manual entry.**