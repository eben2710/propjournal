# cTrader → PropJournal Integration Guide

**Complete technical guide for automating trading data synchronization from cTrader to https://prop-firm-risk-ledger.vercel.app/**

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Prerequisites](#prerequisites)
3. [Component Architecture](#component-architecture)
4. [Step-by-Step Setup](#step-by-step-setup)
5. [Configuration Reference](#configuration-reference)
6. [Deployment to GitHub & Vercel](#deployment-to-github--vercel)
7. [Monitoring & Maintenance](#monitoring--maintenance)
8. [Troubleshooting](#troubleshooting)
9. [Security Best Practices](#security-best-practices)
10. [Advanced Customization](#advanced-customization)

---

## System Overview

### Data Flow

```
┌──────────────┐    HistoricalTrade    ┌──────────────────┐    HTTP POST     ┌─────────────────┐
│  cTrader     │ ────────────────────▶ │  JournalBridge   │ ───────────────▶ │  Local Bridge   │
│  Automate    │   (on position close) │    cBot (C#)     │   (JSON trades)  │  (Node.js)      │
└──────────────┘                       └──────────────────┘                  └────────┬────────┘
                                                                                       │
                                                                                       ▼
                                                                              ┌─────────────────┐
                                                                              │  JSON Storage   │
                                                                              │ (ctrader-trades.json)
                                                                              └────────┬────────┘
                                                                                       │
                                                                                       ▼
                                              ngrok/Cloudflare Tunnel ◀──────────────┐
                                                                                       │
                                                                                       ▼
                                                                              ┌─────────────────┐
                                                                              │   Vercel Edge   │
                                                                              │  (Serverless)   │
                                                                              └────────┬────────┘
                                                                                       │
                                                                                       ▼
                                                                              ┌─────────────────┐
                                                                              │  Browser UI     │
                                                                              │ (index.html)    │
                                                                              └─────────────────┘
```

### Components

| Component | File | Language | Runs On |
|-----------|------|----------|---------|
| cTrader cBot | `ctrader-bot/JournalBridge.cs` | C# (cAlgo) | cTrader Desktop |
| Local Bridge | `ctrader_bridge.js` | Node.js | Your PC (localhost:8787) |
| Vercel API | `api/trades.js` | JavaScript | Vercel Edge Network |
| Journal UI | `index.html` | Vanilla JS | Browser (any device) |

---

## Prerequisites

### Software Requirements

| Tool | Version | Purpose |
|------|---------|---------|
| cTrader Desktop | Latest | Trading platform with Automate |
| .NET Framework | 4.8+ | Required for cAlgo |
| Node.js | 18+ | Local bridge server |
| ngrok **or** Cloudflare Tunnel | Latest | Secure public HTTPS tunnel |
| Git | 2.30+ | Version control |
| GitHub Account | - | Repository hosting |
| Vercel Account | - | Hosting & serverless functions |

### Accounts & Access

1. **cTrader Account** - Live or demo account with trading permissions
2. **GitHub Account** - For repository and CI/CD
3. **Vercel Account** - Free tier sufficient
4. **ngrok Account** (optional) - For static domains (paid) or use free dynamic URLs

---

## Component Architecture

### 1. JournalBridge cBot (`ctrader-bot/JournalBridge.cs`)

**Responsibilities:**
- Monitors `History` collection for closed positions
- Deduplicates using composite key: `PositionId|ClosingTime|ClosingPrice`
- Converts trades to JSON with normalized fields
- POSTs to local bridge endpoint every `PollSeconds`

**Key Methods:**
- `OnStart()` - Initializes HttpClient, sends full history if enabled
- `OnTimer()` - Polls for new closed trades
- `ToJson(HistoricalTrade)` - Normalizes trade data
- `Send(List<string>)` - Async HTTP POST with error handling

**Parameters (configurable in cTrader):**
```csharp
[Parameter("Bridge URL", DefaultValue = "http://127.0.0.1:8787/api/trades")]
public string BridgeUrl { get; set; }

[Parameter("Poll Seconds", DefaultValue = 5, MinValue = 2)]
public int PollSeconds { get; set; }

[Parameter("Send Full History On Start", DefaultValue = true)]
public bool SendFullHistoryOnStart { get; set; }

[Parameter("Notes Tag", DefaultValue = "cTrader")]
public string NotesTag { get; set; }
```

### 2. Local Bridge Server (`ctrader_bridge.js`)

**Responsibilities:**
- HTTP server on `127.0.0.1:8787` (localhost only for security)
- CORS-enabled for Vercel fetch
- Persists trades to `ctrader-trades.json`
- Serves `index.html` for local testing
- Deduplicates trades on merge

**Endpoints:**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Serves journal UI |
| GET | `/api/trades` | Returns all trades |
| POST | `/api/trades` | Accepts trades from cBot |
| GET | `/api/health` | Health check |

**Data Normalization:**
```javascript
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
```

### 3. Vercel Serverless Functions

**`api/trades.js`** - Fetches from local bridge via tunnel
- Reads `BRIDGE_URL` environment variable
- 10-second timeout with abort controller
- Caches response for 30 seconds (s-maxage)
- Returns enriched response with metadata

**`api/health.js`** - Monitoring endpoint
- Checks bridge connectivity
- Returns bridge status and trade count

### 4. Journal UI (`index.html`)

Single-page application with:
- Challenge progress tracking (one-step, two-step, instant)
- Risk metrics dashboard (drawdown, daily loss, position limits)
- Performance charts (equity curve, daily P&L, weekly heatmap)
- Trade history table with sorting/filtering/CSV export
- Dark theme optimized for trading hours

---

## Step-by-Step Setup

### Phase 1: Local Development Setup

#### 1.1 Clone Repository

```bash
git clone https://github.com/<your-username>/propjournal.git
cd propjournal
```

#### 1.2 Verify Node.js Installation

```bash
node --version  # Should be v18.0.0 or higher
npm --version
```

#### 1.3 Test Local Bridge

```bash
# Terminal 1: Start bridge
node ctrader_bridge.js
# Output: "PropJournal bridge running at http://127.0.0.1:8787/"
# Browser auto-opens to http://127.0.0.1:8787/
```

```bash
# Terminal 2: Test API
curl http://127.0.0.1:8787/api/health
# Expected: {"ok":true,"trades":N}

curl http://127.0.0.1:8787/api/trades
# Expected: [...] array of trades
```

### Phase 2: cTrader Configuration

#### 2.1 Install JournalBridge cBot

1. Open **cTrader Desktop**
2. Navigate to **Automate** tab (left sidebar, `</>` icon)
3. Click **New** → **New cBot**
4. Name: `JournalBridge`
5. **Delete all default code**
6. **Copy entire contents** of `ctrader-bot/JournalBridge.cs`
7. Paste into editor
8. Press **F7** or click **Build** → Verify "Build succeeded"
9. If errors: check .NET Framework 4.8+ is installed

#### 2.2 Deploy cBot to Chart

1. In Automate panel, find `JournalBridge` under **cBots**
2. **Drag and drop** onto any chart of the account you want to journal
3. **Parameters panel** appears - configure:

| Parameter | Recommended Value | Notes |
|-----------|-------------------|-------|
| Bridge URL | `http://127.0.0.1:8787/api/trades` | Must match local bridge |
| Poll Seconds | `5` | Lower = faster sync, more CPU |
| Send Full History On Start | `true` | Backfills journal on restart |
| Notes Tag | `cTrader` | Appears in trade comments |

4. **Check "FullAccess"** in permissions (required for HTTP)
5. Click **Play** (▶️) to start
6. Verify in **Log** panel: `"JournalBridge started. Existing trades marked: N"`

#### 2.3 Verify cBot Operation

1. Close a test trade manually or wait for one
2. Check cBot **Log** panel for: `"Sent 1 trade(s) to journal (total N)"`
3. Verify local bridge received it:
   ```bash
   curl http://127.0.0.1:8787/api/trades | jq '.[-1]'
   ```

### Phase 3: Public Tunnel Setup

#### Option A: ngrok (Quick Start)

```bash
# Install ngrok
# Windows: choco install ngrok
# Mac: brew install ngrok
# Linux: snap install ngrok

# Authenticate (optional but recommended for static URL)
ngrok config add-authtoken <your-token>

# Start tunnel
ngrok http 8787
```

**Output example:**
```
Session Status                online
Account                       Your Name (Plan: Free)
Version                       3.x.x
Region                        United States (us)
Latency                       45ms
Web Interface                 http://127.0.0.1:4040
Forwarding                    https://abc123.ngrok-free.app -> http://127.0.0.1:8787
```

**Copy the HTTPS URL** (e.g., `https://abc123.ngrok-free.app`) - this is your `BRIDGE_URL`.

#### Option B: Cloudflare Tunnel (Production)

```bash
# Install cloudflared
# Windows: winget install Cloudflare.cloudflared
# Mac: brew install cloudflare/cloudflare/cloudflared
# Linux: see https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/

# Login to Cloudflare
cloudflared tunnel login

# Create named tunnel
cloudflared tunnel create propjournal

# Configure tunnel (creates ~/.cloudflared/config.yml)
cat > ~/.cloudflared/config.yml <<EOF
tunnel: <tunnel-id>
credentials-file: ~/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: propjournal.yourdomain.com
    service: http://localhost:8787
  - service: http_status:404
EOF

# Run tunnel
cloudflared tunnel run propjournal
```

**For production:** Use a custom domain with Cloudflare Access for authentication.

### Phase 4: Vercel Deployment

#### 4.1 Push to GitHub

```bash
# Initialize git if not already
git init
git add .
git commit -m "Initial commit: PropJournal cTrader integration"

# Create GitHub repo (via web or CLI)
gh repo create propjournal --public --source=. --remote=origin --push

# Or manually:
# 1. Create repo at github.com/new
# 2. git remote add origin https://github.com/<username>/propjournal.git
# 3. git push -u origin main
```

#### 4.2 Configure Vercel Project

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click **Add New...** → **Project**
3. Import your GitHub repository
4. **Configure Project:**
   - Framework Preset: **Other**
   - Build Command: *(leave empty)*
   - Output Directory: `.` (root)
   - Install Command: *(leave empty)*

5. **Environment Variables** (click "Environment Variables" section):
   ```
   Name: BRIDGE_URL
   Value: https://your-ngrok-url.ngrok-free.app
   Environment: Production, Preview, Development
   ```

6. Click **Deploy**

#### 4.3 Verify Production Deployment

1. Wait for deployment to complete
2. Visit your Vercel URL: `https://prop-firm-risk-ledger.vercel.app/`
3. Check browser console for any errors
4. Verify trades load: Open DevTools → Network → Filter "trades"
5. Test health endpoint: `https://prop-firm-risk-ledger.vercel.app/api/health`

### Phase 5: CI/CD Automation (Optional but Recommended)

#### 5.1 Add Vercel Secrets to GitHub

1. Go to GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Add three **Repository secrets**:

| Secret Name | Value Source |
|-------------|--------------|
| `VERCEL_TOKEN` | [Vercel Account Tokens](https://vercel.com/account/tokens) |
| `VERCEL_ORG_ID` | Run `vercel inspect <deployment-url>` → copy `orgId` |
| `VERCEL_PROJECT_ID` | Run `vercel inspect <deployment-url>` → copy `projectId` |

#### 5.2 Verify Workflow

1. Push a small change:
   ```bash
   echo "# Test" >> README.md
   git commit -am "Test CI/CD"
   git push
   ```
2. Check **Actions** tab in GitHub - should see "Deploy to Vercel" workflow
3. On PR: Creates preview deployment
4. On merge to main: Deploys to production

---

## Configuration Reference

### Environment Variables

#### Vercel Dashboard (Project Settings → Environment Variables)

| Variable | Required | Example | Description |
|----------|----------|---------|-------------|
| `BRIDGE_URL` | ✅ | `https://abc123.ngrok-free.app` | Public HTTPS URL of local bridge |
| `JOURNAL_TITLE` | ❌ | `My Prop Journal` | Custom title in UI |
| `CHALLENGE_TYPE` | ❌ | `one-step` | `one-step` \| `two-step` \| `instant` |

#### Local Bridge (ctrader_bridge.js)

Edit constants at top of file:
```javascript
const HOST = "127.0.0.1";     // Bind address (keep localhost for security)
const PORT = 8787;            // Port number
const DATA_FILE = "ctrader-trades.json";  // Storage file
```

#### cBot Parameters (cTrader UI)

| Parameter | Type | Default | Range | Description |
|-----------|------|---------|-------|-------------|
| `BridgeUrl` | string | `http://127.0.0.1:8787/api/trades` | Valid URL | Local bridge endpoint |
| `PollSeconds` | int | `5` | 2-300 | Polling interval |
| `SendFullHistoryOnStart` | bool | `true` | true/false | Backfill on start |
| `NotesTag` | string | `cTrader` | Any string | Tag for trade identification |

---

## Deployment to GitHub & Vercel

### Complete GitHub Repository Setup

```bash
# 1. Ensure you're in the project root
cd "C:\Users\Ebenezer\omniroute-claude\propjournal"

# 2. Check git status
git status

# 3. Add all files (except gitignored)
git add .

# 4. Commit with conventional message
git commit -m "feat: complete cTrader-PropJournal integration

- Add JournalBridge cBot for cTrader Automate
- Add local Node.js bridge server with REST API
- Add Vercel serverless functions for trade fetching
- Add production-ready journal UI with charts
- Add CI/CD workflow for automated Vercel deployment
- Add comprehensive documentation"

# 5. Create GitHub repository (if not exists)
gh repo create propjournal --public --source=. --push
# OR manually at github.com/new then:
git remote add origin https://github.com/<username>/propjournal.git
git push -u origin main
```

### Repository Structure (Final)

```
propjournal/
├── .github/
│   └── workflows/
│       └── deploy.yml          # CI/CD: auto-deploy to Vercel
├── api/                        # Vercel serverless functions
│   ├── trades.js              # GET /api/trades - fetches from bridge
│   └── health.js              # GET /api/health - monitoring
├── ctrader-bot/
│   └── JournalBridge.cs       # cTrader cBot (install in Automate)
├── public/                     # (Optional) Static assets
├── ctrader_bridge.js          # Local bridge server (Node.js)
├── ctrader-trades.json        # Trade data (gitignored)
├── index.html                 # Journal UI (served by Vercel)
├── package.json               # Node.js project config
├── vercel.json                # Vercel deployment config
├── start-bridge.bat           # Windows launcher
├── README.md                  # Project documentation
├── INTEGRATION_GUIDE.md       # This file
├── LICENSE                    # MIT License
└── .gitignore                 # Git ignore rules
```

### Vercel Project Settings

**vercel.json** key settings:
```json
{
  "framework": null,
  "buildCommand": "",
  "outputDirectory": ".",
  "devCommand": "node ctrader_bridge.js",
  "routes": [{ "src": "/(.*)", "dest": "/index.html" }],
  "regions": ["iad1"]
}
```

**Custom Domain Setup** (optional):
1. Vercel Dashboard → Project → Settings → Domains
2. Add `journal.yourdomain.com`
3. Configure DNS per Vercel instructions
4. Enable **Automatic HTTPS**

---

## Monitoring & Maintenance

### Health Checks

**Local Bridge:**
```bash
# Quick health check
curl http://127.0.0.1:8787/api/health
# {"ok":true,"trades":42}
```

**Vercel Production:**
```bash
curl https://prop-firm-risk-ledger.vercel.app/api/health
# {
#   "ok": true,
#   "bridge": { "status": "connected", "tradesCount": 42, "configured": true }
# }
```

### Log Monitoring

**cTrader cBot Logs:**
- Automate panel → JournalBridge instance → **Log** tab
- Look for: `"Sent N trade(s) to journal (total X)"`
- Errors: `"Bridge unreachable"` = bridge not running or tunnel down

**Local Bridge Logs:**
```bash
# Terminal running node ctrader_bridge.js shows:
# "POST /api/trades 200 { added: 1, total: 43 }"
# "GET /api/trades 200"
```

**Vercel Function Logs:**
- Vercel Dashboard → Project → Functions → View logs
- Check for timeout errors or bridge connection failures

### Data Backup

**Automated backup script** (add to cron/Task Scheduler):
```bash
#!/bin/bash
# backup-trades.sh
DATE=$(date +%Y%m%d_%H%M%S)
cp ctrader-trades.json "backups/ctrader-trades_${DATE}.json"
# Keep last 30 days
find backups -name "ctrader-trades_*.json" -mtime +30 -delete
```

**Manual backup:**
```bash
cp ctrader-trades.json ctrader-trades.backup.$(date +%Y%m%d).json
```

### Updating Components

| Component | Update Process |
|-----------|----------------|
| cBot | Edit in cTrader Automate → Build → Restart instance |
| Local Bridge | Edit `ctrader_bridge.js` → Restart `node ctrader_bridge.js` |
| Vercel Functions | Edit `api/*.js` → `git push` → Auto-deploys |
| Journal UI | Edit `index.html` → `git push` → Auto-deploys |

---

## Troubleshooting

### Common Issues & Solutions

#### cBot: "Bridge unreachable"

**Symptoms:** cBot Log shows `"Bridge unreachable (No connection could be made...)"`

**Causes & Fixes:**
| Cause | Fix |
|-------|-----|
| Bridge not running | Run `node ctrader_bridge.js` |
| Wrong port | Check `PORT = 8787` in bridge matches cBot `BridgeUrl` |
| Firewall blocking | Allow Node.js through Windows Firewall |
| cBot on different machine | Bridge binds to 127.0.0.1 only - must run on same PC |

#### ngrok: URL Changes on Restart

**Free ngrok** generates new URL each session.

**Solutions:**
1. **ngrok Static Domain** (paid): Reserve `yourname.ngrok-free.app`
2. **Cloudflare Tunnel**: Persistent URL with custom domain
3. **Script to auto-update Vercel** (advanced):
   ```bash
   #!/bin/bash
   # update-vercel-bridge-url.sh
   NEW_URL=$(curl -s http://127.0.0.1:4040/api/tunnels | jq -r '.tunnels[0].public_url')
   vercel env add BRIDGE_URL production <<< "$NEW_URL"
   vercel --prod --token=$VERCEL_TOKEN
   ```

#### Vercel: "Bridge unreachable" or Timeout

**Symptoms:** `/api/trades` returns 502/504

**Debugging:**
```bash
# 1. Test bridge directly from your machine
curl https://your-ngrok-url.ngrok-free.app/api/health

# 2. Check ngrok tunnel is running
curl http://127.0.0.1:4040/api/tunnels

# 3. Verify BRIDGE_URL in Vercel env vars (no trailing slash issues)
# 4. Check Vercel function logs for detailed error
```

#### No Trades Appearing in Journal

**Checklist:**
1. ✅ cTrader running with cBot **Playing** (▶️)
2. ✅ Local bridge running (`node ctrader_bridge.js`)
3. ✅ ngrok/Cloudflare tunnel running
4. ✅ `BRIDGE_URL` in Vercel matches tunnel HTTPS URL
5. ✅ Recent trades closed (cBot only sends on position close)
6. ✅ Check cBot Log: "Sent N trade(s) to journal"
7. ✅ Check local bridge: `curl localhost:8787/api/trades | jq length`

#### CORS Errors in Browser

**Symptom:** Browser console shows CORS error when loading trades

**Fix:** Local bridge already sets CORS headers. If using custom domain:
```javascript
// In ctrader_bridge.js, ensure:
const BASE_HEADERS = {
  "Access-Control-Allow-Origin": "*",  // Or specific domain
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
```

#### cTrader Build Errors

| Error | Solution |
|-------|----------|
| `The type or namespace name 'cAlgo' could not be found` | Install cTrader Automate API reference |
| `HttpClient not found` | Add `using System.Net.Http;` |
| `AccessRights.FullAccess` denied | Check "FullAccess" in cBot parameters panel |

---

## Security Best Practices

### 1. Network Security

- ✅ Local bridge binds **only to 127.0.0.1** (not 0.0.0.0)
- ✅ Tunnel provides **HTTPS** with valid TLS certificate
- ✅ No authentication on local bridge (localhost only)
- ✅ Consider **ngrok auth** for additional protection:
  ```bash
  ngrok http 8787 --auth="username:password"
  ```

### 2. Data Protection

- ✅ Trade data stored **locally only** (`ctrader-trades.json`)
- ✅ **No credentials** in code or git history
- ✅ `.gitignore` excludes trade data file
- ✅ Vercel only **fetches** data, doesn't store it

### 3. Access Control

**For production deployments:**
- Use **Cloudflare Access** with email/OIDC authentication
- Restrict Vercel deployment to team members only
- Enable **Vercel Firewall** rules for API endpoints

### 4. Secrets Management

- ❌ Never commit `.env` files
- ✅ Use **Vercel Environment Variables** for `BRIDGE_URL`
- ✅ Use **GitHub Secrets** for CI/CD tokens
- ✅ Rotate `VERCEL_TOKEN` periodically

---

## Advanced Customization

### Adding Custom Trade Fields

**1. Update cBot (`JournalBridge.cs`):**
```csharp
// In ToJson() method, add:
sb.Append("\"magic\":").Append(t.MagicNumber).Append(",");
sb.Append("\"swap\":").Append(Math.Round(t.Swap, 2).ToString(CultureInfo.InvariantCulture)).Append(",");
sb.Append("\"commission\":").Append(Math.Round(t.Commission, 2).ToString(CultureInfo.InvariantCulture));
```

**2. Update Bridge Normalization (`ctrader_bridge.js`):**
```javascript
function normalize(t) {
  return {
    // ... existing fields
    magic: t.magic == null ? null : t.magic,
    swap: t.swap == null ? null : t.swap,
    commission: t.commission == null ? null : t.commission
  };
}
```

**3. Update UI (`index.html`):**
- Add columns to trade table
- Include in CSV export
- Add to analytics calculations

### Multiple Account Support

**Option 1: Multiple Bridge Instances**
```bash
# Terminal 1: Account A
PORT=8787 node ctrader_bridge.js

# Terminal 2: Account B
PORT=8788 node ctrader_bridge.js  # Modify bridge to accept PORT env var
```

**Option 2: Account Tag in Trade Data**
```csharp
// In cBot, add account identifier
sb.Append("\"account\":\"").Append(Account.Name).Append("\",");
```

**Option 3: Separate Repositories**
- Fork repo per account
- Different `BRIDGE_URL` per Vercel project

### Custom Challenge Rules

Edit `index.html` challenge configuration:
```javascript
// In the rules configuration section
const CHALLENGE_RULES = {
  "one-step": {
    profitTarget: 0.10,      // 10%
    maxDailyLoss: 0.05,      // 5%
    maxDrawdown: 0.10,       // 10%
    minTradingDays: 4,
    maxLeverage: 30
  },
  "two-step": {
    // Phase 1
    phase1: { profitTarget: 0.08, maxDailyLoss: 0.05, maxDrawdown: 0.10 },
    // Phase 2
    phase2: { profitTarget: 0.05, maxDailyLoss: 0.05, maxDrawdown: 0.10 }
  }
};
```

### Adding Webhooks/Notifications

**Discord/Slack Webhook on New Trade:**
```javascript
// In ctrader_bridge.js, inside mergeTrades() after saveTrades()
if (added > 0 && process.env.DISCORD_WEBHOOK) {
  fetch(process.env.DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: `New Trade: ${t.symbol} ${t.dir.toUpperCase()}`,
        color: t.pnl >= 0 ? 0x10b981 : 0xf43f5e,
        fields: [
          { name: 'P&L', value: `${t.pnl >= 0 ? '+' : ''}${t.pnl}`, inline: true },
          { name: 'Lots', value: t.lots.toString(), inline: true },
          { name: 'Entry → Exit', value: `${t.entry} → ${t.exit}`, inline: true }
        ]
      }]
    })
  }).catch(console.error);
}
```

### Analytics Extensions

**Add to `api/trades.js` for computed metrics:**
```javascript
// After fetching trades, compute:
const metrics = {
  totalPnL: trades.reduce((sum, t) => sum + (t.pnl || 0), 0),
  winRate: trades.filter(t => (t.pnl || 0) > 0).length / trades.length,
  avgWin: trades.filter(t => (t.pnl || 0) > 0).reduce((s, t) => s + t.pnl, 0) / trades.filter(t => t.pnl > 0).length,
  avgLoss: trades.filter(t => (t.pnl || 0) < 0).reduce((s, t) => s + t.pnl, 0) / trades.filter(t => t.pnl < 0).length,
  profitFactor: Math.abs(
    trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0) /
    trades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0)
  ),
  maxDrawdown: calculateMaxDrawdown(trades),
  sharpeRatio: calculateSharpe(trades)
};
```

---

## Quick Reference Commands

```bash
# Start everything locally
node ctrader_bridge.js                    # Terminal 1: Local bridge
ngrok http 8787                          # Terminal 2: Public tunnel

# Test endpoints
curl http://127.0.0.1:8787/api/health
curl http://127.0.0.1:8787/api/trades
curl https://your-ngrok.ngrok-free.app/api/health

# Deploy
git add . && git commit -m "msg" && git push  # Auto-deploys via GitHub Actions

# View logs
# cTrader: Automate → JournalBridge → Log tab
# Local: Terminal running node ctrader_bridge.js
# Vercel: Dashboard → Functions → Logs

# Backup
cp ctrader-trades.json backups/ctrader-trades_$(date +%Y%m%d).json
```

---

## Support & Resources

| Resource | Link |
|----------|------|
| cTrader Automate Docs | https://ctrader.com/automate/docs |
| Vercel Documentation | https://vercel.com/docs |
| ngrok Documentation | https://ngrok.com/docs |
| Cloudflare Tunnel | https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/ |
| GitHub Actions | https://docs.github.com/en/actions |

---

**Last Updated:** 2026-10-30  
**Version:** 1.0.0  
**Maintainer:** Ebenezer

*This guide covers the complete integration pipeline from cTrader to production Vercel deployment. For questions, open an issue on GitHub.*