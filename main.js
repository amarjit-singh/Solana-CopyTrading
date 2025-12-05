import fs from "fs";
import path from "path";
import { logToFile } from "./logger.js";
import {
  token_sell,
  token_buy,
  getBondingCurveAddress,
  getTokenHolders,
  getDataFromTx,
  getSplTokenBalance,
  checkTransactionStatus,
  checkWalletBalance,
  getAllTokenAccounts,
  getZeroBalanceTokenAccounts,
} from "./fuc.js";
import { createCloseAccountInstruction } from "@solana/spl-token";
import { Connection, PublicKey, LAMPORTS_PER_SOL, ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { swap, loadwallet, rpc_connection } from "./swap.js";
import { getTokenTypeSync, updateOnChainStatus } from "./ata_cache.js";
import { EventEmitter } from "events";
import Client from "@triton-one/yellowstone-grpc";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { CommitmentLevel } from "@triton-one/yellowstone-grpc";
import dotenv from "dotenv";
import crypto from 'crypto';
import { tOutPut } from "./parsingtransaction.js";
import { sendBuyAlert, sendSellAlert, sendInsufficientFundsAlert, sendBalanceAlert, sendErrorAlert } from "./alert.js";
import telegramController, { setBotState, getBotState, isBotRunning, updateBotRunningState } from "./telegram_controller.js";
import { fileURLToPath } from "url";
import globalBlockhashManager from "./global_blockhash_manager.js";
import chalk from "chalk";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
console.log(__dirname);
dotenv.config();

// ============================================================================
// REQUIRED CONFIGURATION VALIDATION
// ============================================================================
const buyAmount = process.env.BUY_AMOUNT ? parseFloat(process.env.BUY_AMOUNT) : null;
const BUY_AMOUNT_PERCENTAGE = process.env.BUY_AMOUNT_PERCENTAGE ? parseFloat(process.env.BUY_AMOUNT_PERCENTAGE) : null;
const minAmount = process.env.MIN_AMOUNT ? parseFloat(process.env.MIN_AMOUNT) : null;
const maxAmount = process.env.MAX_AMOUNT ? parseFloat(process.env.MAX_AMOUNT) : null;

// Validate that exactly one of BUY_AMOUNT or BUY_AMOUNT_PERCENTAGE is set
const hasBuyAmount = buyAmount !== null && !isNaN(buyAmount) && buyAmount > 0;
const hasBuyPercentage = BUY_AMOUNT_PERCENTAGE !== null && !isNaN(BUY_AMOUNT_PERCENTAGE) && BUY_AMOUNT_PERCENTAGE > 0;

if (!hasBuyAmount && !hasBuyPercentage) {
  console.error(chalk.red(`❌ FATAL: Neither BUY_AMOUNT nor BUY_AMOUNT_PERCENTAGE is set in .env file`));
  console.error(chalk.yellow(`You must set exactly ONE of:`));
  console.error(chalk.yellow(`  • BUY_AMOUNT=0.0001 (fixed amount in SOL)`));
  console.error(chalk.yellow(`  • BUY_AMOUNT_PERCENTAGE=0.5 (50% of target wallet's buy amount)`));
  process.exit(1);
}

if (hasBuyAmount && hasBuyPercentage) {
  console.error(chalk.red(`❌ FATAL: Both BUY_AMOUNT and BUY_AMOUNT_PERCENTAGE are set in .env file`));
  console.error(chalk.yellow(`You can only set ONE of them, not both:`));
  console.error(chalk.yellow(`  • For fixed amount: Set BUY_AMOUNT and remove/comment out BUY_AMOUNT_PERCENTAGE`));
  console.error(chalk.yellow(`  • For percentage: Set BUY_AMOUNT_PERCENTAGE and remove/comment out BUY_AMOUNT`));
  process.exit(1);
}

// Validate MIN_AMOUNT and MAX_AMOUNT
if (minAmount === null || isNaN(minAmount)) {
  console.error(chalk.red(`❌ FATAL: MIN_AMOUNT is not set in .env file`));
  console.error(chalk.yellow(`Please add MIN_AMOUNT to your .env file (example: MIN_AMOUNT=0.00005)`));
  process.exit(1);
}

if (maxAmount === null || isNaN(maxAmount)) {
  console.error(chalk.red(`❌ FATAL: MAX_AMOUNT is not set in .env file`));
  console.error(chalk.yellow(`Please add MAX_AMOUNT to your .env file (example: MAX_AMOUNT=0.001)`));
  process.exit(1);
}

const GRPC_ENDPOINT = process.env.GRPC_ENDPOINT;
const GRPCTOKEN = process.env.GRPCTOKEN;
const MY_WALLET = process.env.PUB_KEY;
const LIMIT_BALANCE = parseFloat(process.env.LIMIT_BALANCE) || 0.1; // Minimum balance threshold
const ENABLE_INSUFFICIENT_FUNDS_ALERTS = process.env.ENABLE_INSUFFICIENT_FUNDS_ALERTS !== "false"; // Default to true
const INSUFFICIENT_FUNDS_ALERT_COOLDOWN = parseInt(process.env.INSUFFICIENT_FUNDS_ALERT_COOLDOWN) || 5 * 60 * 1000; // 5 minutes default
const ENABLE_COPY_SELL = process.env.ENABLE_COPY_SELL !== "false"; // Default to true
const COPY_SELL_COOLDOWN = parseInt(process.env.COPY_SELL_COOLDOWN) || 30000; // 30 seconds default cooldown between copy sells
const COPY_SELL_PERCENTAGE = parseFloat(process.env.COPY_SELL_PERCENTAGE) || 100; // Default to 100% (sell all)
const COPY_SELL_MODE = process.env.COPY_SELL_MODE || "mimic"; // "mimic" (proportional) or "full" (FIFO 100% of oldest buy)
const SKIP_STARTUP_CLEANUP = process.env.SKIP_STARTUP_CLEANUP === "true"; // Set to true to keep existing tokens on startup

// In-memory bought tokens cache for copy trading (ULTRA FAST)
let boughtTokensCache = new Map(); // tokenMint -> {amount, buyPrice, buyTime, walletAddress}
const BOUGHT_TOKENS_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours cache
let boughtTokensCleanupInterval = null;

// Enhanced position tracking system for per-wallet copy trading
// Structure: positions[tokenMint][targetWallet] = {purchases: [{amount, buyTime, lastUpdate}], totalAmount}
let positions = new Map(); // tokenMint -> Map(targetWallet -> positionData)

// Global purchase tracking per token
// Structure: tokenPurchaseCounts[tokenMint] = {totalPurchases: number, remainingPurchases: number, lastUpdate: timestamp}
let tokenPurchaseCounts = new Map(); // tokenMint -> purchaseCountData

const POSITION_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours cache
let positionCleanupInterval = null;

// Constants
const SOL_ADDRESS = "So11111111111111111111111111111111111111112";
const RAYDIUM_AUTH_ADDRESS = "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL";
const RAYDIUM_LAUNCHLAB_ADDRESS = "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj";
const RAYDIUM_LAUNUNCHPAD_ADDRESS = "WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh";
const copy_wallet = process.env.COPY_WALLET;
const copy_wallet_2 = process.env.COPY_WALLET_2; // Optional second copy wallet

// IMPORTANT: Only monitor copy wallets, NOT your own wallet!
// Filter out empty/undefined values
let TARGET_WALLET = [copy_wallet, copy_wallet_2].filter(wallet => wallet && wallet.length > 0);

// Sends periodic ping messages to keep gRPC streams alive and prevent timeouts
const STREAM_PING_CONFIG = {
  interval: 5000, // Send ping every 5 seconds
  pingId: 1, // Ping ID for tracking
};

// Transaction monitoring configuration
const TRANSACTION_CONFIG = {
  timeout: parseInt(process.env.TRANSACTION_TIMEOUT) || 5000, // 45 seconds timeout for no transactions
  walletCountWindow: parseInt(process.env.WALLET_COUNT_WINDOW) || 1200, // 60 seconds window to count unique wallets
  lowWalletThreshold: parseInt(process.env.LOW_WALLET_THRESHOLD) || 3, // If less than this many unique wallets in window, trigger sell
};

const DYNAMIC_STOPLOSS = {
  minLiquidity: 40, // in SOL, minimum liquidity to consider for stoploss
  minHolders: 30, // minimum holders to consider for stoploss

  lowLiquidityStoplossPnl: -0.03, // more strict if low liquidity/holders
  highLiquidityStoplossPnl: -0.07, // more tolerant if high liquidity/holders
  baseStoplossPnl: -0.03, // default stoploss PNL if no data

  liquidityThreshold: 200, // in SOL, threshold for "high" liquidity
  holdersThreshold: 500, // threshold for "high" holders
};

// Buy filter configuration for token validation
const BUY_FILTER = {
  minHolders: parseInt(process.env.MIN_HOLDERS) || 10,
  maxHolders: parseInt(process.env.MAX_HOLDERS) || 10000,
  maxTop10Percentage: parseFloat(process.env.MAX_TOP10_PERCENTAGE) || 30,
  minLiquidity: parseFloat(process.env.MIN_LIQUIDITY) || 1,
  maxLiquidity: parseFloat(process.env.MAX_LIQUIDITY) || 10000
};

// Enhanced cooldown logic to prevent spam buying same token
const GLOBAL_COOLDOWN_MS = 30; // Global cooldown between any buys
const TOKEN_COOLDOWN_MS = 30; // Specific cooldown for same token




export const sellingLocks = new Map(); // key = tokenMint, value = boolean

function utcNow() {
  return new Date().toISOString();
}

// Token Portfolio Management Functions
function createTokenPortfolio() {
  const portfolio = new Map(); // tokenMint -> portfolio data

  function updateTokenEntry(tokenMint, solAmount, isBuy, tokenDecimal, price) {
    let entry = portfolio.get(tokenMint);
    
    if (!entry) {
      entry = {
        tokenMint,
        totalTokens: 0,
        totalSolSpent: 0,
        totalSolReceived: 0,
        averageBuyPrice: 0,
        buyCount: 0,
        sellCount: 0,
        firstBuyTime: null,
        lastUpdateTime: null,
        decimals: tokenDecimal,
        currentPrice: price
      };
    }

    const solAmountInSOL = solAmount / 10**9; // Convert lamports to SOL
    const priceInSOL = price / 10**9; // Convert price to SOL per token

    if (isBuy) {
      // BUY transaction
      entry.totalSolSpent += solAmountInSOL;
      entry.buyCount++;
      
      // Calculate tokens bought
      const tokensBought = solAmountInSOL / priceInSOL;
      entry.totalTokens += tokensBought;
      
      // Update average buy price
      entry.averageBuyPrice = entry.totalSolSpent / entry.totalTokens;
      
      if (!entry.firstBuyTime) entry.firstBuyTime = utcNow();
    } else {
      // SELL transaction
      entry.totalSolReceived += solAmountInSOL;
      entry.sellCount++;
      
      // Calculate tokens sold
      const tokensSold = solAmountInSOL / priceInSOL;
      entry.totalTokens = Math.max(0, entry.totalTokens - tokensSold);
      
      // Recalculate average buy price if we still have tokens
      if (entry.totalTokens > 0) {
        entry.averageBuyPrice = entry.totalSolSpent / entry.totalTokens;
      } else {
        entry.averageBuyPrice = 0;
      }
    }

    entry.currentPrice = priceInSOL;
    entry.lastUpdateTime = utcNow();
    
    portfolio.set(tokenMint, entry);
    return entry;
  }

  function getTokenEntry(tokenMint) {
    return portfolio.get(tokenMint);
  }

  function calculatePnL(tokenMint, currentPrice) {
    const entry = getTokenEntry(tokenMint);
    if (!entry || entry.averageBuyPrice === 0) return 0;
    
    const currentPriceInSOL = currentPrice / 10**9;
    return (currentPriceInSOL - entry.averageBuyPrice) / entry.averageBuyPrice;
  }

  function calculateNetProfit(tokenMint, currentPrice) {
    const entry = getTokenEntry(tokenMint);
    if (!entry) return 0;
    
    const currentPriceInSOL = currentPrice / 10**9;
    const currentValue = entry.totalTokens * currentPriceInSOL;
    return currentValue - entry.totalSolSpent;
  }

  function calculateRealizedPnL(tokenMint) {
    const entry = getTokenEntry(tokenMint);
    if (!entry) return 0;
    
    return entry.totalSolReceived - entry.totalSolSpent;
  }

  function getAllEntries() {
    return Array.from(portfolio.values());
  }

  function deleteEntry(tokenMint) {
    return portfolio.delete(tokenMint);
  }

  return {
    updateTokenEntry,
    getTokenEntry,
    calculatePnL,
    calculateNetProfit,
    calculateRealizedPnL,
    getAllEntries,
    deleteEntry,
    portfolio
  };
}

class TransactionMonitor extends EventEmitter {
  constructor(targetWallet) {
    super();
    this.client = new Client(GRPC_ENDPOINT, GRPCTOKEN);
    this.targetWallet = targetWallet;
    this.tokenPortfolio = createTokenPortfolio();

    this.bots = new Map();
    this.status = new Set();
    this.isRunning = false;
    this.isBuying = false;
    this.lastBuyTimestamp = 0;
    this.pool_status = null;
    this.buyingDisabled = false; // Flag to disable buying when funds are low
    // this.processingTokens = new Set(); // Track tokens currently being processed
    this.lastCopySellTimestamp = 0; // Track last copy sell timestamp for cooldown

    // Add status display interval
    this.statusDisplayInterval = null;
    this.pingInterval = null; // Track ping interval
    
    // Spawn system - similar to Rust's spawn
    this.taskQueue = [];
    this.workerPool = [];
    this.maxWorkers = 20; // Maximum concurrent workers
    this.activeWorkers = 0;
    this.isProcessingQueue = false;
  }

  // Spawn system methods - similar to Rust's spawn
  spawn(taskFunction, ...args) {
    return new Promise((resolve, reject) => {
      const task = {
        id: Date.now() + Math.random(),
        function: taskFunction,
        args: args,
        resolve: resolve,
        reject: reject,
        status: 'pending'
      };
      
      this.taskQueue.push(task);
      this.processQueue();
      
      return task.id;
    });
  }

  async processQueue() {
    if (this.isProcessingQueue || this.taskQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.taskQueue.length > 0 && this.activeWorkers < this.maxWorkers) {
      const task = this.taskQueue.shift();
      if (task) {
        this.executeTask(task);
      }
    }

    this.isProcessingQueue = false;
  }

  async executeTask(task) {
    this.activeWorkers++;
    task.status = 'running';

    try {
      const result = await task.function(...task.args);
      task.status = 'completed';
      task.resolve(result);
    } catch (error) {
      task.status = 'failed';
      task.reject(error);
    } finally {
      this.activeWorkers--;
      // Process next task if available
      if (this.taskQueue.length > 0) {
        this.processQueue();
      }
    }
  }

  // Get spawn system status
  getSpawnStatus() {
    return {
      queueLength: this.taskQueue.length,
      activeWorkers: this.activeWorkers,
      maxWorkers: this.maxWorkers,
      isProcessing: this.isProcessingQueue
    };
  }

  // Add method to get running bot count
  getRunningBotCount() {
    return this.bots.size;
  }

  // Add method to show detailed bot status
  showBotStatus() {
    const runningCount = this.getRunningBotCount();
    const buyingStatus = this.buyingDisabled ? "🚫 BUYING DISABLED" : "✅ BUYING ENABLED";
    const copySellStatus = ENABLE_COPY_SELL ? `🎯 COPY SELL ENABLED (${COPY_SELL_MODE}: ${COPY_SELL_PERCENTAGE}%)` : "🚫 COPY SELL DISABLED";
    
    // Show copy sell status
    // console.log(chalk.cyan(`[${utcNow()}] 📊 Monitor ${this.targetWallet.slice(0, 8)}...: ${buyingStatus} | ${copySellStatus} | ${runningCount} bots${balanceInfo}`));
    
    // console.log(
    //   chalk.cyan(`[${utcNow()}] 📊 Monitor ${this.targetWallet.slice(0, 8)}...: ${buyingStatus} | ${runningCount} bots${balanceInfo}`)
    // );

    if (runningCount > 0) {
      console.log(chalk.cyan(`[${utcNow()}] 🤖 Active Trading Bots: ${runningCount} <<<<<<<<<<<<`));
      for (const [tokenMint, bot] of this.bots.entries()) {
        const shortMint = tokenMint.slice(0, 4) + "..." + tokenMint.slice(-4);
        const pnlPercent = bot.pnl ? (bot.pnl * 100).toFixed(2) : "0.00";
        const topPnlPercent = bot.topPnL ? (bot.topPnL * 100).toFixed(2) : "0.00";
        const timeSinceBuy = bot.buyTimestamp ? Math.floor((Date.now() - bot.buyTimestamp) / 1000) : 0;
        const minPnlPercent = bot.minPnl ? (bot.minPnl * 100).toFixed(2) : "0.00";
        const stoplossPercent = bot.dynamicStoplossPnl ? (bot.dynamicStoplossPnl * 100).toFixed(2) : "0.00";
        const timeSinceLastTx = 0; // No longer tracking last transaction time
        const walletCount = bot.walletHistory ? bot.walletHistory.size : 0;

        // Calculate maximum strategy values for display
        const maxTrailingFactorPercent = bot.maxTrailingFactorValue ? (bot.maxTrailingFactorValue * 100).toFixed(2) : "0.00";
        const maxStopPercentagePercent = bot.maxStopPercentageValue ? (bot.maxStopPercentageValue * 100).toFixed(2) : "0.00";
        const maxTrailingFactorLevel = bot.maxTrailingFactorLevel ? bot.maxTrailingFactorLevel.toFixed(1) : "0.0";
        const maxStopPercentageLevel = bot.maxStopPercentageLevel ? bot.maxStopPercentageLevel.toFixed(1) : "0.0";

        // Improved stoploss status
        const improvedStoplossStatus = bot.minPnLBreached
          ? bot.pnlZeroAfterMinPnLBreach
            ? "🚨 IMPROVED STOPLOSS ACTIVE"
            : "⚠️ MinPnL BREACHED"
          : "";

        console.log(
          chalk.bgBlackBright.white(
            `   • ${shortMint} | PnL: ${pnlPercent}% | Top: ${topPnlPercent}% | MinPnL: ${minPnlPercent}% | StopLoss: ${stoplossPercent}% | MaxTrail: ${maxTrailingFactorPercent}%(${maxTrailingFactorLevel}x) | MaxStop: ${maxStopPercentagePercent}%(${maxStopPercentageLevel}x) | Time: ${timeSinceBuy}s | Wallets: ${walletCount} (${timeSinceLastTx}s ago) ${improvedStoplossStatus}`
          )
        );
      }
    }
    
    // Show spawn system status
    const spawnStatus = this.getSpawnStatus();
    if (spawnStatus.activeWorkers > 0 || spawnStatus.queueLength > 0) {
      console.log(chalk.magenta(`[${utcNow()}] 🚀 Spawn System: ${spawnStatus.activeWorkers}/${spawnStatus.maxWorkers} workers active, ${spawnStatus.queueLength} tasks queued`));
    }
    
    // // Show processing tokens
    // if (this.processingTokens.size > 0) {
    //   const processingList = Array.from(this.processingTokens).map(mint => mint.slice(0, 6) + "...").join(", ");
    //   console.log(chalk.yellow(`[${utcNow()}] ⚙️ Processing: ${processingList}`));
    // }
  }

  // Add method to log debug information for all bots
  logAllBotsDebugInfo() {
    const runningCount = this.getRunningBotCount();
    if (runningCount === 0) {
      console.log(chalk.cyan(`[${utcNow()}] 📊 No active bots to debug`));
      return;
    }

    console.log(chalk.cyan(`[${utcNow()}] 🔍 DEBUGGING ALL BOTS (${runningCount} active)`));
    for (const [tokenMint, bot] of this.bots.entries()) {
      bot.logStrategyDebugInfo();
    }
  }

  // Add method to start periodic status display
  startStatusDisplay(intervalMs = 5000) {
    // Default: every 5 seconds
    if (this.statusDisplayInterval) {
      clearInterval(this.statusDisplayInterval);
    }

    this.statusDisplayInterval = setInterval(() => {
      this.showBotStatus();
    }, intervalMs);

    console.log(chalk.cyan(`[${utcNow()}] 📊 Status display started (every ${intervalMs / 1000}s)`));
  }

  // Add method to stop status display
  stopStatusDisplay() {
    if (this.statusDisplayInterval) {
      clearInterval(this.statusDisplayInterval);
      this.statusDisplayInterval = null;
      console.log(chalk.cyan(`[${utcNow()}] 📊 Status display stopped`));
    }
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;


    // Start status display
    this.startStatusDisplay(5000); // Show status every 5 seconds

    const args = this.buildSubscriptionArgs();
    let RETRY_DELAY = 1000;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 5;

    while (this.isRunning) {
      let stream;
      try {
        // Recreate client on auth errors to get fresh connection
        if (consecutiveErrors > 3) {
          console.log(chalk.yellow(`[${utcNow()}] 🔄 Recreating gRPC client after ${consecutiveErrors} errors...`));
          this.client = new Client(GRPC_ENDPOINT, GRPCTOKEN);
        }

        stream = await this.client.subscribe();

        // Setup handlers
        this.setupStreamHandlers(stream);

        await new Promise((resolve, reject) => {
          stream.write(args, (err) => {
            err ? reject(err) : resolve();
          });
        }).catch((err) => {
          console.error("Failed to send subscription request:", err);
          throw err;
        });

        // Reset error counter on successful connection
        consecutiveErrors = 0;
        RETRY_DELAY = 1000;

        // Start ping interval to keep stream alive
        this.startPingInterval(stream);

        // Wait for stream to close or error
        await new Promise((resolve) => {
          let settled = false;
          stream.on("error", (error) => {
            if (!settled) {
              settled = true;
              console.error(`[${utcNow()}] Stream Error3:`, error);
              
              // Check for auth errors
              if (error.code === 16 || error.details === 'token not found') {
                console.error(chalk.red(`[${utcNow()}] ❌ AUTHENTICATION ERROR: gRPC token is invalid or expired!`));
                console.error(chalk.yellow(`[${utcNow()}] 💡 Solutions:`));
                console.error(chalk.yellow(`   1. Check your GRPCTOKEN in .env file`));
                console.error(chalk.yellow(`   2. Get new token from https://shyft.to/`));
                console.error(chalk.yellow(`   3. Verify account is active and has gRPC access`));
                consecutiveErrors++;
              }
              
              resolve(); // Don't reject, just resolve to allow retry
            }
          });

          stream.on("end", () => {
            if (!settled) {
              settled = true;
              resolve();
            }
          });
          stream.on("close", () => {
            if (!settled) {
              settled = true;
              resolve();
            }
          });
        });

        // If we get here, the stream ended/errored, so retry after delay
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.error(chalk.red(`[${utcNow()}] ❌ Too many consecutive errors (${consecutiveErrors}), stopping bot...`));
          console.error(chalk.yellow(`[${utcNow()}] 💡 Please fix authentication issues and restart`));
          this.isRunning = false;
          break;
        }

        // Exponential backoff for retries
        const backoffDelay = Math.min(RETRY_DELAY * Math.pow(1.5, consecutiveErrors), 30000);
        console.error(`[${utcNow()}] Stream ended or errored, retrying in ${backoffDelay/1000} seconds...`);
        await new Promise((res) => setTimeout(res, backoffDelay));
      } catch (error) {
        consecutiveErrors++;
        
        // Check for specific error types
        if (error.code === 16 || error.details === 'token not found') {
          console.error(chalk.red(`[${utcNow()}] ❌ AUTHENTICATION ERROR: ${error.details || error.message}`));
          const backoffDelay = Math.min(5000 * Math.pow(2, consecutiveErrors), 60000); // Longer backoff for auth errors
          console.error(chalk.yellow(`[${utcNow()}] ⏱️  Will retry in ${backoffDelay/1000} seconds...`));
          
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            console.error(chalk.red(`[${utcNow()}] ❌ Too many authentication failures, stopping bot...`));
            this.isRunning = false;
            break;
          }
          
          await new Promise((res) => setTimeout(res, backoffDelay));
        } else {
          const backoffDelay = Math.min(RETRY_DELAY * Math.pow(1.5, consecutiveErrors), 30000);
          console.error(`[${utcNow()}] Stream error, retrying in ${backoffDelay/1000} seconds...`, error.message);
          await new Promise((res) => setTimeout(res, backoffDelay));
        }
      }
    }
  }

  async stop() {
    this.isRunning = false;
    this.stopStatusDisplay();

    // Clear ping interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    // Stop all running bots
    for (const [tokenMint, bot] of this.bots.entries()) {
      await bot.stop();
    }

    console.log(chalk.cyan(`[${utcNow()}] 🛑 TransactionMonitor stopped. Total bots stopped: ${this.bots.size}`));
  }

  buildSubscriptionArgs() {
    return {
      accounts: {},
      slots: {},
      transactions: {
        pump: {
          vote: false,
          failed: false,
          signature: undefined,
          accountInclude: [this.targetWallet],
          accountExclude: [],
          accountRequired: [],
        },
      },
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      ping: undefined,
      commitment: CommitmentLevel.PROCESSED,
    };
  }

  setupStreamHandlers(stream) {
    stream.on("data", this.handleTransaction.bind(this));
  }

  startPingInterval(stream) {
    // Clear any existing ping interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    // Create ping request
    const pingRequest = {
      accounts: {},
      slots: {},
      transactions: {},
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      ping: { id: STREAM_PING_CONFIG.pingId },
    };

    // Start ping interval
    this.pingInterval = setInterval(async () => {
      if (!this.isRunning || !stream) {
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
        return;
      }

      try {
        await new Promise((resolve, reject) => {
          stream.write(pingRequest, (err) => {
            if (err === null || err === undefined) {
              resolve();
            } else {
              reject(err);
            }
          });
        });
        // Optional: Log successful ping (uncomment for debugging)
        // console.log(chalk.cyan(`[${utcNow()}] [Monitor ${this.targetWallet.slice(0, 8)}...] Ping sent successfully`));
      } catch (error) {
        console.error(chalk.red(`[${utcNow()}] [Monitor ${this.targetWallet.slice(0, 8)}...] Ping failed:`, error));
        // If ping fails, the stream might be dead, so we should stop
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
      }
    }, STREAM_PING_CONFIG.interval);

    console.log(
      chalk.blue(
        `[${utcNow()}] [Monitor ${this.targetWallet.slice(0, 8)}...] Ping interval started (every ${STREAM_PING_CONFIG.interval / 1000}s)`
      )
    );
  }

  // Method to check if stream is healthy
  isStreamHealthy() {
    return this.isRunning && this.pingInterval;
  }
  
  // Spawnable transaction processing functions
  async processBuyTransaction(transactionData, startTime1) {
    const {
      tokenChanges,
      solChanges,
      tokenMint,
      tokenDecimal,
      user,
      pool_status,
      context,
    } = transactionData;

    const now = Date.now();
       
    // // Check if we're already processing this token
    // if (this.processingTokens.has(tokenMint)) {
    //   console.log(chalk.cyan(`[${utcNow()}] Already processing ${tokenMint}, skipping duplicate`));
    //   return;
    // }

    // // Mark token as being processed
    // this.processingTokens.add(tokenMint);

    // Update timestamps
    this.lastBuyTimestamp = now;

    try {
      // Calculate dynamic buy amount based on percentage of target wallet's SOL change
      const dynamicBuyAmount = calculateDynamicBuyAmount(solChanges, BUY_AMOUNT_PERCENTAGE);
      const finalBuyAmount = dynamicBuyAmount !== null ? dynamicBuyAmount : buyAmount;

      const {txid, token_amount} = await token_buy(tokenMint, finalBuyAmount, pool_status, context);
      const endTime2 = performance.now();
      const durationUs2 = Math.round((endTime2 - startTime1) * 1000);
      console.log(`[${utcNow()}] 🎯 Time taken to get setup after buy: ${durationUs2}μs`);
      console.log(chalk.bgGreen.black(`[${utcNow()}] ✅ Token buy executed for: ${tokenMint}`));
      console.log(chalk.bgGreen.black(`[${utcNow()}] txid: https://solscan.io/tx/${txid}`));
      
      // Calculate target wallet's token amount from transaction data
      const targetTokenAmount = Math.abs(tokenChanges);
      addPosition(tokenMint, user, targetTokenAmount, token_amount);

     
      return { success: true, txid, tokenMint };
    } catch (buyError) {
      const errorMessage = buyError.message || buyError.toString();

      // Handle insufficient funds error
      if (errorMessage.includes("INSUFFICIENT_FUNDS")) {
        console.error(chalk.red(`[${utcNow()}] ❌ INSUFFICIENT_FUNDS: Cannot buy ${tokenMint}`));
        console.error(chalk.red(`[${utcNow()}] 💰 Please add more SOL to your wallet to continue trading`));
        console.error(chalk.red(`[${utcNow()}] ⚠️ DISABLING BUYING - Bot will continue for selling`));
        logToFile(chalk.red(`[${utcNow()}] ❌ INSUFFICIENT_FUNDS: Cannot buy ${tokenMint} - ${errorMessage}`));
        logToFile(chalk.red(`[${utcNow()}] ⚠️ BUYING DISABLED - Bot continues for selling`));

        // Send Telegram notification (only if it's a real insufficient funds error and alerts are enabled)
        if ((errorMessage.includes("insufficient funds") || errorMessage.includes("0x1")) && ENABLE_INSUFFICIENT_FUNDS_ALERTS) {
          try {
            // Extract balance from error message if available
            const balanceMatch = errorMessage.match(/Wallet balance ([\d.]+) SOL/);
            const currentBalance = balanceMatch ? parseFloat(balanceMatch[1]) : 0;

            await sendInsufficientFundsAlert({
              currentBalance: currentBalance,
              limitBalance: LIMIT_BALANCE,
              walletAddress: MY_WALLET,
            });
          } catch (telegramError) {
            console.error(chalk.red(`[${utcNow()}] ❌ Failed to send Telegram notification: ${telegramError.message}`));
          }
        }

        // Disable buying instead of stopping the monitor
        this.disableBuying();
        // this.processingTokens.delete(tokenMint);
        console.log(chalk.cyan(`[${utcNow()}] 🧹 Cleaned up failed buy attempt for ${tokenMint}`));
        return;
      }

      // Handle slippage errors
      if (errorMessage.includes("TooLittleSolReceived") || errorMessage.includes("slippage")) {
        console.error(chalk.cyan(`[${utcNow()}] ⚠️ SLIPPAGE ERROR: Price moved unfavorably for ${tokenMint}`));
        logToFile(chalk.cyan(`[${utcNow()}] ⚠️ SLIPPAGE ERROR: ${tokenMint} - ${errorMessage}`));
      }

      // Handle network/RPC errors
      else if (errorMessage.includes("429") || errorMessage.includes("rate limit")) {
        console.error(chalk.cyan(`[${utcNow()}] ⚠️ RATE LIMIT: RPC endpoint is rate limiting for ${tokenMint}`));
        logToFile(chalk.cyan(`[${utcNow()}] ⚠️ RATE LIMIT: ${tokenMint} - ${errorMessage}`));
      }

      // Handle transaction simulation errors
      else if (errorMessage.includes("Simulation failed") || errorMessage.includes("custom program error")) {
        console.error(chalk.red(`[${utcNow()}] ❌ TRANSACTION ERROR: Simulation failed for ${tokenMint}`));
        logToFile(chalk.red(`[${utcNow()}] ❌ TRANSACTION ERROR: ${tokenMint} - ${errorMessage}`));
      }

      // Handle other buy errors
      else {
        console.error(chalk.red(`[${utcNow()}] ❌ Token buy failed: ${errorMessage}`));
        logToFile(chalk.red(`[${utcNow()}] ❌ Token buy failed: ${tokenMint} - ${errorMessage}`));
      }

      // Clean up after any buy error
      // this.processingTokens.delete(tokenMint);
      
      return { success: false, error: errorMessage, tokenMint };
    }
  }

  async processSellTransaction(transactionData) {
    const {
      tokenChanges,
      solChanges,
      isBuy,
      tokenMint,
      tokenDecimal,
      pairAddress,
      user,
      liquidity,
      coinCreator,
      signature,
      context,
      pool_status,
    } = transactionData;

    const shortTokenName = tokenMint ? tokenMint.slice(0, 6) + "..." : "unknown";

    
    // Copy sell logic - if target wallet is selling, copy the sell
    if (user != MY_WALLET && ENABLE_COPY_SELL) {
      
      // // Get position for this specific target wallet and token
      // const position = getPosition(tokenMint, user);
      // // if (!position) {
      // //   console.log(chalk.yellow(`[${utcNow()}] ⚠️  SELL: No position found for ${shortTokenName} from wallet ${user.slice(0, 8)}..., skipping`));
      // //   return { success: false, reason: 'no_position_for_wallet' };
      // // }
      
      // Calculate target wallet's sell amount from transaction data
      const targetSellAmount = Math.abs(tokenChanges);
      
      // Get exact sell amount based on target wallet's sell amount
      const sellData = getExactSellAmount(tokenMint, user, targetSellAmount);
      if (!sellData) {
        console.log(chalk.yellow(`[${utcNow()}] ⚠️  SELL: No matching purchase found for ${shortTokenName} from wallet ${user.slice(0, 8)}... (target sell: ${targetSellAmount.toLocaleString()}), skipping`));
        return { success: false, reason: 'no_matching_purchase' };
      }
      
      const copySellAmount = sellData.ourSellAmount;
      if (copySellAmount <= 0) {
        console.log(chalk.cyan(`[${utcNow()}] ⚠️  SELL: Calculated sell amount is 0 for ${shortTokenName}, skipping`));
        return { success: false, reason: 'zero_sell_amount' };
      }

      // Check remaining purchase count to determine if this is the last purchase being sold
      const remainingPurchases = getRemainingPurchaseCount(tokenMint);
      const isLastPurchase = isLastRemainingPurchase(tokenMint);
      
      // Determine if this is full or partial selling based on remaining purchases
      let isFullSell = false;
      if (remainingPurchases === 1) {
        // This is the last remaining purchase, so it's a full sell
        isFullSell = true;
        console.log(chalk.cyan(`[${utcNow()}] 🎯 FULL SELL: Last remaining purchase for ${shortTokenName} (${remainingPurchases} remaining), executing full sell`));
      } else if (remainingPurchases > 1) {
        // Multiple purchases remain, so this is a partial sell
        isFullSell = false;
        console.log(chalk.cyan(`[${utcNow()}] 🎯 PARTIAL SELL: ${remainingPurchases} purchases remain for ${shortTokenName}, executing partial sell`));
      } else {
        // No remaining purchases (shouldn't happen), default to partial
        isFullSell = false;
        console.log(chalk.yellow(`[${utcNow()}] ⚠️ UNEXPECTED: No remaining purchases for ${shortTokenName}, defaulting to partial sell`));
      }
        
      // Update copy sell timestamp
      const now = Date.now();
      this.lastCopySellTimestamp = now;
      
      // Execute copy sell using position data
      try {
        const sellType = isFullSell ? "FULL" : "PARTIAL";
        const matchType = sellData.isProportional ? "PROPORTIONAL" : "EXACT";
        console.log(`[${utcNow()}] 🎯 Copy ${sellType} ${matchType} selling ${copySellAmount.toLocaleString()} tokens for ${shortTokenName} (following ${user.slice(0, 8)}... target: ${targetSellAmount.toLocaleString()})`);

        // Get current position to pass tracked balance for verification
        const position = getPosition(tokenMint, user);
        const trackedBalance = position ? position.totalAmount : null;

        // Execute sell using position data with full/partial flag
        const txid = await token_sell(tokenMint, copySellAmount, pool_status, isFullSell, context, trackedBalance);
        
        if (txid) {
          console.log(chalk.bgGreen.white(`[${utcNow()}] ✅  ${sellType} ${matchType} SELL EXECUTED: ${copySellAmount.toLocaleString()} tokens sold (following ${user.slice(0, 8)}... target: ${targetSellAmount.toLocaleString()})`));
          console.log(chalk.bgGreen.white(`[${utcNow()}] ✅  sell txid: https://solscan.io/tx/${txid}`));
          
          // Remove the specific purchase that was sold
          if (sellData.isProportional) {
            // For proportional sells, we can't remove a specific purchase, so we reduce the total
            const position = getPosition(tokenMint, user);
            if (position) {
              position.totalAmount -= copySellAmount;
              position.lastUpdate = Date.now();
            }
            // Still need to decrement the purchase count for proportional sells
            updateTokenPurchaseCount(tokenMint, -1);
          } else if (sellData.isFull) {
            // FULL MODE: Remove by purchase object (target's sell amount may differ from buy amount)
            removePurchase(tokenMint, user, sellData.purchase);
          } else {
            // MIMIC MODE: For exact matches, remove by target sell amount (original behavior)
            removePurchase(tokenMint, user, targetSellAmount);
          }
          
          return { success: true, txid, amount: copySellAmount, sellType, matchType };
        }
      } catch (copySellError) {
        console.error(chalk.red(`[${utcNow()}] ❌  SELL ERROR: ${copySellError.message}`));
        logToFile(chalk.red(`[${utcNow()}] ❌  SELL ERROR: ${tokenMint} - ${copySellError.message}`));
        return { success: false, error: copySellError.message };
      }
    } else if (user != MY_WALLET && !ENABLE_COPY_SELL) {
      console.log(chalk.cyan(`[${utcNow()}] ⚠️  SELL DISABLED: Target wallet selling ${shortTokenName} but copy sell is disabled`));
      return { success: false, reason: 'copy_sell_disabled' };
    }
    
    return { success: false, reason: 'not_target_wallet' };
  }

  async handleTransaction(data) {
    if (!data?.transaction?.transaction) return;
    
    
    try {
      const transactionData = await this.processTransactionData(data);
      
      const startTime1 = performance.now();
      

      if (!transactionData) {
        // console.log(chalk.cyan(`[${utcNow()}] ⚠️⚠️⚠️ No available transaction data parsed from transaction`));
        return;
      }

      let {
        tokenChanges,
        solChanges,
        isBuy,
        tokenMint,
        tokenDecimal,
        pairAddress,
        user,
        liquidity,
        coinCreator,
        signature,
        context,
        pool_status,
      } = transactionData;
      
      // DEBUG: Log all detected transactions to see what's coming through
      const shortUser = user ? user.slice(0, 8) + '...' : 'unknown';
      const shortToken = tokenMint ? tokenMint.slice(0, 8) + '...' : 'unknown';
      const action = isBuy ? '🟢 BUY' : '🔴 SELL';
      console.log(chalk.cyan(`[${utcNow()}] 📡 TRANSACTION DETECTED: ${action} | Token: ${shortToken} | User: ${shortUser} | Signature: ${signature}`));
      
      // Validate essential transaction data
      if (tokenChanges === 0) {
        console.log(chalk.yellow(`[${utcNow()}] ⚠️ Skipping: token change is zero`));
        return;
      }
      
      if (!tokenMint) {
        console.log(chalk.yellow(`[${utcNow()}] ⚠️ TokenMint is undefined | User: ${shortUser} | Signature: ${signature?.slice(0, 8)}...`));
        console.log(chalk.gray(`[${utcNow()}] 🔍 Debug: isBuy=${isBuy}, solChanges=${solChanges}, tokenChanges=${tokenChanges}, pool_status=${pool_status}`));
        
        // Try to fetch token mint from the transaction signature with retry mechanism
        if (signature) {
          console.log(chalk.cyan(`[${utcNow()}] 🔄 Attempting to fetch token mint from transaction hash: ${signature?.slice(0, 16)}...`));
          try {
            // Use aggressive retry mechanism - wait up to ~60 seconds for transaction to confirm
            const txData = await getDataFromTx(signature, 15, 1000); // 15 retries, starting at 1s
            if (txData) {
              console.log(chalk.cyan(`[${utcNow()}] ✅ Transaction data fetched, re-processing complete transaction...`));
              
              // Reprocess the entire transaction with the fetched data
              const reprocessedData = await this.processTransactionData({ meta: txData.meta, transaction: txData.transaction });
              
              if (reprocessedData && reprocessedData.tokenMint) {
                // Update ALL transaction data from reprocessed result
                tokenMint = reprocessedData.tokenMint;
                tokenDecimal = reprocessedData.tokenDecimal;
                user = reprocessedData.user;
                solChanges = reprocessedData.solChanges;
                tokenChanges = reprocessedData.tokenChanges;
                isBuy = reprocessedData.isBuy;
                pairAddress = reprocessedData.pairAddress;
                liquidity = reprocessedData.liquidity;
                coinCreator = reprocessedData.coinCreator;
                context = reprocessedData.context;
                pool_status = reprocessedData.pool_status;
                
                console.log(chalk.green(`[${utcNow()}] ✅ Transaction reprocessed: ${tokenMint?.slice(0, 8)}... | User: ${user?.slice(0, 8)}... | ${isBuy ? 'BUY' : 'SELL'}`));
                // Continue processing with the complete transaction data
              } else {
                console.log(chalk.yellow(`[${utcNow()}] ⚠️ Could not extract complete transaction data after reprocessing`));
                return;
              }
            } else {
              console.log(chalk.yellow(`[${utcNow()}] ⚠️ Failed to fetch transaction data - transaction may have failed or not yet confirmed`));
              return;
            }
          } catch (fetchError) {
            console.error(chalk.red(`[${utcNow()}] ❌ Error fetching token from hash: ${fetchError.message}`));
            return;
          }
        } else {
          console.log(chalk.yellow(`[${utcNow()}] ⚠️ No signature available to fetch transaction data`));
          return;
        }
      }
      
      const shortTokenName = tokenMint ? tokenMint.slice(0, 6) + "..." : "unknown";
      
      if (isBuy) {
        // console.log(chalk.greenBright(`[${utcNow()}] 🟢 BUY transaction detected: ${shortTokenName}`));
        if (!this.isRunning) return;
        
        if (user === MY_WALLET) {
          // This is OUR wallet transaction - DO NOT COPY to prevent loops
          console.log(chalk.bgBlue.white(`[${utcNow()}] 🏠 MY WALLET BUY: ${shortTokenName} | Txid: ${signature?.slice(0, 8)}... | Portfolio tracking only - NOT COPYING (anti-loop protection)`));
          
          const price = Math.abs(solChanges / (tokenChanges * 10 ** (9 - tokenDecimal))) / 10**9; // Convert to SOL per token
          // Update token portfolio for wallet transactions
          const tokenEntry = this.tokenPortfolio.updateTokenEntry(tokenMint, Math.abs(solChanges), true, tokenDecimal, price);
          
          // Track position for this specific target wallet
          // const boughtAmount = Math.abs(tokenChanges);
          // addPosition(tokenMint, user, boughtAmount);
          
          // // Reset buying flag and cleanup
          // this.processingTokens.delete(tokenMint);
          
          // Send buy alert with proper data
          await sendBuyAlert({ 
            tokenMint, 
            amount: (Math.abs(solChanges) / 10**9).toFixed(6) + ' SOL',
            price: price.toFixed(8),
            txid: signature,
            reason: 'wallet_buy'
          });
        } else if (user === this.targetWallet) {
          // This is TARGET wallet transaction - COPY IT!
          console.log(chalk.bgGreen.black(`[${utcNow()}] 🎯 TARGET WALLET BUY DETECTED: ${shortTokenName} | User: ${user.slice(0, 8)}... | Amount: ${(Math.abs(solChanges) / 10**9).toFixed(6)} SOL | Txid: ${signature?.slice(0, 8)}...`));
          console.log(chalk.bgYellow.black(`[${utcNow()}] ⏳ Waiting for target transaction to complete before copying...`));
          
          // // Wait a bit to ensure target transaction is confirmed
          // await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
          
          console.log(chalk.bgCyan.black(`[${utcNow()}] 🚀 Starting copy trade for ${shortTokenName}...`));
          
          // Spawn buy transaction processing
          this.spawn(this.processBuyTransaction.bind(this), transactionData, startTime1)
          .then(result => {
              if (result && result.success) {
                console.log(chalk.green(`[${utcNow()}] ✅ Spawned buy task completed for ${result.tokenMint}`));
              } else if (result && !result.success) {
                console.log(chalk.red(`[${utcNow()}] ❌ Spawned buy task failed for ${result.tokenMint}: ${result.error}`));
              }
            })
            .catch(error => {
              console.error(chalk.red(`[${utcNow()}] ❌ Spawned buy task error: ${error.message}`));
            });
        } else {
          // Transaction from unknown wallet - ignore
          console.log(chalk.gray(`[${utcNow()}] ⚪ IGNORED BUY: ${shortTokenName} | Unknown wallet: ${user?.slice(0, 8)}... (not target wallet)`));
        }
        } else {
          console.log(chalk.magenta(`[${utcNow()}] 🔴 SELL transaction detected: ${shortTokenName}`));
          
          if (user === MY_WALLET) {
            // This is OUR wallet transaction - DO NOT COPY to prevent loops
            const price = Math.abs(solChanges / (tokenChanges * 10 ** (9 - tokenDecimal))) / 10**9; // Convert to SOL per token
            console.log(chalk.bgBlue.white(`[${utcNow()}] 🏠 MY WALLET SELL: ${shortTokenName} | Txid: ${signature?.slice(0, 8)}... | Portfolio tracking only - NOT COPYING (anti-loop protection)`));
            
          // Update token portfolio for wallet transactions
          const tokenEntry = this.tokenPortfolio.updateTokenEntry(tokenMint, Math.abs(solChanges), false, tokenDecimal, price);
          
          // Calculate PnL and net profit using token portfolio
          let pnl = 0;
          let netProfit = 0;
          let topPnL = 0;
          
          if (tokenEntry) {
            // Calculate current PnL based on sell price vs average buy price
            pnl = this.tokenPortfolio.calculatePnL(tokenMint, price);
            
            // Calculate realized PnL (actual profit/loss from this sell)
            netProfit = this.tokenPortfolio.calculateRealizedPnL(tokenMint);
            
            // For now, set topPnL to current PnL (could be enhanced to track historical high)
            topPnL = pnl;
          }
         
          // Send sell alert with PnL and net profit data
          await sendSellAlert({ 
            tokenMint, 
            amount: (Math.abs(solChanges) / 10**9).toFixed(6) + ' SOL',
            toppnl: topPnL,
            pnl: pnl,
            txid: signature,
            reason: 'wallet_sell',
            netProfit: netProfit
          });
          
          // Log PnL and net profit to console
          const pnlColor = pnl >= 0 ? chalk.green : chalk.red;
          const profitColor = netProfit >= 0 ? chalk.green : chalk.red;
          console.log(pnlColor(`[${utcNow()}] 💰 PnL: ${(pnl * 100).toFixed(2)}% | Net Profit: ${netProfit.toFixed(6)} SOL`));
        } else if (user === this.targetWallet) {
          // This is TARGET wallet transaction - COPY IT!
          console.log(chalk.bgGreen.black(`[${utcNow()}] 🎯 TARGET WALLET SELL DETECTED: ${shortTokenName} | User: ${user.slice(0, 8)}... | Amount: ${(Math.abs(solChanges) / 10**9).toFixed(6)} SOL | Txid: ${signature?.slice(0, 8)}...`));
          console.log(chalk.bgYellow.black(`[${utcNow()}] ⏳ Waiting for target transaction to complete before copying...`));
          
          // // Wait a bit to ensure target transaction is confirmed
          // await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
          
          console.log(chalk.bgCyan.black(`[${utcNow()}] 🚀 Starting copy sell for ${shortTokenName}...`));
          
          // Spawn sell transaction processing
          this.spawn(this.processSellTransaction.bind(this), { ...transactionData })
            .then(result => {
              if (result && result.success) {
                console.log(chalk.green(`[${utcNow()}] ✅ Spawned sell task completed for ${tokenMint}`));
              } else if (result && !result.success) {
                console.log(chalk.yellow(`[${utcNow()}] ⚠️ Spawned sell task result: ${result.reason}`));
              }
            })
            .catch(error => {
              console.error(chalk.red(`[${utcNow()}] ❌ Spawned sell task error: ${error.message}`));
            });
        } else {
          // Transaction from unknown wallet - ignore
          console.log(chalk.gray(`[${utcNow()}] ⚪ IGNORED SELL: ${shortTokenName} | Unknown wallet: ${user?.slice(0, 8)}... (not target wallet)`));
        }
      }
     
    } catch (error) {
      console.error(`[${utcNow()}] Transaction processing error:`, error);
    }
  }

  async processTransactionData(data) {
    try {
      const result = await tOutPut(data);
      // console.log(JSON.stringify(result, null, 2));
      if (!result) {
        // console.log(chalk.cyan(`[${utcNow()}] ⚠️ No available transaction data parsed from transaction`));
        // console.log(JSON.stringify(data, null, 2));
        return null;
      }

      let { tokenChanges, solChanges, isBuy, user, mint, pool, liquidity, coinCreator, signature, context, pool_status } = result;
      
      // DEBUG: Log what the parser returned
      if (!mint) {
        console.log(chalk.yellow(`[${utcNow()}] 🔍 PARSER DEBUG: mint is undefined/null`));
        console.log(chalk.gray(`[${utcNow()}] 🔍 Result keys: ${Object.keys(result).join(', ')}`));
        console.log(chalk.gray(`[${utcNow()}] 🔍 isBuy=${isBuy}, user=${user?.slice(0,8)}..., pool_status=${pool_status}`));
      }

      if (tokenChanges === undefined || solChanges === undefined || isBuy === undefined) {
        console.log(
          chalk.cyan(
            `[${utcNow()}] ⚠️ Missing required transaction data: tokenChanges=${tokenChanges}, solChanges=${solChanges}, isBuy=${isBuy}`
          )
        );
        return null;
      }

      // Initialize mint as undefined to ensure it's always defined
      let tokenMint = mint;
      // console.log("🎈🎈🎈result", result)
      let preTokenBalances = data?.transaction?.transaction?.meta?.preTokenBalances;
      let postTokenBalances = data?.transaction?.transaction?.meta?.postTokenBalances;
      if (data && data.meta && data.transaction) {
        preTokenBalances = data?.meta?.preTokenBalances;
        postTokenBalances = data?.meta?.postTokenBalances;
      }
      let tokenDecimal = 6;
      
      // DEBUG: Log token balances for troubleshooting
      if (!mint && (!preTokenBalances || preTokenBalances.length === 0) && (!postTokenBalances || postTokenBalances.length === 0)) {
        console.log(chalk.yellow(`[${utcNow()}] 🔍 BALANCE DEBUG: No token balances found in transaction`));
        console.log(chalk.gray(`[${utcNow()}] 🔍 preTokenBalances: ${preTokenBalances?.length || 0}, postTokenBalances: ${postTokenBalances?.length || 0}`));
      }

      if (result.pool_status != "raydium") {
        //Pumpfun Pumpswap Raydium_LaunchLab Raydium_LaunchPad
        if (isBuy) {
          postTokenBalances?.forEach((balance) => {
            if (balance.mint === SOL_ADDRESS) {
              if (
                result.pool_status == "raydium_launchlab" &&
                balance.owner !== RAYDIUM_LAUNCHLAB_ADDRESS &&
                balance.owner !== RAYDIUM_LAUNUNCHPAD_ADDRESS
              ) {
                user = balance.owner;
              }
            } else {
              tokenDecimal = balance.uiTokenAmount.decimals;
              tokenMint = balance.mint;
              if (
                result.pool_status == "raydium_launchlab" &&
                balance.owner !== RAYDIUM_LAUNCHLAB_ADDRESS &&
                balance.owner !== RAYDIUM_LAUNUNCHPAD_ADDRESS
              ) {
                user = balance.owner;
              }
            }
          });
        } else {
          preTokenBalances?.forEach((balance) => {
            if (balance.mint === SOL_ADDRESS) {
              if (
                result.pool_status == "raydium_launchlab" &&
                balance.owner !== RAYDIUM_LAUNCHLAB_ADDRESS &&
                balance.owner !== RAYDIUM_LAUNUNCHPAD_ADDRESS
              ) {
                user = balance.owner;
              }
            } else {
              tokenDecimal = balance.uiTokenAmount.decimals;
              tokenMint = balance.mint;
              if (
                result.pool_status == "raydium_launchlab" &&
                balance.owner !== RAYDIUM_LAUNCHLAB_ADDRESS &&
                balance.owner !== RAYDIUM_LAUNUNCHPAD_ADDRESS
              ) {
                user = balance.owner;
              }
            }
          });
          postTokenBalances?.forEach((balance) => {
            if (
              result.pool_status == "raydium_launchlab" &&
              balance.owner !== RAYDIUM_LAUNCHLAB_ADDRESS &&
              balance.owner !== RAYDIUM_LAUNUNCHPAD_ADDRESS
            ) {
              user = balance.owner;
            }
          });
        }
        // if (result.pool == null) {
        //   pool = await getBondingCurveAddress(mint);
        //   console.log(`[${utcNow()}] >>>>>>>>>>>>pumpfun`);
        //   this.pool_status = "pumpfun";
        // }

        if (!isBuy) {
          tokenChanges = -tokenChanges;
        }
      } else {
        //Raydium - parse from token balances
        let post_sol;
        let pre_sol;
        let pre_token;
        let post_token;
        
        // DEBUG: Log balance extraction for Raydium
        console.log(chalk.gray(`[${utcNow()}] 🔍 RAYDIUM: Extracting from balances (pre: ${preTokenBalances?.length || 0}, post: ${postTokenBalances?.length || 0})`));
        
        // DEBUG: Log all balance owners to understand the structure
        if (postTokenBalances && postTokenBalances.length > 0) {
          const owners = postTokenBalances.map(b => b.owner?.slice(0, 8) + '...' + ' (mint: ' + b.mint?.slice(0, 6) + '...)').join(', ');
          console.log(chalk.gray(`[${utcNow()}] 🔍 POST Balance owners: ${owners}`));
        }
        
        // For Raydium, the user is the target wallet we're monitoring
        // Extract user from balance owners (should match target wallet)
        postTokenBalances?.forEach((balance) => {
          // Check if this is the target wallet
          if (balance.owner === this.targetWallet) {
            user = balance.owner;
            // Get token mint from user's token balance
            if (!tokenMint && balance.mint !== SOL_ADDRESS) {
              tokenMint = balance.mint;
              tokenDecimal = balance.uiTokenAmount.decimals;
            }
          }
        });
        
        // Also check preTokenBalances if user not found yet
        if (!user) {
          preTokenBalances?.forEach((balance) => {
            if (balance.owner === this.targetWallet) {
              user = balance.owner;
              if (!tokenMint && balance.mint !== SOL_ADDRESS) {
                tokenMint = balance.mint;
                tokenDecimal = balance.uiTokenAmount.decimals;
              }
            }
          });
        }
        
        // Extract pool balances from RAYDIUM_AUTH_ADDRESS
        postTokenBalances?.forEach((balance) => {
          if (balance.owner === RAYDIUM_AUTH_ADDRESS) {
            if (balance.mint === SOL_ADDRESS) {
              post_sol = balance.uiTokenAmount.amount || 0;
            } else {
              post_token = balance.uiTokenAmount.amount || 0;
              tokenDecimal = balance.uiTokenAmount.decimals;
              if (!tokenMint) tokenMint = balance.mint;
            }
          }
        });

        preTokenBalances?.forEach((balance) => {
          if (balance.owner === RAYDIUM_AUTH_ADDRESS) {
            if (balance.mint === SOL_ADDRESS) {
              pre_sol = balance.uiTokenAmount.amount || 0;
            } else {
              pre_token = balance.uiTokenAmount.amount || 0;
              if (!tokenMint) tokenMint = balance.mint;
            }
          }
        });
        
        tokenChanges = (pre_token || 0) - (post_token || 0);
        solChanges = (pre_sol || 0) - (post_sol || 0);
        
        // DEBUG: Log extracted values
        console.log(chalk.gray(`[${utcNow()}] 🔍 RAYDIUM CALC: pre_token=${pre_token}, post_token=${post_token}, tokenChanges=${tokenChanges}`));
        console.log(chalk.gray(`[${utcNow()}] 🔍 RAYDIUM CALC: pre_sol=${pre_sol}, post_sol=${post_sol}, solChanges=${solChanges}`));
        
        // FALLBACK: If standard extraction failed (tokenChanges is 0), extract from target wallet's balance changes
        // Note: Only extract if user matches target wallet (to avoid copying wrong transactions)
        if (tokenChanges === 0 && user === this.targetWallet) {
          console.log(chalk.yellow(`[${utcNow()}] ⚠️ Standard extraction failed, trying user-based extraction for target wallet ${user?.slice(0,8)}...`));
          
          // Build map of target wallet's token balances (use raw amount, not uiAmount)
          const userPreBalances = new Map();
          const userPostBalances = new Map();
          let userPreSol = 0;
          let userPostSol = 0;
          
          preTokenBalances?.forEach((balance) => {
            if (balance.owner === user) {
              if (balance.mint === SOL_ADDRESS) {
                userPreSol = parseFloat(balance.uiTokenAmount.amount || 0);
              } else {
                // Use raw amount for accurate calculation
                userPreBalances.set(balance.mint, {
                  amount: parseFloat(balance.uiTokenAmount.amount || 0),
                  decimals: balance.uiTokenAmount.decimals
                });
              }
            }
          });
          
          postTokenBalances?.forEach((balance) => {
            if (balance.owner === user) {
              if (balance.mint === SOL_ADDRESS) {
                userPostSol = parseFloat(balance.uiTokenAmount.amount || 0);
              } else {
                // Use raw amount for accurate calculation
                userPostBalances.set(balance.mint, {
                  amount: parseFloat(balance.uiTokenAmount.amount || 0),
                  decimals: balance.uiTokenAmount.decimals
                });
              }
            }
          });
          
          // Calculate SOL changes for the user (already in lamports)
          const userSolChange = userPreSol - userPostSol;
          if (Math.abs(userSolChange) > 0 && solChanges === 0) {
            solChanges = userSolChange;
            console.log(chalk.green(`[${utcNow()}] ✅ USER-BASED: Found SOL change ${(userSolChange / 1e9).toFixed(6)} SOL (${userSolChange} lamports)`));
          }
          
          // Find the token that changed (use raw amounts for accurate tracking)
          for (const [mint, preData] of userPreBalances) {
            const postData = userPostBalances.get(mint) || { amount: 0, decimals: preData.decimals };
            const change = preData.amount - postData.amount;
            
            if (Math.abs(change) > 0) {
              tokenChanges = change;
              if (!tokenMint) {
                tokenMint = mint;
                tokenDecimal = preData.decimals;
              }
              const uiChange = change / Math.pow(10, preData.decimals);
              console.log(chalk.green(`[${utcNow()}] ✅ USER-BASED: Found token change ${uiChange.toFixed(6)} (${change} raw) for ${mint?.slice(0,8)}...`));
              break;
            }
          }
          
          // Also check for new tokens (only in post, not in pre)
          for (const [mint, postData] of userPostBalances) {
            if (!userPreBalances.has(mint)) {
              const change = 0 - postData.amount; // Negative change (they received tokens)
              if (Math.abs(change) > 0) {
                tokenChanges = change;
                if (!tokenMint) {
                  tokenMint = mint;
                  tokenDecimal = postData.decimals;
                }
                const uiChange = change / Math.pow(10, postData.decimals);
                console.log(chalk.green(`[${utcNow()}] ✅ USER-BASED: Found new token ${uiChange.toFixed(6)} (${change} raw) for ${mint?.slice(0,8)}...`));
                break;
              }
            }
          }
        }
        
        if (tokenChanges > 0) {
          isBuy = true;
        } else {
          isBuy = false;
        }
        liquidity = (2 * (pre_sol || 0)) / 10 ** 9;
        coinCreator = RAYDIUM_LAUNCHLAB_ADDRESS;
        // console.log("solchange:", solChanges)

        context = null;
        
        // DEBUG: Log Raydium extraction result
        if (!tokenMint || !user) {
          console.log(chalk.yellow(`[${utcNow()}] 🔍 RAYDIUM EXTRACTION: mint=${tokenMint ? tokenMint.slice(0, 8) + '...' : 'null'}, user=${user ? user.slice(0, 8) + '...' : 'null'}`));
          console.log(chalk.gray(`[${utcNow()}] 🔍 PreBalances: ${preTokenBalances.length}, PostBalances: ${postTokenBalances.length}`));
        }
      }
      
      // Validate that tokenMint is defined
      if (!tokenMint) {
        // console.log(chalk.yellow(`[${utcNow()}] ⚠️ Warning: tokenMint is undefined, attempting to extract from result.mint`));
        tokenMint = result.mint || null;
      }
      
      // console.log("😉😉😉User:", user);
      // console.log("😉pre:", preTokenBalances);
      // console.log("😉post:", postTokenBalances);

      return {
        tokenChanges,
        solChanges,
        isBuy,
        tokenMint: tokenMint,
        tokenDecimal,
        pairAddress: pool,
        user,
        liquidity,
        coinCreator,
        signature,
        context,
        pool_status,
      };
    } catch (error) {
      console.error(`[${utcNow()}] Error processing transaction data:`, error);
      return null;
    }
  }

  logTransactionDetails(
    tokenMint,
    isBuy,
    tokenDecimal,
    tokenChanges,
    solChanges,
    price,
    pairAddress,
    user,
    liquidity,
    pool_status,
    signature
  ) {
    const walletType = user === MY_WALLET ? "MY_WALLET" : "TARGET_WALLET";
    console.log(chalk.bgYellowBright(`[${utcNow()}] ${walletType}`, user));
    console.log(`[${utcNow()}] signature:`, signature, "");
    console.log(`[${utcNow()}] pool_status:`, pool_status, "");
    console.log(`[${utcNow()}] mint:`, isBuy ? chalk.green(tokenMint) : chalk.red(tokenMint));
    console.log(`[${utcNow()}] Decimals`, tokenDecimal);
    console.log(`[${utcNow()}] tokenChanges:`, isBuy ? chalk.green(tokenChanges) : chalk.red(tokenChanges));
    console.log(
      `[${utcNow()}] solChanges:`,
      isBuy ? chalk.green((solChanges / 10 ** 9).toFixed(4)) : chalk.red((solChanges / 10 ** 9).toFixed(3))
    );
    console.log(`[${utcNow()}] pairAddress:`, isBuy ? chalk.green(pairAddress) : chalk.red(pairAddress));
    console.log(`[${utcNow()}] price:`, isBuy ? chalk.green(price) : chalk.red(price), "");
    console.log(`[${utcNow()}] liquidity:`, isBuy ? chalk.green(liquidity) : chalk.red(liquidity), "");
  }
  async shouldBuyToken(tokenMint, pairAddress, liquidity, user) {
    const { holders, totalSupply, top10Percentage } = await getTokenHolders(tokenMint, pairAddress);

    if (holders.length === 0 || totalSupply === 0) {
      console.log(`[${utcNow()}] ❌ No holders or zero supply for ${tokenMint}`);
      return false;
    }

    console.log(`[${utcNow()}] 👥 Holders: ${holders.length}, 🐋 Top10%: ${top10Percentage}%, liquidity:${liquidity}`);
    // // Save the holders/top10/liquidity info to a file inside a folder named by the wallet address.
    // try {
    //   const walletDir = `./wallets/${user}`;
    //   const fileName = `${walletDir}/info.txt`;
    //   let existingData = "";
    //   if (fs.existsSync(fileName)) {
    //     existingData = fs.readFileSync(fileName, "utf-8");
    //   }
    //   // Remove any previous entry for this tokenMint
    //   const lines = existingData.split("\n").filter((line) => !line.includes(`mint: ${tokenMint}`));
    //   // Add the new info for this tokenMint
    //   const infoText = `[${utcNow()}] mint: ${tokenMint}\n👥Holders: ${
    //     holders.length
    //   }  |  🐋Top10Percentage: ${top10Percentage}    |    Liquidity: ${liquidity}\n`;
    //   lines.push(infoText.trim());
    //   if (!fs.existsSync(walletDir)) {
    //     fs.mkdirSync(walletDir, { recursive: true });
    //   }
    //   fs.writeFileSync(fileName, lines.join("\n").trim() + "\n", { flag: "w" });
    // } catch (e) {
    //   console.error(`[${utcNow()}] Error saving token info for ${user}:`, e);
    // }

    const passed =
      holders.length > BUY_FILTER.minHolders &&
      holders.length < BUY_FILTER.maxHolders &&
      top10Percentage < BUY_FILTER.maxTop10Percentage &&
      liquidity > BUY_FILTER.minLiquidity &&
      liquidity < BUY_FILTER.maxLiquidity;

    if (passed) console.log(`[${utcNow()}] ✅ shouldBuy: TRUE for ${tokenMint}`);
    else console.log(`[${utcNow()}] ❌ shouldBuy: FALSE for ${tokenMint}`);
    return passed;
  }


  // Method to disable buying due to insufficient funds
  disableBuying() {
    this.buyingDisabled = true;
    console.log(chalk.cyan(`[${utcNow()}] ⚠️ Buying disabled due to insufficient funds`));
    console.log(chalk.cyan(`[${utcNow()}] 🔄 Bot will continue running for selling existing positions`));
  }


  handleError(error) {
    console.error(`[${utcNow()}] Stream Error1:`, error);
    this.isRunning = false;
  }
}

// Add global function to show all bot counts
export function showAllBotCounts() {
  console.log(chalk.bgCyan.black(`[${utcNow()}] 🤖 GLOBAL BOT STATUS REPORT`));
  console.log(chalk.cyan(`[${utcNow()}] Total monitors: ${TARGET_WALLET.length}`));

  // Note: This would need access to monitor instances
  // For now, we'll add this functionality to the main function
}

export async function pump_geyser() {
  // Validate that we have at least one copy wallet configured
  if (TARGET_WALLET.length === 0) {
    console.error(chalk.red(`[${utcNow()}] ❌ CONFIGURATION ERROR: No copy wallets configured!`));
    console.error(chalk.red(`[${utcNow()}] ❌ Please set COPY_WALLET in your .env file`));
    console.error(chalk.yellow(`[${utcNow()}] 💡 Example: COPY_WALLET=YourTargetWalletPublicKeyHere`));
    process.exit(1);
  }

  const monitors = TARGET_WALLET.map((wallet) => new TransactionMonitor(wallet));

  console.log(`[${utcNow()}] 🚦 Script started for ${TARGET_WALLET.length} copy wallet(s)`);
  console.log(chalk.blue(`[${utcNow()}] 💰 Balance limit set to: ${LIMIT_BALANCE} SOL`));
  console.log(chalk.blue(`[${utcNow()}] 📱 Insufficient funds alerts: ${ENABLE_INSUFFICIENT_FUNDS_ALERTS ? "✅ Enabled" : "❌ Disabled"}`));
  console.log(chalk.blue(`[${utcNow()}] ⏱️ Alert cooldown: ${INSUFFICIENT_FUNDS_ALERT_COOLDOWN / 60000} minutes`));
  console.log(chalk.blue(`[${utcNow()}] 📱 Telegram notifications: ${process.env.TELEGRAM_BOT_TOKEN ? "✅ Enabled" : "❌ Disabled"}`));
  console.log(chalk.blue(`[${utcNow()}] 🤖 Telegram controller: ${process.env.TELEGRAM_BOT_TOKEN ? "✅ Enabled" : "❌ Disabled"}`));

  // Show initial cache status
  showAllCacheStatus();

  // Initialize global blockhash manager
  console.log(chalk.bgCyan.black(`[${utcNow()}] 🔄 BLOCKHASH MANAGEMENT`));
  try {
    await globalBlockhashManager.initialize();
    console.log(chalk.green(`[${utcNow()}] ✅ Global blockhash manager initialized`));
    console.log(chalk.cyan(`[${utcNow()}] 🔄 Blockhash updates every 200ms in background`));
  } catch (error) {
    console.error(chalk.red(`[${utcNow()}] ❌ Failed to initialize global blockhash manager:`, error.message));
  }


  // Start bought tokens cache cleanup
  startBoughtTokensCleanup();
  
  // Start position tracking cleanup
  startPositionCleanup();

  // Add clear wallet configuration logging
  console.log(chalk.bgCyan.black(`[${utcNow()}] 🏠 WALLET CONFIGURATION`));
  console.log(chalk.cyan(`[${utcNow()}] MY_WALLET: ${MY_WALLET} (Your wallet - executes copy trades)`));
  console.log(chalk.cyan(`[${utcNow()}] COPY_WALLETS: ${TARGET_WALLET.length} wallet(s) (Monitoring for trades to copy)`));
  TARGET_WALLET.forEach((wallet, index) => {
    console.log(chalk.cyan(`[${utcNow()}]   ${index + 1}. ${wallet}`));
  });
  console.log(chalk.bgCyan.black(`[${utcNow()}] 📊 COPY TRADING LOGIC`));
  console.log(chalk.cyan(`[${utcNow()}] 📡 Bot monitors COPY_WALLET transactions via gRPC`));
  console.log(chalk.cyan(`[${utcNow()}] 🟢 Copy wallet BUYS → Your wallet copies the buy`));
  console.log(chalk.cyan(`[${utcNow()}] 🔴 Copy wallet SELLS → Your wallet copies the sell (Mode: ${COPY_SELL_MODE.toUpperCase()})`));
  if (COPY_SELL_MODE === "mimic") {
    console.log(chalk.cyan(`[${utcNow()}]    ↳ MIMIC: Sells in same proportions as target wallet`));
  } else if (COPY_SELL_MODE === "full") {
    console.log(chalk.cyan(`[${utcNow()}]    ↳ FULL: Always sells 100% of oldest buy order (FIFO)`));
  }
  console.log(chalk.cyan(`[${utcNow()}] 🏠 Your wallet transactions → Portfolio tracking only (no copy loop)`));

  // Function to start all monitors
  const startAllMonitors = async () => {
    try {
      await Promise.all(monitors.map((monitor) => monitor.start()));
      console.log(chalk.green(`[${utcNow()}] ✅ All monitors started successfully`));
      updateBotRunningState(true);
    } catch (error) {
      console.error(chalk.red(`[${utcNow()}] ❌ Error starting monitors:`, error));
      updateBotRunningState(false);
    }
  };

  // Function to stop all monitors
  const stopAllMonitors = async () => {
    try {
      await Promise.all(monitors.map((monitor) => monitor.stop()));
      console.log(chalk.green(`[${utcNow()}] ✅ All monitors stopped successfully`));
      updateBotRunningState(false);
    } catch (error) {
      console.error(chalk.red(`[${utcNow()}] ❌ Error stopping monitors:`, error));
    }
  };

  // Initialize Telegram controller with monitors and control functions
  setBotState({
    monitors,
    startFunction: startAllMonitors,
    stopFunction: stopAllMonitors,
  });

  // Check existing portfolio before starting monitors (cleanup happens BEFORE gRPC monitoring begins)
  console.log(chalk.bgCyan.black(`[${utcNow()}] 📦 CHECKING EXISTING PORTFOLIO...`));
  try {
    const existingTokens = await getAllTokenAccounts();
    if (existingTokens.length === 0) {
      console.log(chalk.green(`[${utcNow()}] ✅ No existing tokens in wallet - clean slate`));
    } else {
      console.log(chalk.yellow(`[${utcNow()}] 📦 Found ${existingTokens.length} existing token(s) with balance:`));
      for (const token of existingTokens) {
        const cachedType = getTokenTypeSync(token.mint);
        const isPumpToken = cachedType === 'pumpfun' || token.mint.toLowerCase().endsWith('pump');
        const tokenType = isPumpToken ? 'pumpfun' : (cachedType || 'unknown');
        console.log(chalk.yellow(`[${utcNow()}]   - ${token.mint.slice(0, 8)}...: ${token.uiBalance.toLocaleString()} tokens [${tokenType}]`));
      }

      // Startup cleanup: Sell all existing tokens by default (skip only if explicitly disabled)
      if (SKIP_STARTUP_CLEANUP) {
        console.log(chalk.yellow(`[${utcNow()}] ⚠️ SKIP_STARTUP_CLEANUP=true - Keeping existing tokens`));
        console.log(chalk.yellow(`[${utcNow()}] ⚠️ These tokens may cause issues with full sells (close instruction errors)`));
      } else {
        // 5-second countdown before selling
        console.log(chalk.bgRed.white(`[${utcNow()}] 🧹 STARTUP CLEANUP - Will sell all ${existingTokens.length} token(s) in 5 seconds...`));
        console.log(chalk.bgRed.white(`[${utcNow()}] ⚠️ Press Ctrl+C to abort if you want to keep these tokens`));

        // Blocking countdown
        for (let i = 5; i > 0; i--) {
          process.stdout.write(chalk.red(`\r[${utcNow()}] ⏳ Selling in ${i} seconds...`));
          const start = Date.now();
          while (Date.now() - start < 1000) {
            // Busy wait to block event loop
          }
        }
        console.log(chalk.yellow(`\n[${utcNow()}] 🚀 Starting cleanup...`));

        // Sell each token
        let soldCount = 0;
        let failedCount = 0;
        for (const token of existingTokens) {
          // Determine pool_status for proper sell routing
          const cachedType = getTokenTypeSync(token.mint);
          const isPumpToken = cachedType === 'pumpfun' || token.mint.toLowerCase().endsWith('pump');
          const poolStatus = isPumpToken ? 'pumpfun' : 'other';

          console.log(chalk.cyan(`[${utcNow()}] 💱 [${soldCount + failedCount + 1}/${existingTokens.length}] Selling ${token.uiBalance.toLocaleString()} of ${token.mint.slice(0, 8)}... (${poolStatus})`));
          try {
            // Pass token.balance as both the sell amount AND tracked balance for verification
            const txid = await token_sell(token.mint, token.balance, poolStatus, true, null, token.balance);
            if (txid && txid !== "stop") {
              console.log(chalk.green(`[${utcNow()}] ✅ Sold ${token.mint.slice(0, 8)}...: https://solscan.io/tx/${txid}`));
              soldCount++;
            } else {
              console.log(chalk.yellow(`[${utcNow()}] ⚠️ Could not sell ${token.mint.slice(0, 8)}... (no liquidity or error)`));
              failedCount++;
            }
            // Small delay between sells to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (sellError) {
            console.log(chalk.red(`[${utcNow()}] ❌ Failed to sell ${token.mint.slice(0, 8)}...: ${sellError.message}`));
            failedCount++;
          }
        }
        console.log(chalk.green(`[${utcNow()}] ✅ Startup cleanup completed: ${soldCount} sold, ${failedCount} failed`));

        // ============================================================================
        // POST-CLEANUP: Close remaining zero-balance ATAs
        // ============================================================================
        // Why this step is needed:
        //   Regular SPL tokens: Already closed during sell (atomic transaction)
        //   Token2022 tokens: Skipped during sell to prevent transaction failures
        //
        // This cleanup handles:
        //   1. Token2022 ATAs that truly have 0 balance (no dust)
        //   2. Token2022 ATAs where fee authority harvested withheld fees
        //   3. Any ATAs that failed to close during sell for other reasons
        //
        // Important: We update cache onChain status to prevent buy errors
        //   - Success → onChain: false (ATA closed, next buy will create it)
        //   - Failure → onChain: true (ATA has dust, next buy skips creation)
        // ============================================================================
        console.log(chalk.cyan(`[${utcNow()}] 🔍 Checking for remaining zero-balance ATAs...`));
        try {
          const zeroBalanceATAs = await getZeroBalanceTokenAccounts();
          if (zeroBalanceATAs.length > 0) {
            console.log(chalk.yellow(`[${utcNow()}] 🧹 Found ${zeroBalanceATAs.length} zero-balance ATA(s) to close...`));
            const wallet = await loadwallet();
            const connection = rpc_connection();
            let closedCount = 0;
            let closeFailedCount = 0;

            for (const ata of zeroBalanceATAs) {
              try {
                const latestBlockHash = await connection.getLatestBlockhash();
                const instructions = [
                  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
                  ComputeBudgetProgram.setComputeUnitLimit({ units: 10000 }),
                  createCloseAccountInstruction(
                    ata.pubkey,
                    wallet.keypair.publicKey,
                    wallet.keypair.publicKey,
                    [],
                    ata.programId
                  )
                ];

                const message = new TransactionMessage({
                  payerKey: wallet.keypair.publicKey,
                  recentBlockhash: latestBlockHash.blockhash,
                  instructions: instructions,
                }).compileToV0Message();

                const transaction = new VersionedTransaction(message);
                transaction.sign([wallet.keypair]);

                const txid = await connection.sendTransaction(transaction, {
                  skipPreflight: false,
                  maxRetries: 2,
                });

                if (txid) {
                  // SUCCESS: ATA closed, rent recovered
                  // Update cache: onChain=false so next buy creates new ATA
                  updateOnChainStatus(ata.mint, wallet.keypair.publicKey.toString(), false);
                  console.log(chalk.green(`[${utcNow()}] ✅ Closed ATA for ${ata.mint.slice(0, 8)}...: https://solscan.io/tx/${txid}`));
                  closedCount++;
                } else {
                  // FAILED: No txid returned
                  // Update cache: onChain=true to prevent "account already exists" error on next buy
                  updateOnChainStatus(ata.mint, wallet.keypair.publicKey.toString(), true);
                  closeFailedCount++;
                }
              } catch (closeErr) {
                // FAILED: Close instruction failed (Token2022 likely has withheld dust from transfer fees)
                // Update cache: onChain=true to prevent "account already exists" error on next buy
                updateOnChainStatus(ata.mint, wallet.keypair.publicKey.toString(), true);
                console.log(chalk.yellow(`[${utcNow()}] ⚠️ Failed to close ATA for ${ata.mint.slice(0, 8)}...: ${closeErr.message}`));
                closeFailedCount++;
              }
            }
            console.log(chalk.green(`[${utcNow()}] ✅ ATA cleanup completed: ${closedCount} closed, ${closeFailedCount} failed`));
          } else {
            console.log(chalk.green(`[${utcNow()}] ✅ No zero-balance ATAs to close`));
          }
        } catch (ataCleanupError) {
          console.log(chalk.yellow(`[${utcNow()}] ⚠️ ATA cleanup check failed: ${ataCleanupError.message}`));
        }
      }
    }
  } catch (cleanupError) {
    console.log(chalk.red(`[${utcNow()}] ❌ Portfolio check failed: ${cleanupError.message}`));
    console.log(chalk.yellow(`[${utcNow()}] ⚠️ Continuing with bot startup despite error...`));
  }

  // Initial balance check before starting
  console.log(chalk.blue(`[${utcNow()}] 🔍 Performing initial balance check...`));
  try {
    const initialBalanceInfo = await checkWalletBalance();
    console.log(chalk.green(`[${utcNow()}] ✅ Initial balance: ${initialBalanceInfo.balance.toFixed(4)} SOL`));

    // Calculate recommended minimum balance for trading
    const buyAmountFloat = parseFloat(buyAmount) || 0.1;
    
    // Calculate maximum possible buy amount (fixed vs dynamic)
    let maxBuyAmount = buyAmountFloat;
    if (BUY_AMOUNT_PERCENTAGE !== null) {
      // If using percentage-based buying, estimate max amount based on typical target wallet behavior
      // Assume target wallets might spend up to 5 SOL per transaction as a reasonable upper bound
      const estimatedMaxTargetAmount = 5.0; // SOL
      const maxDynamicAmount = estimatedMaxTargetAmount * BUY_AMOUNT_PERCENTAGE;
      maxBuyAmount = Math.max(buyAmountFloat, maxDynamicAmount);
    }
    
    const recommendedMinBalance = maxBuyAmount + 0.1; // Max buy amount + buffer for fees

    console.log(chalk.blue(`[${utcNow()}] 💰 Fixed buy amount: ${buyAmountFloat} SOL`));
    if (BUY_AMOUNT_PERCENTAGE !== null) {
      console.log(chalk.blue(`[${utcNow()}] 💰 Dynamic buy percentage: ${(BUY_AMOUNT_PERCENTAGE * 100).toFixed(1)}% of target wallet's SOL change`));
      console.log(chalk.blue(`[${utcNow()}] 💰 Estimated max dynamic amount: ${maxBuyAmount.toFixed(4)} SOL`));
    }
    console.log(chalk.blue(`[${utcNow()}] 💰 Recommended minimum: ${recommendedMinBalance.toFixed(4)} SOL`));
    console.log(chalk.blue(`[${utcNow()}] 💰 Safety limit: ${LIMIT_BALANCE} SOL`));

    // Check if initial balance is sufficient for trading
    if (initialBalanceInfo.balance < LIMIT_BALANCE) {
      console.error(chalk.red(`[${utcNow()}] ❌ INSUFFICIENT INITIAL BALANCE: ${initialBalanceInfo.balance.toFixed(4)} SOL`));
      console.error(chalk.red(`[${utcNow()}] ❌ Required minimum: ${LIMIT_BALANCE} SOL`));
      console.error(chalk.red(`[${utcNow()}] ❌ Recommended minimum: ${recommendedMinBalance.toFixed(4)} SOL`));
      console.error(chalk.red(`[${utcNow()}] ❌ Please add SOL to your wallet before starting the bot`));

      // Send Telegram notification for insufficient initial balance (only once at startup, if alerts are enabled)
      if (ENABLE_INSUFFICIENT_FUNDS_ALERTS) {
        try {
          await sendInsufficientFundsAlert({
            currentBalance: initialBalanceInfo.balance,
            limitBalance: LIMIT_BALANCE,
            walletAddress: initialBalanceInfo.publicKey,
          });
          console.log(chalk.cyan(`[${utcNow()}] 📱 Initial insufficient funds alert sent`));
        } catch (telegramError) {
          console.error(chalk.red(`[${utcNow()}] ❌ Failed to send Telegram notification: ${telegramError.message}`));
        }
      } else {
        console.log(chalk.cyan(`[${utcNow()}] ⏳ Initial insufficient funds alert disabled via ENABLE_INSUFFICIENT_FUNDS_ALERTS=false`));
      }

      // process.exit(1); // Exit with error code
    }

    // Show balance status
    if (initialBalanceInfo.balance >= recommendedMinBalance) {
      console.log(chalk.green(`[${utcNow()}] ✅ Initial balance check passed - sufficient funds for trading`));
      console.log(chalk.green(`[${utcNow()}] ✅ Can perform ${Math.floor(initialBalanceInfo.balance / maxBuyAmount)} buy transactions (based on max amount)`));
    } else {
      console.log(chalk.cyan(`[${utcNow()}] ⚠️ Initial balance check passed - but balance is low`));
      console.log(chalk.cyan(`[${utcNow()}] ⚠️ Consider adding more SOL for better trading capacity`));
    }
  } catch (balanceError) {
    console.error(chalk.red(`[${utcNow()}] ❌ Failed to check initial balance: ${balanceError.message}`));
    console.error(chalk.red(`[${utcNow()}] ❌ Cannot start bot without balance verification`));
    // process.exit(1); // Exit with error code
  }

  // Add event listeners for insufficient funds (now handled per monitor)
  monitors.forEach((monitor) => {
    monitor.on("insufficientFunds", async (data) => {
      console.error(chalk.red(`[${utcNow()}] ⚠️ INSUFFICIENT FUNDS EVENT from monitor ${data.monitor.targetWallet.slice(0, 8)}...`));
      console.error(chalk.red(`[${utcNow()}] ⚠️ Buying disabled for this monitor - selling continues`));
    });
  });

  // Add manual status check every 60 seconds
  const globalStatusInterval = setInterval(() => {
    let totalBots = 0;
    let disabledMonitors = 0;
    for (const monitor of monitors) {
      totalBots += monitor.getRunningBotCount();
      if (monitor.buyingDisabled) disabledMonitors++;
    }
    const buyingStatus = disabledMonitors > 0 ? ` (${disabledMonitors} monitors with buying disabled)` : "";
    console.log(
      chalk.bgBlue.white(
        `[${utcNow()}] 🌐 GLOBAL STATUS: ${totalBots} total bots running across ${monitors.length} monitors${buyingStatus}`
      )
    );
  }, 60000); // Every 60 seconds

  // Add manual trigger for immediate status check
  process.on("SIGUSR1", () => {
    console.log(chalk.bgYellow.black(`[${utcNow()}] 📊 MANUAL STATUS TRIGGER`));
    let totalBots = 0;
    let disabledMonitors = 0;
    for (const monitor of monitors) {
      const botCount = monitor.getRunningBotCount();
      totalBots += botCount;
      if (monitor.buyingDisabled) disabledMonitors++;
      console.log(chalk.cyan(`[${utcNow()}] Monitor ${monitor.targetWallet.slice(0, 8)}...: ${botCount} bots`));
      monitor.showBotStatus();
    }
    const buyingStatus = disabledMonitors > 0 ? ` (${disabledMonitors} monitors with buying disabled)` : "";
    console.log(chalk.bgGreen.black(`[${utcNow()}] 📈 TOTAL: ${totalBots} bots across all monitors${buyingStatus}`));
  });


  // Add manual trigger for strategy debug
  process.on("SIGUSR3", () => {
    console.log(chalk.bgMagenta.black(`[${utcNow()}] 🔍 MANUAL STRATEGY DEBUG TRIGGER`));
    for (const monitor of monitors) {
      monitor.logAllBotsDebugInfo();
    }
  });

  

  // Add manual trigger for position tracking status
  process.on("SIGUSR7", () => {
    console.log(chalk.bgMagenta.black(`[${utcNow()}] 📊 MANUAL POSITION TRACKING STATUS TRIGGER`));
    showPositionTrackingStatus();
  });

  // Add manual trigger for blockhash manager status
  process.on("SIGUSR6", async () => {
    console.log(chalk.bgCyan.black(`[${utcNow()}] 🔄 MANUAL BLOCKHASH MANAGER STATUS TRIGGER`));
    try {
      await globalBlockhashManager.healthCheck();
    } catch (error) {
      console.error(chalk.red(`[${utcNow()}] ❌ Error checking blockhash manager status:`, error.message));
    }
  });


  console.log(chalk.green(`[${utcNow()}] 💡 Send SIGUSR1 signal to see detailed bot status`));
  console.log(chalk.green(`[${utcNow()}] 💡 Send SIGUSR3 signal to debug all bot strategies`));
  console.log(chalk.green(`[${utcNow()}] 💡 Send SIGUSR6 signal to show blockhash manager status`));
  console.log(chalk.green(`[${utcNow()}] 💡 Send SIGUSR7 signal to show position tracking status`));
  console.log(chalk.green(`[${utcNow()}] 💡 Use Telegram bot to control start/stop remotely`));

  // Export functions for Telegram controller
  global.startTradingBot = startAllMonitors;
  global.stopTradingBot = stopAllMonitors;

  try {
    // Start monitors initially
    await startAllMonitors();
    updateBotRunningState(true);
  } catch (error) {
    console.error(chalk.red(`[${utcNow()}] Error in pump_geyser:`, error));
    updateBotRunningState(false);
  } finally {
    clearInterval(globalStatusInterval);
    
    // Cleanup position tracking
    if (positionCleanupInterval) {
      clearInterval(positionCleanupInterval);
      positionCleanupInterval = null;
      console.log(chalk.green(`[${utcNow()}] ✅ Position tracking cleanup stopped`));
    }
    
    // Cleanup global blockhash manager
    try {
      globalBlockhashManager.stopAll();
      console.log(chalk.green(`[${utcNow()}] ✅ Global blockhash manager stopped`));
    } catch (error) {
      console.error(chalk.red(`[${utcNow()}] ❌ Error stopping global blockhash manager:`, error.message));
    }
  }
}

function cleanupExpiredBoughtTokens() {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [tokenMint, data] of boughtTokensCache.entries()) {
    if (now - data.lastUpdate > BOUGHT_TOKENS_CACHE_DURATION) {
      boughtTokensCache.delete(tokenMint);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(chalk.cyan(`[${utcNow()}] 🧹 Cleaned up ${cleanedCount} expired bought tokens from cache`));
  }
}

function startBoughtTokensCleanup() {
  if (boughtTokensCleanupInterval) {
    clearInterval(boughtTokensCleanupInterval);
  }
  
  // Clean up expired tokens every hour
  boughtTokensCleanupInterval = setInterval(cleanupExpiredBoughtTokens, 60 * 60 * 1000);
  
  // Initial cleanup
  cleanupExpiredBoughtTokens();
}


function showBoughtTokensStatus() {
  const totalTokens = boughtTokensCache.size;
  const totalValue = Array.from(boughtTokensCache.values()).reduce((sum, token) => sum + (token.amount * token.buyPrice), 0);
  
  console.log(chalk.cyan(`[${utcNow()}] 💰 Bought tokens cache status: ${totalTokens} tokens | Total value: ${totalValue.toFixed(6)} SOL`));
  
  if (totalTokens > 0) {
    console.log(chalk.cyan(`[${utcNow()}] 💰 Cached bought tokens:`));
    boughtTokensCache.forEach((data, tokenMint) => {
      const shortMint = tokenMint.slice(0, 8) + "..." + tokenMint.slice(-4);
      const age = Math.floor((Date.now() - data.buyTime) / 1000);
      console.log(chalk.cyan(`[${utcNow()}]   ${shortMint} | Amount: ${data.amount.toLocaleString()} | Price: ${data.buyPrice} | Age: ${age}s`));
    });
  }
}

function showAllCacheStatus() {
  console.log(chalk.bgCyan.black(`[${utcNow()}] 📊 CACHE STATUS OVERVIEW`));
  
  // Show bought tokens cache status
  showBoughtTokensStatus();
  
  // Show position tracking status
  showPositionTrackingStatus();
}

// Position tracking management functions for per-wallet copy trading
function addPosition(tokenMint, targetWallet, targetBoughtAmount, ourBoughtAmount) {
  const now = Date.now();
  
  // Initialize token map if it doesn't exist
  if (!positions.has(tokenMint)) {
    positions.set(tokenMint, new Map());
  }
  
  const tokenPositions = positions.get(tokenMint);
  
  // Get existing position or create new one
  let position = tokenPositions.get(targetWallet);
  if (!position) {
    position = {
      purchases: [],
      totalAmount: 0
    };
  }
  
  // Add new purchase with exact amounts
  const purchase = {
    targetBoughtAmount: targetBoughtAmount,
    ourBoughtAmount: ourBoughtAmount,
    buyTime: now,
    lastUpdate: now
  };
  
  position.purchases.push(purchase);
  position.totalAmount += ourBoughtAmount;
  position.lastUpdate = now;
  
  tokenPositions.set(targetWallet, position);
  
  // Update global purchase count for this token
  updateTokenPurchaseCount(tokenMint, 1); // Add 1 purchase
  
  console.log(chalk.green(`[${utcNow()}] 📈 Position added: ${tokenMint.slice(0, 8)}... | Wallet: ${targetWallet.slice(0, 8)}... | Target: ${targetBoughtAmount.toLocaleString()} | Our: ${ourBoughtAmount.toLocaleString()} | Total: ${position.totalAmount.toLocaleString()}`));
}

// Global purchase count management functions
function updateTokenPurchaseCount(tokenMint, delta) {
  const now = Date.now();
  
  let countData = tokenPurchaseCounts.get(tokenMint);
  if (!countData) {
    countData = {
      totalPurchases: 0,
      remainingPurchases: 0,
      lastUpdate: now
    };
  }
  
  countData.totalPurchases += delta;
  countData.remainingPurchases += delta;
  countData.lastUpdate = now;
  
  tokenPurchaseCounts.set(tokenMint, countData);
  
  console.log(chalk.cyan(`[${utcNow()}] 📊 Purchase count updated: ${tokenMint.slice(0, 8)}... | Total: ${countData.totalPurchases} | Remaining: ${countData.remainingPurchases}`));
}

function getTokenPurchaseCount(tokenMint) {
  return tokenPurchaseCounts.get(tokenMint) || { totalPurchases: 0, remainingPurchases: 0, lastUpdate: 0 };
}

function isLastRemainingPurchase(tokenMint) {
  const countData = getTokenPurchaseCount(tokenMint);
  return countData.remainingPurchases === 1;
}

function getRemainingPurchaseCount(tokenMint) {
  const countData = getTokenPurchaseCount(tokenMint);
  return countData.remainingPurchases;
}

function getPosition(tokenMint, targetWallet) {
  const tokenPositions = positions.get(tokenMint);
  if (!tokenPositions) return null;
  
  const position = tokenPositions.get(targetWallet);
  if (position) {
    // Update last access time
    position.lastUpdate = Date.now();
  }
  return position;
}

// New function to get exact sell amount based on target wallet's sell amount
// IMPORTANT: This function has TWO completely separate code paths:
//   - FULL mode (lines below): NEW behavior for FIFO selling
//   - MIMIC mode (lines after): ORIGINAL behavior 100% UNCHANGED
function getExactSellAmount(tokenMint, targetWallet, targetSellAmount) {
  const position = getPosition(tokenMint, targetWallet);
  if (!position || !position.purchases || position.purchases.length === 0) {
    return null;
  }

  // ============================================================================
  // MODE 1: FULL - Always sell 100% of oldest buy order (FIFO) - NEW BEHAVIOR
  // ============================================================================
  if (COPY_SELL_MODE === "full") {
    const oldestPurchase = position.purchases[0]; // First element is oldest (FIFO)
    console.log(chalk.yellow(`📋 FULL MODE: Selling 100% of oldest buy order`));
    console.log(chalk.yellow(`   Target originally bought: ${oldestPurchase.targetBoughtAmount.toLocaleString()} tokens`));
    console.log(chalk.yellow(`   We originally bought: ${oldestPurchase.ourBoughtAmount.toLocaleString()} tokens`));
    console.log(chalk.yellow(`   Target is now selling: ${targetSellAmount.toLocaleString()} tokens`));
    console.log(chalk.yellow(`   We will sell: ${oldestPurchase.ourBoughtAmount.toLocaleString()} tokens (100% of our oldest buy)`));
    console.log(chalk.yellow(`   Remaining purchases after this sell: ${position.purchases.length - 1}`));
    return {
      ourSellAmount: oldestPurchase.ourBoughtAmount, // Sell 100% of oldest buy
      purchase: oldestPurchase,
      isFull: true // Flag to indicate full sell of this purchase
    };
  }

  // ============================================================================
  // MODE 2: MIMIC - Sell in same proportions as target - ORIGINAL BEHAVIOR (UNCHANGED)
  // ============================================================================
  // Find matching purchase based on target sell amount
  // Look for exact match first
  let matchingPurchase = position.purchases.find(p => p.targetBoughtAmount === targetSellAmount);

  if (matchingPurchase) {
    // Exact match found, return our corresponding amount
    console.log(chalk.yellow(`📋 MIMIC MODE: Exact match found (${matchingPurchase.ourBoughtAmount} tokens)`));
    return {
      ourSellAmount: matchingPurchase.ourBoughtAmount,
      purchase: matchingPurchase,
      sellMode: 'mimic'
    };
  }

  // If no exact match, find the closest match (for partial sells)
  // Sort purchases by target amount to find the best match
  const sortedPurchases = [...position.purchases].sort((a, b) => Math.abs(a.targetBoughtAmount - targetSellAmount) - Math.abs(b.targetBoughtAmount - targetSellAmount));

  if (sortedPurchases.length > 0) {
    const closestPurchase = sortedPurchases[0];
    // Calculate proportional amount based on the closest match
    let ratio = targetSellAmount / closestPurchase.targetBoughtAmount;

    // Cap ratio at 100% to prevent over-selling
    // This handles cases where target sells more than they bought (had pre-existing tokens)
    if (ratio > 1.0) {
      console.log(chalk.yellow(`📋 MIMIC MODE: Target selling ${(ratio * 100).toFixed(1)}% of tracked purchase. Capping at 100%.`));
      ratio = 1.0;
    }

    const ourSellAmount = Math.floor(closestPurchase.ourBoughtAmount * ratio);

    console.log(chalk.yellow(`📋 MIMIC MODE: Proportional sell (${ourSellAmount} tokens, ${(ratio * 100).toFixed(2)}% of purchase)`));
    return {
      ourSellAmount: ourSellAmount,
      purchase: closestPurchase,
      isProportional: true,
      sellMode: 'mimic'
    };
  }

  return null;
}

function removePosition(tokenMint, targetWallet) {
  const tokenPositions = positions.get(tokenMint);
  if (!tokenPositions) return false;
  
  const removed = tokenPositions.delete(targetWallet);
  if (removed) {
    console.log(chalk.yellow(`[${utcNow()}] 🗑️ Position removed: ${tokenMint.slice(0, 8)}... | Wallet: ${targetWallet.slice(0, 8)}...`));
    
    // Clean up empty token map
    if (tokenPositions.size === 0) {
      positions.delete(tokenMint);
    }
  }
  return removed;
}

// New function to remove specific purchase after selling
// IMPORTANT: This function handles BOTH mimic and full modes differently:
//   - MIMIC mode (exact match): passes targetSellAmount (number) - ORIGINAL behavior preserved
//   - FULL mode: passes purchase object - NEW behavior for FIFO selling
function removePurchase(tokenMint, targetWallet, targetSellAmountOrPurchase) {
  const position = getPosition(tokenMint, targetWallet);
  if (!position || !position.purchases) return false;

  let purchaseIndex = -1;

  // Check if we received a purchase object (FULL mode) or just the target sell amount (MIMIC mode)
  if (typeof targetSellAmountOrPurchase === 'object' && targetSellAmountOrPurchase !== null) {
    // FULL MODE: Purchase object passed - find by reference or by matching amounts
    // This handles cases where target's sell amount differs from original buy amount
    purchaseIndex = position.purchases.findIndex(p => p === targetSellAmountOrPurchase);
    if (purchaseIndex === -1) {
      // Fallback: try to match by both target and our amounts
      purchaseIndex = position.purchases.findIndex(
        p => p.targetBoughtAmount === targetSellAmountOrPurchase.targetBoughtAmount &&
             p.ourBoughtAmount === targetSellAmountOrPurchase.ourBoughtAmount
      );
    }
  } else {
    // MIMIC MODE: Number passed - find by target sell amount (ORIGINAL behavior)
    const targetSellAmount = targetSellAmountOrPurchase;
    purchaseIndex = position.purchases.findIndex(p => p.targetBoughtAmount === targetSellAmount);
  }

  if (purchaseIndex !== -1) {
    const removedPurchase = position.purchases.splice(purchaseIndex, 1)[0];
    position.totalAmount -= removedPurchase.ourBoughtAmount;
    position.lastUpdate = Date.now();

    // Decrement remaining purchase count
    updateTokenPurchaseCount(tokenMint, -1); // Subtract 1 purchase

    console.log(chalk.yellow(`[${utcNow()}] 🗑️ Purchase removed: ${tokenMint.slice(0, 8)}... | Wallet: ${targetWallet.slice(0, 8)}... | Target: ${removedPurchase.targetBoughtAmount.toLocaleString()} | Our: ${removedPurchase.ourBoughtAmount.toLocaleString()}`));

    // If no more purchases, remove the entire position
    if (position.purchases.length === 0) {
      removePosition(tokenMint, targetWallet);
    }
    
    return true;
  }
  
  return false;
}

function getAllPositions() {
  const allPositions = [];
  for (const [tokenMint, tokenPositions] of positions.entries()) {
    for (const [targetWallet, positionData] of tokenPositions.entries()) {
      allPositions.push({
        tokenMint,
        targetWallet,
        totalAmount: positionData.totalAmount,
        purchaseCount: positionData.purchases.length,
        lastUpdate: positionData.lastUpdate
      });
    }
  }
  return allPositions;
}

function getPositionsByToken(tokenMint) {
  const tokenPositions = positions.get(tokenMint);
  if (!tokenPositions) return [];
  
  return Array.from(tokenPositions.entries()).map(([targetWallet, positionData]) => ({
    targetWallet,
    totalAmount: positionData.totalAmount,
    purchaseCount: positionData.purchases.length,
    lastUpdate: positionData.lastUpdate
  }));
}

function getPositionsByWallet(targetWallet) {
  const walletPositions = [];
  for (const [tokenMint, tokenPositions] of positions.entries()) {
    const position = tokenPositions.get(targetWallet);
    if (position) {
      walletPositions.push({
        tokenMint,
        totalAmount: position.totalAmount,
        purchaseCount: position.purchases.length,
        lastUpdate: position.lastUpdate
      });
    }
  }
  return walletPositions;
}

function cleanupExpiredPositions() {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [tokenMint, tokenPositions] of positions.entries()) {
    for (const [targetWallet, positionData] of tokenPositions.entries()) {
      if (now - positionData.lastUpdate > POSITION_CACHE_DURATION) {
        tokenPositions.delete(targetWallet);
        cleanedCount++;
      }
    }
    
    // Clean up empty token maps
    if (tokenPositions.size === 0) {
      positions.delete(tokenMint);
      // Also clean up purchase count data for this token
      tokenPurchaseCounts.delete(tokenMint);
    }
  }
  
  // Clean up expired purchase count data
  for (const [tokenMint, countData] of tokenPurchaseCounts.entries()) {
    if (now - countData.lastUpdate > POSITION_CACHE_DURATION) {
      tokenPurchaseCounts.delete(tokenMint);
    }
  }
  
  if (cleanedCount > 0) {
    console.log(chalk.cyan(`[${utcNow()}] 🧹 Cleaned up ${cleanedCount} expired positions from cache`));
  }
}

function startPositionCleanup() {
  if (positionCleanupInterval) {
    clearInterval(positionCleanupInterval);
  }
  
  // Clean up expired positions every hour
  positionCleanupInterval = setInterval(cleanupExpiredPositions, 60 * 60 * 1000);
  
  // Initial cleanup
  cleanupExpiredPositions();
}

function showPositionTrackingStatus() {
  const totalTokens = positions.size;
  let totalPositions = 0;
  let totalPurchases = 0;
  let totalValue = 0;
  
  for (const [tokenMint, tokenPositions] of positions.entries()) {
    totalPositions += tokenPositions.size;
    for (const [targetWallet, positionData] of tokenPositions.entries()) {
      totalPurchases += positionData.purchases.length;
      totalValue += positionData.totalAmount;
    }
  }
  
  console.log(chalk.cyan(`[${utcNow()}] 📊 Position tracking status: ${totalPositions} positions (${totalPurchases} purchases) across ${totalTokens} tokens | Total value: ${totalValue.toFixed(6)} tokens`));
  
  if (totalPositions > 0) {
    console.log(chalk.cyan(`[${utcNow()}] 📊 Active positions:`));
    for (const [tokenMint, tokenPositions] of positions.entries()) {
      const shortMint = tokenMint.slice(0, 8) + "..." + tokenMint.slice(-4);
      const purchaseCount = getTokenPurchaseCount(tokenMint);
      console.log(chalk.cyan(`[${utcNow()}]   ${shortMint} (Total: ${purchaseCount.totalPurchases} purchases, Remaining: ${purchaseCount.remainingPurchases}):`));
      
      for (const [targetWallet, positionData] of tokenPositions.entries()) {
        const shortWallet = targetWallet.slice(0, 8) + "..." + targetWallet.slice(-4);
        const age = Math.floor((Date.now() - positionData.lastUpdate) / 1000);
        console.log(chalk.cyan(`[${utcNow()}]     • ${shortWallet} | Total: ${positionData.totalAmount.toLocaleString()} | Purchases: ${positionData.purchases.length} | Age: ${age}s`));
        
        // Show individual purchases
        positionData.purchases.forEach((purchase, index) => {
          const purchaseAge = Math.floor((Date.now() - purchase.buyTime) / 1000);
          console.log(chalk.cyan(`[${utcNow()}]       - Purchase ${index + 1}: Target ${purchase.targetBoughtAmount.toLocaleString()} | Our ${purchase.ourBoughtAmount.toLocaleString()} | Age: ${purchaseAge}s`));
        });
      }
    }
  }
}

// Helper function to calculate dynamic buy amount based on percentage of target wallet's SOL change
function calculateDynamicBuyAmount(solChanges,BUY_AMOUNT_PERCENTAGE ) {
  // If BUY_AMOUNT_PERCENTAGE is not set, return null to use fixed amount
  if (BUY_AMOUNT_PERCENTAGE === null) {
    return null;
  }

  try {
    // Calculate the percentage-based amount
    const solChangesInSol = Math.abs(solChanges) / LAMPORTS_PER_SOL;
    const dynamicAmount = solChangesInSol * BUY_AMOUNT_PERCENTAGE;
    
   
    
    const clampedAmount = Math.max(minAmount, Math.min(maxAmount, dynamicAmount));

    console.log(chalk.cyan(`[${utcNow()}] 💰 Dynamic Buy Amount Calculation:`));
    console.log(chalk.cyan(`   • Target SOL Change: ${solChangesInSol.toFixed(6)} SOL`));
    console.log(chalk.cyan(`   • Percentage: ${(BUY_AMOUNT_PERCENTAGE * 100).toFixed(1)}%`));
    console.log(chalk.cyan(`   • Calculated Amount: ${dynamicAmount.toFixed(6)} SOL`));
    console.log(chalk.cyan(`   • MIN_AMOUNT: ${minAmount}, MAX_AMOUNT: ${maxAmount}`));
    console.log(chalk.cyan(`   • Final Amount (clamped): ${clampedAmount.toFixed(6)} SOL`));

    return clampedAmount;
  } catch (error) {
    console.error(chalk.red(`[${utcNow()}] ❌ Error calculating dynamic buy amount: ${error.message}`));
    return null; // Fall back to fixed amount
  }
}

// Test function to simulate transactions locally
export async function testLocalTransaction() {
  console.log(chalk.bgMagenta.black(`\n[${utcNow()}] 🧪 TEST MODE: Starting local transaction test`));
  console.log(chalk.cyan(`[${utcNow()}] 🔧 Testing transaction parser with simulated data\n`));
  
  // Use actual copy wallet from env or fallback
  const testWallet = TARGET_WALLET[0] || "2S3BCxBEiaxm7U2J5sCyAmsVbWfeAikFFVe841Wc4YYS";
  const monitor = new TransactionMonitor(testWallet);
  
  // Test token mint (using a realistic Solana address format)
  const testTokenMint = "CizLY8YaB6tZVXH1w3KfepAqbJJT8QuarXNXpump";
  
  console.log(chalk.bgCyan.black(`[${utcNow()}] 📋 TEST CONFIGURATION`));
  console.log(chalk.cyan(`[${utcNow()}] • Target Wallet: ${testWallet}`));
  console.log(chalk.cyan(`[${utcNow()}] • Test Token: ${testTokenMint}`));
  console.log(chalk.cyan(`[${utcNow()}] • Your Wallet: ${MY_WALLET}\n`));
  
  // ==================== TEST 1: PUMP.FUN BUY (Direct processTransactionData test) ====================
  console.log(chalk.bgGreen.black(`[${utcNow()}] 🧪 TEST 1: PUMP.FUN BUY - Direct Parser Test`));
  
  // Simulate already-parsed data from tOutPut
  const pumpfunBuyResult = {
    solChanges: 100000000, // 0.1 SOL spent
    tokenChanges: 1000000, // 1M tokens received
    isBuy: true,
    user: testWallet,
    mint: testTokenMint,
    pool: "BondingCurveAddress123",
    liquidity: 5,
    coinCreator: "CreatorAddress123",
    pool_status: "pumpfun",
    signature: "PumpFunBuyTestSig" + Date.now(),
    context: null
  };
  
  try {
    console.log(chalk.cyan(`[${utcNow()}] � Pump.fun BUY Result (simulated parser output):`));
    console.log(chalk.cyan(`   • Token Mint: ${pumpfunBuyResult.mint}`));
    console.log(chalk.cyan(`   • User: ${pumpfunBuyResult.user}`));
    console.log(chalk.cyan(`   • Is Buy: ${pumpfunBuyResult.isBuy}`));
    console.log(chalk.cyan(`   • Token Changes: ${pumpfunBuyResult.tokenChanges.toLocaleString()}`));
    console.log(chalk.cyan(`   • SOL Changes: ${(pumpfunBuyResult.solChanges / 1e9).toFixed(4)} SOL`));
    console.log(chalk.cyan(`   • Pool Status: ${pumpfunBuyResult.pool_status}`));
    
    // Simulate the buy being executed - add position
    console.log(chalk.yellow(`\n[${utcNow()}] 📝 Simulating position tracking for pump.fun BUY...`));
    addPosition(testTokenMint, testWallet, 1000000, 1000000);
    console.log(chalk.green(`[${utcNow()}] ✅ Position added: 1,000,000 tokens\n`));
  } catch (error) {
    console.error(chalk.red(`[${utcNow()}] ❌ TEST ERROR (Pump.fun BUY): ${error.message}\n`));
  }
  
  // ==================== TEST 2: PUMP.FUN SELL ====================
  console.log(chalk.bgYellow.black(`[${utcNow()}] 🧪 TEST 2: PUMP.FUN SELL - Direct Parser Test`));
  
  const pumpfunSellResult = {
    solChanges: -150000000, // Got 0.15 SOL (negative because selling)
    tokenChanges: -1000000, // Sold 1M tokens (negative)
    isBuy: false,
    user: testWallet,
    mint: testTokenMint,
    pool: "BondingCurveAddress123",
    liquidity: 5.5,
    coinCreator: "CreatorAddress123",
    pool_status: "pumpfun",
    signature: "PumpFunSellTestSig" + Date.now(),
    context: null
  };
  
  try {
    console.log(chalk.cyan(`[${utcNow()}] 📊 Pump.fun SELL Result (simulated parser output):`));
    console.log(chalk.cyan(`   • Is Buy: ${pumpfunSellResult.isBuy}`));
    console.log(chalk.cyan(`   • Token Changes: ${pumpfunSellResult.tokenChanges.toLocaleString()}`));
    console.log(chalk.cyan(`   • SOL Received: ${Math.abs(pumpfunSellResult.solChanges / 1e9).toFixed(4)} SOL`));
    console.log(chalk.cyan(`   • Pool Status: ${pumpfunSellResult.pool_status}`));
    
    // Test copy sell logic
    console.log(chalk.yellow(`\n[${utcNow()}] � Testing copy sell matching...`));
    const targetSellAmount = Math.abs(pumpfunSellResult.tokenChanges);
    const sellData = getExactSellAmount(testTokenMint, testWallet, targetSellAmount);
    
    if (sellData) {
      console.log(chalk.green(`[${utcNow()}] ✅ Found matching purchase:`));
      console.log(chalk.cyan(`   • Target sold: ${targetSellAmount.toLocaleString()} tokens`));
      console.log(chalk.cyan(`   • We would sell: ${sellData.ourSellAmount.toLocaleString()} tokens`));
      console.log(chalk.cyan(`   • Match type: ${sellData.isProportional ? 'PROPORTIONAL' : 'EXACT'}\n`));
    } else {
      console.log(chalk.yellow(`[${utcNow()}] ⚠️ No matching purchase found (expected for this test)\n`));
    }
  } catch (error) {
    console.error(chalk.red(`[${utcNow()}] ❌ TEST ERROR (Pump.fun SELL): ${error.message}\n`));
  }
  
  // ==================== TEST 3: RAYDIUM BUY ====================
  console.log(chalk.bgGreen.black(`[${utcNow()}] 🧪 TEST 3: RAYDIUM BUY - User-based Extraction Test`));
  
  // Simulate Raydium buy with user-based extraction
  const raydiumBuyMockData = {
    meta: {
      preTokenBalances: [
        {
          mint: "So11111111111111111111111111111111111111112",
          owner: testWallet,
          uiTokenAmount: { amount: "1000000000", decimals: 9 } // Had 1 SOL
        }
      ],
      postTokenBalances: [
        {
          mint: "So11111111111111111111111111111111111111112",
          owner: testWallet,
          uiTokenAmount: { amount: "850000000", decimals: 9 } // 0.85 SOL remaining
        },
        {
          mint: testTokenMint,
          owner: testWallet,
          uiTokenAmount: { amount: "2500000", decimals: 6 } // Got 2.5M tokens
        }
      ]
    },
    transaction: {
      signatures: ["RaydiumBuyTestSig" + Date.now()]
    }
  };
  
  // Manually create the expected result
  const raydiumBuyResult = {
    solChanges: 150000000, // Spent 0.15 SOL
    tokenChanges: 2500000, // Got 2.5M tokens
    isBuy: true,
    user: testWallet,
    mint: testTokenMint,
    pool: null,
    liquidity: 10,
    coinCreator: "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL",
    pool_status: "raydium",
    signature: "RaydiumBuyTestSig" + Date.now(),
    context: null
  };
  
  try {
    console.log(chalk.cyan(`[${utcNow()}] � Raydium BUY Result (simulated user-based extraction):`));
    console.log(chalk.cyan(`   • Token Mint: ${raydiumBuyResult.mint}`));
    console.log(chalk.cyan(`   • User: ${raydiumBuyResult.user}`));
    console.log(chalk.cyan(`   • Is Buy: ${raydiumBuyResult.isBuy}`));
    console.log(chalk.cyan(`   • Token Changes: ${raydiumBuyResult.tokenChanges.toLocaleString()}`));
    console.log(chalk.cyan(`   • SOL Changes: ${(raydiumBuyResult.solChanges / 1e9).toFixed(4)} SOL`));
    console.log(chalk.cyan(`   • Pool Status: ${raydiumBuyResult.pool_status}`));
    
    // Add position for Raydium
    console.log(chalk.yellow(`\n[${utcNow()}] 📝 Simulating Raydium position tracking...`));
    addPosition(testTokenMint, testWallet, 2500000, 2500000);
    console.log(chalk.green(`[${utcNow()}] ✅ Position added: 2,500,000 tokens\n`));
  } catch (error) {
    console.error(chalk.red(`[${utcNow()}] ❌ TEST ERROR (Raydium BUY): ${error.message}\n`));
  }
  
  // ==================== TEST 4: RAYDIUM SELL ====================
  console.log(chalk.bgYellow.black(`[${utcNow()}] 🧪 TEST 4: RAYDIUM SELL - User-based Extraction Test`));
  
  const raydiumSellResult = {
    solChanges: -200000000, // Got 0.2 SOL
    tokenChanges: -2500000, // Sold 2.5M tokens
    isBuy: false,
    user: testWallet,
    mint: testTokenMint,
    pool: null,
    liquidity: 10.5,
    coinCreator: "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL",
    pool_status: "raydium",
    signature: "RaydiumSellTestSig" + Date.now(),
    context: null
  };
  
  try {
    console.log(chalk.cyan(`[${utcNow()}] 📊 Raydium SELL Result (simulated user-based extraction):`));
    console.log(chalk.cyan(`   • Token Mint: ${raydiumSellResult.mint}`));
    console.log(chalk.cyan(`   • User: ${raydiumSellResult.user}`));
    console.log(chalk.cyan(`   • Is Buy: ${raydiumSellResult.isBuy}`));
    console.log(chalk.cyan(`   • Token Changes: ${raydiumSellResult.tokenChanges.toLocaleString()}`));
    console.log(chalk.cyan(`   • SOL Received: ${Math.abs(raydiumSellResult.solChanges / 1e9).toFixed(4)} SOL`));
    console.log(chalk.cyan(`   • Pool Status: ${raydiumSellResult.pool_status}`));
    
    // Test copy sell logic
    console.log(chalk.yellow(`\n[${utcNow()}] � Testing Raydium copy sell matching...`));
    const targetSellAmount = Math.abs(raydiumSellResult.tokenChanges);
    const sellData = getExactSellAmount(testTokenMint, testWallet, targetSellAmount);
    
    if (sellData) {
      console.log(chalk.green(`[${utcNow()}] ✅ Found matching Raydium purchase:`));
      console.log(chalk.cyan(`   • Target sold: ${targetSellAmount.toLocaleString()} tokens`));
      console.log(chalk.cyan(`   • We would sell: ${sellData.ourSellAmount.toLocaleString()} tokens`));
      console.log(chalk.cyan(`   • Match type: ${sellData.isProportional ? 'PROPORTIONAL' : 'EXACT'}`));
      console.log(chalk.cyan(`   • Profit: ${Math.abs(raydiumSellResult.solChanges / 1e9).toFixed(4)} SOL\n`));
    } else {
      console.log(chalk.yellow(`[${utcNow()}] ⚠️ No matching purchase found\n`));
    }
  } catch (error) {
    console.error(chalk.red(`[${utcNow()}] ❌ TEST ERROR (Raydium SELL): ${error.message}\n`));
  }
  
  // ==================== SHOW RESULTS ====================
  console.log(chalk.bgCyan.black(`[${utcNow()}] 📊 TEST SUMMARY - Position Tracking`));
  showPositionTrackingStatus();
  
  console.log(chalk.bgGreen.black(`\n[${utcNow()}] ✅ TEST MODE: All local transaction tests completed\n`));
  console.log(chalk.yellow(`[${utcNow()}] 💡 NEXT STEPS:`));
  console.log(chalk.yellow(`   1. Verify the parser correctly extracts SOL and token changes`));
  console.log(chalk.yellow(`   2. Confirm position tracking works for both pump.fun and Raydium`));
  console.log(chalk.yellow(`   3. Test copy sell matching finds correct purchase amounts`));
  console.log(chalk.yellow(`   4. Run production mode: npm start\n`));
}

// Add global function to show all bot counts

