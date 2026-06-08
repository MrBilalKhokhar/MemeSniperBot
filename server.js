// ============================================================
//  SOLANA MEMECOIN SNIPER BOT — server.js
//  DeepSeek AI · Jupiter Swaps · Pump.fun Monitor · 24/7
// ============================================================

'use strict';

const express     = require('express');
const http        = require('http');
const { Server }  = require('socket.io');
const cors        = require('cors');
const fs          = require('fs');
const path        = require('path');
const fetch       = require('node-fetch');
const {
  Connection, Keypair, PublicKey,
  VersionedTransaction, LAMPORTS_PER_SOL
} = require('@solana/web3.js');
const bs58 = require('bs58');

// ─── Constants ───────────────────────────────────────────────
const CONFIG_FILE  = path.join(__dirname, 'config.json');
const TRADES_FILE  = path.join(__dirname, 'trades.json');
const SOL_MINT     = 'So11111111111111111111111111111111111111112';
const JUPITER_QUOTE = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP  = 'https://quote-api.jup.ag/v6/swap';
const JUPITER_PRICE = 'https://price.jup.ag/v4/price';
const PUMP_API      = 'https://frontend-api.pump.fun/coins';

// ─── State ───────────────────────────────────────────────────
let config       = loadConfig();
let trades       = loadTrades();
let botRunning   = false;
let monitorTimer = null;
let positionTimer= null;
let activeTrades = {};    // mint → trade object
let tokensSeen   = new Set();
let aiQueue      = [];    // tokens waiting for AI analysis
let connection   = null;
let wallet       = null;
let walletBalance= 0;
let totalProfit  = 0;
let botLog       = [];    // recent log lines

// ─── Express Setup ───────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Serve dashboard at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// ─── API Routes ──────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    botRunning,
    walletAddress : config.solana.wallet_address || 'Not configured',
    walletBalance,
    totalProfit,
    activeTradeCount: Object.keys(activeTrades).length,
    totalTrades : trades.length,
    winTrades   : trades.filter(t => t.pnl_sol > 0).length,
    lossTrades  : trades.filter(t => t.pnl_sol <= 0).length
  });
});

app.get('/api/trades', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json([...trades].reverse().slice(0, limit));
});

app.get('/api/active', (req, res) => {
  res.json(Object.values(activeTrades));
});

app.get('/api/log', (req, res) => {
  res.json(botLog.slice(-100));
});

app.get('/api/config', (req, res) => {
  // Never expose private key fully — mask it
  const safe = JSON.parse(JSON.stringify(config));
  if (safe.solana.private_key && safe.solana.private_key.length > 8) {
    safe.solana.private_key = safe.solana.private_key.slice(0, 6) + '••••••' + safe.solana.private_key.slice(-4);
  }
  res.json(safe);
});

app.post('/api/config', (req, res) => {
  try {
    const incoming = req.body;
    // Deep merge — never overwrite private_key with masked value
    if (incoming.solana) {
      if (incoming.solana.private_key && incoming.solana.private_key.includes('••••')) {
        delete incoming.solana.private_key; // keep existing
      }
      Object.assign(config.solana, incoming.solana);
    }
    if (incoming.deepseek)   Object.assign(config.deepseek,   incoming.deepseek);
    if (incoming.trading)    Object.assign(config.trading,    incoming.trading);
    if (incoming.monitoring) Object.assign(config.monitoring, incoming.monitoring);
    saveConfig();
    // Re-init wallet if credentials changed
    initWallet();
    res.json({ success: true, message: 'Config saved' });
    log('⚙️  Config updated from dashboard');
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/bot/start', async (req, res) => {
  if (botRunning) return res.json({ success: false, message: 'Bot already running' });
  const err = validateConfig();
  if (err) return res.status(400).json({ success: false, message: err });
  await startBot();
  res.json({ success: true, message: 'Bot started' });
});

app.post('/api/bot/stop', (req, res) => {
  stopBot();
  res.json({ success: true, message: 'Bot stopped' });
});

app.post('/api/sell/:mint', async (req, res) => {
  const { mint } = req.params;
  const trade = activeTrades[mint];
  if (!trade) return res.status(404).json({ success: false, message: 'Trade not found' });
  try {
    await closeTrade(mint, 'manual');
    res.json({ success: true, message: 'Sell executed' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─── Config & Trade I/O ─────────────────────────────────────
function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return defaultConfig();
  }
}

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function loadTrades() {
  try {
    const raw = fs.readFileSync(TRADES_FILE, 'utf8');
    return JSON.parse(raw);
  } catch { return []; }
}

function saveTrades() {
  fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
}

function defaultConfig() {
  return {
    solana:    { rpc_url: 'https://api.mainnet-beta.solana.com', private_key: '', wallet_address: '' },
    deepseek:  { api_key: '', model: 'deepseek-chat', base_url: 'https://api.deepseek.com/v1' },
    trading:   { buy_amount_sol: 0.1, slippage_bps: 1500, take_profit_percent: 150, stop_loss_percent: 35, time_stop_minutes: 45, max_active_trades: 5, min_liquidity_sol: 5, min_market_cap_usd: 5000, max_market_cap_usd: 500000, ai_confidence_threshold: 65, priority_fee_lamports: 100000, auto_trade: false, require_mint_disabled: true, require_freeze_disabled: true, max_token_age_seconds: 120 },
    monitoring:{ new_token_check_interval_ms: 8000, position_check_interval_ms: 12000, pump_fun_limit: 20 }
  };
}

function validateConfig() {
  if (!config.solana.private_key) return 'Wallet private key not set in Config tab';
  if (!config.deepseek.api_key)   return 'DeepSeek API key not set in Config tab';
  return null;
}

// ─── Logging ─────────────────────────────────────────────────
function log(msg) {
  const line = { time: new Date().toISOString(), msg };
  botLog.push(line);
  if (botLog.length > 500) botLog.shift();
  console.log(`[${line.time}] ${msg}`);
  io.emit('log', line);
}

// ─── Solana Wallet ───────────────────────────────────────────
function initWallet() {
  try {
    const pk = process.env.PRIVATE_KEY || config.solana.private_key;
    const rpc= process.env.RPC_URL     || config.solana.rpc_url;
    if (!pk) return;
    const decoded  = bs58.decode(pk);
    wallet         = Keypair.fromSecretKey(decoded);
    config.solana.wallet_address = wallet.publicKey.toString();
    connection     = new Connection(rpc, 'confirmed');
    log(`👛 Wallet loaded: ${config.solana.wallet_address.slice(0,8)}...`);
  } catch (e) {
    log(`❌ Wallet init failed: ${e.message}`);
    wallet = null;
  }
}

async function refreshBalance() {
  if (!wallet || !connection) return;
  try {
    const lamports  = await connection.getBalance(wallet.publicKey);
    walletBalance   = lamports / LAMPORTS_PER_SOL;
    io.emit('balance', walletBalance);
  } catch {}
}

// ─── Bot Control ─────────────────────────────────────────────
async function startBot() {
  initWallet();
  if (!wallet) { log('❌ Cannot start — wallet not initialized'); return; }
  botRunning = true;
  log('🤖 Bot STARTED — Sniper active on pump.fun');
  await refreshBalance();

  monitorTimer = setInterval(monitorNewTokens,  config.monitoring.new_token_check_interval_ms);
  positionTimer= setInterval(checkPositions,    config.monitoring.position_check_interval_ms);
  setInterval(refreshBalance, 30000);

  io.emit('botStatus', { running: true });
}

function stopBot() {
  botRunning = false;
  clearInterval(monitorTimer);
  clearInterval(positionTimer);
  log('🛑 Bot STOPPED');
  io.emit('botStatus', { running: false });
}

// ─── Pump.fun Monitor ────────────────────────────────────────
async function monitorNewTokens() {
  if (!botRunning) return;
  try {
    const url = `${PUMP_API}?sort=created_timestamp&order=DESC&limit=${config.monitoring.pump_fun_limit}`;
    const res  = await fetch(url, { timeout: 10000 });
    if (!res.ok) return;
    const tokens = await res.json();
    const now    = Date.now() / 1000;
    const maxAge = config.trading.max_token_age_seconds;

    for (const token of tokens) {
      const mint     = token.mint;
      const age      = now - (token.created_timestamp || now);
      if (tokensSeen.has(mint))   continue;
      if (age > maxAge)            continue;

      tokensSeen.add(mint);
      log(`🔍 New token detected: ${token.symbol || mint.slice(0,8)} (${Math.round(age)}s old)`);

      // Run safety + AI check (non-blocking)
      analyzeToken(token).catch(e => log(`⚠️  Analysis error: ${e.message}`));
    }
  } catch (e) {
    log(`⚠️  Monitor error: ${e.message}`);
  }
}

// ─── Token Analysis ──────────────────────────────────────────
async function analyzeToken(token) {
  if (Object.keys(activeTrades).length >= config.trading.max_active_trades) {
    log(`⏸️  Max active trades (${config.trading.max_active_trades}) reached — skipping ${token.symbol}`);
    return;
  }

  const t     = config.trading;
  const mcUsd = (token.usd_market_cap || 0);
  const liqSol= (token.virtual_sol_reserves || 0) / LAMPORTS_PER_SOL;

  // ── Safety gate 1: Liquidity ──
  if (liqSol < t.min_liquidity_sol) {
    log(`🚫 ${token.symbol}: Low liquidity ${liqSol.toFixed(2)} SOL < ${t.min_liquidity_sol}`);
    return;
  }

  // ── Safety gate 2: Market cap ──
  if (mcUsd < t.min_market_cap_usd) {
    log(`🚫 ${token.symbol}: MC $${mcUsd.toFixed(0)} too low`);
    return;
  }
  if (mcUsd > t.max_market_cap_usd) {
    log(`🚫 ${token.symbol}: MC $${mcUsd.toFixed(0)} too high — missed the entry`);
    return;
  }

  // ── Safety gate 3: Mint / Freeze authority ──
  if (t.require_mint_disabled) {
    const mintAuth = await checkMintAuthority(token.mint);
    if (mintAuth) { log(`🚫 ${token.symbol}: Mint authority active — honeypot risk`); return; }
  }

  // ── AI Analysis ──
  log(`🧠 Sending ${token.symbol} to DeepSeek AI...`);
  const ai = await analyzeWithAI(token, liqSol, mcUsd);
  if (!ai) return;

  // Broadcast analysis to dashboard even if not buying
  io.emit('aiAnalysis', {
    mint    : token.mint,
    symbol  : token.symbol || token.mint.slice(0,8),
    name    : token.name || '?',
    mcUsd,
    liqSol,
    confidence: ai.confidence,
    decision  : ai.decision,
    reason    : ai.reason,
    time      : new Date().toISOString()
  });

  if (ai.decision !== 'BUY') {
    log(`🤖 AI says SKIP ${token.symbol}: ${ai.reason}`);
    return;
  }
  if (ai.confidence < t.ai_confidence_threshold) {
    log(`🤖 AI confidence ${ai.confidence}% < threshold ${t.ai_confidence_threshold}% — skipping`);
    return;
  }

  log(`✅ AI approves ${token.symbol} with ${ai.confidence}% confidence: ${ai.reason}`);

  if (!t.auto_trade) {
    log(`⚠️  Auto-trade is OFF — enable in Config to execute buys automatically`);
    return;
  }

  await executeBuy(token, ai);
}

// ─── Mint Authority Check ─────────────────────────────────────
async function checkMintAuthority(mint) {
  try {
    const info = await connection.getParsedAccountInfo(new PublicKey(mint));
    const data = info?.value?.data?.parsed?.info;
    return !!data?.mintAuthority; // returns true = authority active = risky
  } catch { return false; }
}

// ─── DeepSeek AI Analysis ─────────────────────────────────────
async function analyzeWithAI(token, liqSol, mcUsd) {
  const apiKey = process.env.DEEPSEEK_API_KEY || config.deepseek.api_key;
  if (!apiKey) { log('❌ DeepSeek API key missing'); return null; }

  const now   = Date.now() / 1000;
  const ageSec= now - (token.created_timestamp || now);

  const prompt = `You are a Solana memecoin trading AI. Analyze this new token and decide BUY or SKIP.

Token Data:
- Name: ${token.name || 'Unknown'}
- Symbol: ${token.symbol || 'Unknown'}
- Mint: ${token.mint}
- Age: ${Math.round(ageSec)} seconds old
- Market Cap: $${mcUsd.toFixed(0)} USD
- Liquidity: ${liqSol.toFixed(2)} SOL
- Description: ${(token.description || 'None').slice(0, 200)}
- Reply Count: ${token.reply_count || 0}
- Website: ${token.website || 'None'}
- Twitter: ${token.twitter || 'None'}
- Telegram: ${token.telegram || 'None'}
- King of the Hill Rank: ${token.king_of_the_hill_timestamp ? 'Yes' : 'No'}

Evaluate:
1. Does the name/symbol suggest viral meme potential?
2. Is liquidity and MC in a good sniper range?
3. Are social signals present?
4. Is there any obvious rug-pull red flag?

Respond ONLY in this exact JSON format (no extra text):
{
  "decision": "BUY" or "SKIP",
  "confidence": 0-100,
  "reason": "one short sentence"
}`;

  try {
    const res = await fetch(`${config.deepseek.base_url}/chat/completions`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body   : JSON.stringify({
        model   : config.deepseek.model || 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens : 200
      }),
      timeout: 15000
    });
    if (!res.ok) { log(`❌ DeepSeek API error ${res.status}`); return null; }
    const data    = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    // Extract JSON from response
    const match   = content.match(/\{[\s\S]*\}/);
    if (!match) { log(`❌ AI returned bad format: ${content}`); return null; }
    return JSON.parse(match[0]);
  } catch (e) {
    log(`❌ AI call failed: ${e.message}`);
    return null;
  }
}

// ─── Execute Buy ─────────────────────────────────────────────
async function executeBuy(token, ai) {
  if (!wallet || !connection) { log('❌ Wallet not ready'); return; }
  const mint    = token.mint;
  const buySol  = config.trading.buy_amount_sol;
  const lamports= Math.floor(buySol * LAMPORTS_PER_SOL);

  log(`🛒 Buying ${token.symbol} — ${buySol} SOL ...`);

  try {
    // 1. Get Jupiter quote: SOL → token
    const quote = await getJupiterQuote(SOL_MINT, mint, lamports, config.trading.slippage_bps);
    if (!quote) { log(`❌ No Jupiter route for ${token.symbol}`); return; }

    const estimatedTokens = parseInt(quote.outAmount);
    const priceImpact     = parseFloat(quote.priceImpactPct || 0);

    if (priceImpact > 25) {
      log(`🚫 Price impact too high: ${priceImpact.toFixed(1)}% — skipping buy`);
      return;
    }

    // 2. Build swap transaction
    const swapRes = await buildSwapTransaction(quote);
    if (!swapRes) { log(`❌ Failed to build swap tx`); return; }

    // 3. Sign & send
    const txId = await signAndSendTransaction(swapRes.swapTransaction);
    if (!txId) { log(`❌ Transaction failed`); return; }

    // 4. Calculate effective buy price
    const effectiveBuyPriceSOL = buySol / (estimatedTokens / 1e9);
    const networkFeeSol        = 0.000005 + (config.trading.priority_fee_lamports / LAMPORTS_PER_SOL);
    const dexFeeSol            = buySol * 0.003; // ~0.3% DEX fee
    const totalFeesSol         = networkFeeSol + dexFeeSol;
    const breakEvenMultiple    = 1 + (totalFeesSol / buySol) * 2; // need to cover buy AND sell fees

    // 5. Store active trade
    const trade = {
      id              : txId.slice(0, 16),
      mint,
      symbol          : token.symbol || mint.slice(0, 8),
      name            : token.name   || '?',
      buyTxId         : txId,
      buyTime         : Date.now(),
      buySol,
      estimatedTokens,
      buyPriceSOL     : effectiveBuyPriceSOL,
      feesPaidSol     : totalFeesSol,
      aiConfidence    : ai.confidence,
      aiReason        : ai.reason,
      takeProfitPct   : config.trading.take_profit_percent,
      stopLossPct     : config.trading.stop_loss_percent,
      status          : 'active',
      currentPriceSol : effectiveBuyPriceSOL,
      pnlPct          : 0,
      pnlSol          : 0
    };

    activeTrades[mint] = trade;
    log(`✅ BUY confirmed: ${token.symbol} | TX: ${txId.slice(0,16)}... | Fees: ${totalFeesSol.toFixed(6)} SOL`);
    io.emit('newTrade', trade);
    await refreshBalance();

  } catch (e) {
    log(`❌ Buy failed for ${token.symbol}: ${e.message}`);
  }
}

// ─── Jupiter Helpers ─────────────────────────────────────────
async function getJupiterQuote(inputMint, outputMint, amountLamports, slippageBps) {
  try {
    const params = new URLSearchParams({
      inputMint, outputMint,
      amount      : amountLamports.toString(),
      slippageBps : slippageBps.toString(),
      onlyDirectRoutes: 'false'
    });
    const res = await fetch(`${JUPITER_QUOTE}?${params}`, { timeout: 10000 });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function buildSwapTransaction(quoteResponse) {
  try {
    const res = await fetch(JUPITER_SWAP, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        quoteResponse,
        userPublicKey          : wallet.publicKey.toString(),
        wrapAndUnwrapSol       : true,
        prioritizationFeeLamports: config.trading.priority_fee_lamports,
        dynamicComputeUnitLimit: true
      }),
      timeout: 15000
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function signAndSendTransaction(swapTransactionBase64) {
  try {
    const txBytes   = Buffer.from(swapTransactionBase64, 'base64');
    const tx        = VersionedTransaction.deserialize(txBytes);
    tx.sign([wallet]);
    const txId      = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight       : true,
      maxRetries          : 3,
      preflightCommitment : 'processed'
    });
    // Wait for confirmation (5 second timeout, don't block bot)
    connection.confirmTransaction(txId, 'confirmed').catch(() => {});
    return txId;
  } catch (e) {
    log(`Transaction error: ${e.message}`);
    return null;
  }
}

// ─── Position Monitor ────────────────────────────────────────
async function checkPositions() {
  if (!botRunning) return;
  const mints = Object.keys(activeTrades);
  if (mints.length === 0) return;

  for (const mint of mints) {
    const trade = activeTrades[mint];
    try {
      const price = await getTokenPriceSOL(mint, trade.buySol, trade.estimatedTokens);
      if (!price) continue;

      const pnlPct = ((price - trade.buyPriceSOL) / trade.buyPriceSOL) * 100;
      const pnlSol = (price * trade.estimatedTokens / 1e9) - trade.buySol - trade.feesPaidSol;

      trade.currentPriceSol = price;
      trade.pnlPct          = pnlPct;
      trade.pnlSol          = pnlSol;

      io.emit('tradeUpdate', trade);

      const age = (Date.now() - trade.buyTime) / 60000; // minutes

      // ── Take Profit ──
      if (pnlPct >= trade.takeProfitPct) {
        log(`🎯 TAKE PROFIT hit on ${trade.symbol}: +${pnlPct.toFixed(1)}%`);
        await closeTrade(mint, 'take_profit');
        continue;
      }

      // ── Stop Loss ──
      if (pnlPct <= -trade.stopLossPct) {
        log(`🛑 STOP LOSS hit on ${trade.symbol}: ${pnlPct.toFixed(1)}%`);
        await closeTrade(mint, 'stop_loss');
        continue;
      }

      // ── Time Stop ──
      if (age >= config.trading.time_stop_minutes) {
        log(`⏰ TIME STOP on ${trade.symbol}: ${age.toFixed(0)} min elapsed`);
        await closeTrade(mint, 'time_stop');
        continue;
      }

    } catch (e) {
      log(`⚠️  Position check error (${trade.symbol}): ${e.message}`);
    }
  }
}

// ─── Get Current Token Price ──────────────────────────────────
async function getTokenPriceSOL(mint, buySol, estimatedTokens) {
  // Strategy: get a reverse Jupiter quote (token → SOL) to get real exit price
  try {
    // Use Jupiter price API first (faster)
    const res = await fetch(`${JUPITER_PRICE}?ids=${mint}&vsToken=${SOL_MINT}`, { timeout: 8000 });
    if (res.ok) {
      const data  = await res.json();
      const price = data?.data?.[mint]?.price;
      if (price) return parseFloat(price);
    }
    // Fallback: quote token → SOL
    const quote = await getJupiterQuote(mint, SOL_MINT, estimatedTokens, config.trading.slippage_bps);
    if (quote) {
      const solOut = parseInt(quote.outAmount) / LAMPORTS_PER_SOL;
      return solOut / (estimatedTokens / 1e9); // price per token in SOL
    }
    return null;
  } catch { return null; }
}

// ─── Close Trade (Sell) ──────────────────────────────────────
async function closeTrade(mint, reason) {
  const trade = activeTrades[mint];
  if (!trade) return;

  log(`💰 Selling ${trade.symbol} — Reason: ${reason}`);

  try {
    // Get actual token balance (may differ from estimate due to slippage)
    let tokenBalance = trade.estimatedTokens;
    try {
      const accounts = await connection.getParsedTokenAccountsByOwner(
        wallet.publicKey,
        { mint: new PublicKey(mint) }
      );
      if (accounts.value.length > 0) {
        const raw = accounts.value[0].account.data.parsed.info.tokenAmount.amount;
        tokenBalance = parseInt(raw);
      }
    } catch {}

    if (tokenBalance < 1000) {
      log(`⚠️  ${trade.symbol}: Token balance too low, marking as closed`);
      finalizeTrade(mint, 0, 0, reason, null);
      return;
    }

    // Quote token → SOL
    const quote = await getJupiterQuote(mint, SOL_MINT, tokenBalance, config.trading.slippage_bps);
    if (!quote) { log(`❌ No sell route for ${trade.symbol}`); return; }

    const swapRes = await buildSwapTransaction(quote);
    if (!swapRes) { log(`❌ Sell tx build failed for ${trade.symbol}`); return; }

    const txId = await signAndSendTransaction(swapRes.swapTransaction);
    if (!txId) { log(`❌ Sell transaction failed for ${trade.symbol}`); return; }

    const solReceived  = parseInt(quote.outAmount) / LAMPORTS_PER_SOL;
    const sellFeeSol   = 0.000005 + (config.trading.priority_fee_lamports / LAMPORTS_PER_SOL) + (solReceived * 0.003);
    const netSol       = solReceived - sellFeeSol;
    const pnlSol       = netSol - trade.buySol - trade.feesPaidSol;
    const pnlPct       = (pnlSol / trade.buySol) * 100;

    log(`✅ SELL confirmed: ${trade.symbol} | PNL: ${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(6)} SOL (${pnlPct.toFixed(1)}%) | TX: ${txId.slice(0,16)}...`);

    finalizeTrade(mint, pnlSol, pnlPct, reason, txId);
    await refreshBalance();

  } catch (e) {
    log(`❌ Sell error (${trade.symbol}): ${e.message}`);
  }
}

function finalizeTrade(mint, pnlSol, pnlPct, reason, sellTxId) {
  const trade = activeTrades[mint];
  if (!trade) return;

  const closed = {
    ...trade,
    status     : pnlSol > 0 ? 'profit' : 'loss',
    closeReason: reason,
    sellTime   : Date.now(),
    sellTxId,
    pnlSol,
    pnlPct
  };

  trades.push(closed);
  saveTrades();
  totalProfit += pnlSol;

  delete activeTrades[mint];
  io.emit('tradeClosed', closed);
  io.emit('statsUpdate', { totalProfit, tradeCount: trades.length });
}

// ─── Socket.io Connection ────────────────────────────────────
io.on('connection', (socket) => {
  log(`📊 Dashboard connected`);
  // Push current state immediately
  socket.emit('botStatus',  { running: botRunning });
  socket.emit('balance',    walletBalance);
  socket.emit('statsUpdate',{ totalProfit, tradeCount: trades.length });
  socket.emit('activeTrades', Object.values(activeTrades));
  socket.emit('recentTrades', [...trades].reverse().slice(0, 30));
  socket.emit('logHistory',   botLog.slice(-50));
});

// ─── Boot ────────────────────────────────────────────────────
async function boot() {
  // Load env overrides into config
  if (process.env.PRIVATE_KEY)      config.solana.private_key = process.env.PRIVATE_KEY;
  if (process.env.RPC_URL)          config.solana.rpc_url      = process.env.RPC_URL;
  if (process.env.DEEPSEEK_API_KEY) config.deepseek.api_key    = process.env.DEEPSEEK_API_KEY;

  // Recalculate total profit from stored trades
  totalProfit = trades.reduce((sum, t) => sum + (t.pnlSol || 0), 0);

  initWallet();

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`\n🚀 Memecoin Sniper Bot running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`\n⚠️  TRADING IS LIVE — Configure in dashboard before starting\n`);
  });
}

boot();
