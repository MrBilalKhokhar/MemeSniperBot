# 🚀 Memecoin Sniper Bot — Setup Guide

> AI-powered Solana meme coin sniper · DeepSeek AI · Jupiter Swaps · 24/7 on Railway

---

## ⚠️ IMPORTANT DISCLAIMER
Meme coin trading is extremely high risk. You can lose everything. Never invest more than you can afford to lose. This bot does NOT guarantee profit.

---

## What You Need First

1. **A Solana wallet** with some SOL (minimum recommended: 1 SOL for trading + fees)
2. **Your wallet's private key** (base58 format — looks like a long string of letters/numbers)
3. **A DeepSeek API key** — get one FREE at [platform.deepseek.com](https://platform.deepseek.com)
4. **A Railway account** — free at [railway.app](https://railway.app)
5. **A GitHub account** — free at [github.com](https://github.com)
6. **A faster Solana RPC URL** (highly recommended for sniping speed):
   - Free: [helius.dev](https://helius.dev) → Create account → Copy your RPC URL
   - Or use default (slower): `https://api.mainnet-beta.solana.com`

---

## Step 1 — Upload Files to GitHub

1. Go to [github.com](https://github.com) and sign in
2. Click the green **"New"** button to create a new repository
3. Name it `memecoin-sniper` — set it to **Private**
4. Click **"Create repository"**
5. Upload ALL these files to GitHub:
   - `server.js`
   - `dashboard.html`
   - `package.json`
   - `config.json`
   - `trades.json`
   - `railway.toml`
   - `.gitignore`
   
   (Do NOT upload `.env` or your private key in plain text)

---

## Step 2 — Deploy to Railway

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Select your `memecoin-sniper` repository
4. Railway will detect `server.js` automatically and start deploying

### Set Environment Variables on Railway:
Click your project → **Variables** tab → Add these:

| Variable | Value |
|----------|-------|
| `PRIVATE_KEY` | Your Solana wallet private key (base58) |
| `DEEPSEEK_API_KEY` | Your DeepSeek API key |
| `RPC_URL` | Your Helius RPC URL (or leave empty for default) |

> ⚠️ **NEVER put your private key in config.json when uploading to GitHub.** Always use Railway environment variables for sensitive keys.

5. Go to **Settings** → **Networking** → Click **"Generate Domain"**
6. You'll get a URL like `https://memecoin-sniper-xxxx.railway.app`
7. Open that URL — your dashboard is live!

---

## Step 3 — Configure the Bot (from Dashboard)

Open your Railway URL and go to the **⚙️ Config** tab:

1. **Private Key** — Enter your Solana wallet private key
2. **RPC URL** — Paste your Helius URL (faster sniping)
3. **DeepSeek API Key** — Paste your key
4. **Buy Amount** — How much SOL to spend per trade (start small: 0.05)
5. **Take Profit** — Default 150% means the bot sells when up 150% (2.5x)
6. **Stop Loss** — Default 35% means bot cuts losses at -35%
7. **Time Stop** — Force sell after 45 minutes if no TP/SL hit
8. **AI Confidence** — Only buy if DeepSeek is 65%+ confident
9. **Auto-Trade** — Start with this **OFF** to watch AI analysis first, then enable when ready
10. Click **💾 Save Config**

---

## Step 4 — Start the Bot

1. Go to the **📊 Dashboard** tab
2. Click **▶ Start Bot**
3. Watch the **🧠 AI Feed** tab — you'll see tokens being analyzed in real-time
4. The **🖥 Bot Log** tab shows everything the bot is doing
5. When you're happy with the AI decisions, go to Config → enable **Auto-Trade**

---

## Understanding the Dashboard

| Tab | What it shows |
|-----|--------------|
| 📊 Dashboard | Overview: profit, win rate, balance, active positions |
| 💼 Active Positions | Live trades with real-time P&L and manual sell button |
| 📜 Trade History | Every closed trade with net profit after ALL fees |
| 🧠 AI Feed | DeepSeek's BUY/SKIP decision for every token detected |
| 🖥 Bot Log | Full live log of bot activity |
| ⚙️ Config | All settings — change anything without touching code |

---

## How the Bot Works

```
Every 8 seconds:
  → Check pump.fun for tokens < 2 minutes old
  → Safety checks: liquidity, market cap, mint authority
  → Send to DeepSeek AI for analysis
  → If AI says BUY with high confidence:
      → Get best swap route via Jupiter
      → Check price impact (skip if > 25%)
      → Execute buy transaction
      → Monitor position every 12 seconds:
          → Sell if up 150% (take profit) ✅
          → Sell if down 35% (stop loss) 🛑
          → Sell after 45 min (time stop) ⏰
  → All fees (network + DEX ~0.3%) deducted from P&L
  → Net profit shown in trade history
```

---

## Fee Breakdown (per trade)

Each trade has two transactions (buy + sell), each with:
- Network fee: ~0.000005 SOL (tiny)
- Priority fee: ~0.0001 SOL (for speed)
- DEX swap fee: ~0.3% of trade amount (Jupiter/Raydium)
- Slippage: up to 15% on new tokens (unavoidable)

The dashboard shows **NET profit** = gross profit minus ALL fees.

---

## Recommended Starter Settings

| Setting | Value | Why |
|---------|-------|-----|
| Buy Amount | 0.05 SOL | Low risk while learning |
| Slippage | 1500 bps (15%) | New tokens need high slippage |
| Take Profit | 150% | Realistic for meme coins |
| Stop Loss | 35% | Cuts losses before they get worse |
| Time Stop | 45 min | Don't hold bags too long |
| AI Confidence | 70% | Higher = fewer but better trades |
| Auto-Trade | OFF first | Watch AI decisions for a day |
| Max Active | 3 | Don't overextend while learning |

---

## Keeping it Live 24/7

Railway's free tier keeps your app running. If it ever goes down:
- Go to your Railway project
- Click **"Redeploy"**
- The `railway.toml` file is set to auto-restart on failures

---

## Getting a Better RPC (Recommended for Sniping)

The default Solana RPC is slow and rate-limited. For faster sniping:

1. Go to [helius.dev](https://helius.dev)
2. Create a free account
3. Copy your personal RPC URL
4. Paste it in the **Config** tab under **RPC URL**
5. Save — the bot will use it immediately

---

## Troubleshooting

**Bot won't start:** Check the Config tab — private key and DeepSeek API key must be set.

**No tokens appearing:** The bot checks pump.fun every 8 seconds. Tokens only appear during high-activity periods. Check the Bot Log for errors.

**Transactions failing:** Your RPC might be slow. Get a Helius RPC URL. Also make sure your wallet has enough SOL (need buy amount + ~0.01 SOL for fees).

**AI not analyzing:** Check your DeepSeek API key in Config. Make sure you have credits at platform.deepseek.com.

---

## Support

Check the **🖥 Bot Log** tab first — it shows exactly what's happening and why any trade was skipped or failed.
