import { bondingCurvePda, getBuySolAmountFromTokenAmount, getBuyTokenAmountFromSolAmount, PumpSdk } from "@pump-fun/pump-sdk";
import BN from "bn.js";
import pkg from '@solana/web3.js';
const { ComputeBudgetProgram, PublicKey, sendRawTransaction, sendAndConfirmRawTransaction, SystemProgram } = pkg;
import { TransactionMessage, Connection, VersionedTransaction } from "@solana/web3.js";
import { loadwallet, swap } from "./swap.js";
import { PumpAmmSdk } from "@pump-fun/pump-swap-sdk";
import dotenv from "dotenv";
import { getSplTokenBalance } from "./fuc.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  createCloseAccountInstruction,
} from "@solana/spl-token";
import chalk from "chalk";
import { createPumpFunBuyInstruction, createPumpFunSellInstruction } from "./instruction_pumpfun.js";
import { createPumpSwapBuyInstruction, createPumpSwapSellInstruction } from "./instruction_pumpswap.js";
import { hasAtaInCache, hasAtaInCacheSync, addAtaToCache, updateOnChainStatus, getAtaAddress, getAtaAddressSync, isToken2022, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "./ata_cache.js";
import { BlockhashManager } from "./blockhash_manager.js";
dotenv.config();
// PRI
const COMMITMENT_LEVEL = "confirmed";
const PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"; // or the correct program id
const NOZOMI_UUID = process.env.NOZOMI_UUID;
const NOZOMI_URL = process.env.NOZOMI_URL;
const NOZOMI_TIP_ACCOUNT = process.env.NOZOMI_TIP_ACCOUNT;
const NOZOMI_TIP_LAMPORTS = process.env.NOZOMI_TIP_LAMPORTS;
const DIRECT_ADDED_PUMPSWAP = process.env.DIRECT_ADDED_PUMPSWAP === "true";
const ZEROSLOT_RPC_URL = process.env.ZEROSLOT_RPC_URL;
const SLOT_TIP_LAMPORTS = process.env.SLOT_TIP_LAMPORTS;
const SLOT_TIP_ACCOUNT = new PublicKey(process.env.SLOT_TIP_ACCOUNT);

const JITO_TIP_LAMPORTS = process.env.JITO_TIP_LAMPORTS;
const ENABLE_SWAP_TIP = process.env.ENABLE_SWAP_TIP === "true";
const MAX_RETRIES = process.env.MAX_RETRIES;
const RETRY_DELAY = process.env.RETRY_DELAY;

// Use a shared connection
const solanaConnection = new Connection(process.env.RPC_URL, COMMITMENT_LEVEL);
const SLOT_connection = new Connection(ZEROSLOT_RPC_URL, COMMITMENT_LEVEL);
const NOZOMI_connection = new Connection("http://ewr1.nozomi.temporal.xyz/?c=4516a74a-ad06-4faf-9de4-10cce6e37f6b");
// const JITO_connection =
// HTTP Keep-Alive Manager for multiple connection types
class KeepAliveManager {
  constructor(connection, connectionType = "rpc", healthCheckInterval = 60000) {
    this.connection = connection;
    this.connectionType = connectionType; // 'rpc', 'nozomi', 'slot'
    this.healthCheckInterval = healthCheckInterval;
    this.isRunning = false;
    this.healthCheckTimer = null;
    this.lastHealthCheck = 0;
    this.requestCount = 0;
    this.maxRequests = 1000; // Nozomi limit
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`🔄 Starting Keep-Alive manager for ${this.connectionType} connection...`);
    await this.performHealthCheck();
    this.scheduleNextHealthCheck();
  }

  stop() {
    this.isRunning = false;
    if (this.healthCheckTimer) {
      clearTimeout(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    console.log(`⏹️ Stopping Keep-Alive manager for ${this.connectionType}...`);
  }

  async performHealthCheck() {
    try {
      const startTime = performance.now();
      if (this.connectionType === "nozomi") {
        // Mimic: while true; do curl -s http://nozomi.temporal.xyz/ping > /dev/null; sleep 60; done
        try {
          const pingUrl = "http://nozomi.temporal.xyz/ping";
          await fetch(pingUrl, { method: "GET" });
          const endTime = performance.now();
          this.lastHealthCheck = Date.now();
          const durationUs = Math.round((endTime - startTime) * 1000);
          console.log(`✅ Nozomi ping completed in ${durationUs}μs`);
          // No output, just silent ping
        } catch (e) {
          // Ignore errors, just like curl -s
        }
        // Sleep for 60 seconds before next check (handled by scheduleNextHealthCheck)
        return;
      } else if (this.connectionType === "slot") {
        // Use 0slot's recommended health check method
        const response = await fetch(this.connection._rpcEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getHealth",
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const healthResponse = await response.json();
        const endTime = performance.now();
        this.lastHealthCheck = Date.now();
        const durationUs = Math.round((endTime - startTime) * 1000);
        console.log(`✅ 0slot health check completed in ${durationUs}μs`);
      } else {
        // Standard Solana RPC health check
        const response = await fetch(this.connection._rpcEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getHealth",
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const endTime = performance.now();
        this.lastHealthCheck = Date.now();
        const durationUs = Math.round((endTime - startTime) * 1000);
        console.log(`✅ Solana RPC health check completed in ${durationUs}μs`);
      }
    } catch (error) {
      console.error(`❌ Keep-Alive health check failed for ${this.connectionType}:`, error.message);
    }
  }

  scheduleNextHealthCheck() {
    if (!this.isRunning) return;

    this.healthCheckTimer = setTimeout(async () => {
      if (this.isRunning) {
        await this.performHealthCheck();
        this.scheduleNextHealthCheck();
      }
    }, this.healthCheckInterval);
  }

  async ensureConnection() {
    // If it's been more than 55 seconds since last health check, perform one now
    const now = Date.now();
    if (now - this.lastHealthCheck > 45000) {
      // 55 seconds threshold (45000ms)
      console.log(`🔄 Performing immediate health check to maintain Keep-Alive for ${this.connectionType}...`);
      await this.performHealthCheck();
    }
  }

  getLastHealthCheck() {
    return this.lastHealthCheck;
  }

  getRequestCount() {
    return this.requestCount;
  }

  resetRequestCount() {
    this.requestCount = 0;
    console.log(`🔄 Reset request count for ${this.connectionType} connection`);
  }
}

// Create and start the Keep-Alive managers for all connections
const slotKeepAliveManager = new KeepAliveManager(SLOT_connection, "slot", 60000); // 60 seconds for 0slot
const nozomiKeepAliveManager = new KeepAliveManager(NOZOMI_connection, "nozomi", 60000); // 60 seconds for Nozomi
const solanaKeepAliveManager = new KeepAliveManager(solanaConnection, "rpc", 60000); // 60 seconds for main Solana

// Start all keep-alive managers
slotKeepAliveManager.start().catch(console.error);
nozomiKeepAliveManager.start().catch(console.error);
solanaKeepAliveManager.start().catch(console.error);

// Helper function to check and manage Nozomi connection limits
export function checkNozomiConnectionHealth() {
  const requestCount = nozomiKeepAliveManager.getRequestCount();
  if (requestCount >= 950) {
    // Warning at 95% of limit
    console.warn(`⚠️ Nozomi connection approaching limit: ${requestCount}/1000 requests`);
  }
  if (requestCount >= 1000) {
    console.error(`❌ Nozomi connection limit reached: ${requestCount}/1000 requests`);
    // Reset the counter and potentially reconnect
    nozomiKeepAliveManager.resetRequestCount();
    return false;
  }
  return true;
}

// Function to always check all connections proactively
export async function checkAllConnections() {
  try {
    // Check all keep-alive managers
    await slotKeepAliveManager.ensureConnection();
    await nozomiKeepAliveManager.ensureConnection();
    await solanaKeepAliveManager.ensureConnection();

    // Also check Nozomi connection health
    checkNozomiConnectionHealth();

    console.log("✅ All connections checked and maintained");
  } catch (error) {
    console.error("❌ Error checking connections:", error);
  }
}

// Function to manually trigger connection checks (can be called before critical operations)
export async function ensureAllConnections() {
  await checkAllConnections();
}

// Helper function to get connection status for monitoring
export function getConnectionStatus() {
  return {
    slot: {
      lastHealthCheck: slotKeepAliveManager.getLastHealthCheck(),
      isRunning: slotKeepAliveManager.isRunning,
    },
    nozomi: {
      lastHealthCheck: nozomiKeepAliveManager.getLastHealthCheck(),
      requestCount: nozomiKeepAliveManager.getRequestCount(),
      isRunning: nozomiKeepAliveManager.isRunning,
    },
    solana: {
      lastHealthCheck: solanaKeepAliveManager.getLastHealthCheck(),
      isRunning: solanaKeepAliveManager.isRunning,
    },
  };
}

// Wallet cache for faster subsequent loads
let cachedWallet = null;
let walletLoadPromise = null;

// SDK and global data cache for faster subsequent loads
let cachedPumpSdk = null;
let cachedGlobal = null;
let globalFetchPromise = null;
let globalLastFetch = 0;
const GLOBAL_CACHE_DURATION = 5000; // Cache global data for 5 seconds

// Cached wallet loader
export async function getCachedWallet() {
  // If wallet is already cached, return it immediately
  if (cachedWallet) {
    return cachedWallet;
  }

  // If wallet is currently being loaded, wait for that promise
  if (walletLoadPromise) {
    return await walletLoadPromise;
  }

  // Start loading the wallet
  walletLoadPromise = await loadwallet();
  try {
    cachedWallet = walletLoadPromise;
    // console.log("✅ Wallet loaded and cached for future use");
    return cachedWallet;
  } finally {
    walletLoadPromise = null;
  }
}

// Cached SDK loader
function getCachedPumpSdk() {
  if (!cachedPumpSdk) {
    cachedPumpSdk = new PumpSdk(solanaConnection);
  }
  return cachedPumpSdk;
}

// Cached global data loader
async function getCachedGlobal() {
  const now = Date.now();

  // If we have cached global data and it's still fresh, return it
  if (cachedGlobal && now - globalLastFetch < GLOBAL_CACHE_DURATION) {
    return cachedGlobal;
  }

  // If global is currently being fetched, wait for that promise
  if (globalFetchPromise) {
    return await globalFetchPromise;
  }

  // Start fetching global data
  globalFetchPromise = getCachedPumpSdk().fetchGlobal();
  try {
    cachedGlobal = await globalFetchPromise;
    globalLastFetch = now;
    return cachedGlobal;
  } finally {
    globalFetchPromise = null;
  }
}

// Function to clear wallet cache if needed (e.g., for testing different wallets)
export function clearWalletCache() {
  cachedWallet = null;
  walletLoadPromise = null;
  console.log("🗑️ Wallet cache cleared");
}

// Function to clear SDK and global cache
export function clearSdkCache() {
  cachedPumpSdk = null;
  cachedGlobal = null;
  globalFetchPromise = null;
  globalLastFetch = 0;
  console.log("🗑️ SDK cache cleared");
}



// Create and start the blockhash manager
const blockhashManager = new BlockhashManager(solanaConnection, 2000); // Update every 200ms
// Start the background blockhash manager
blockhashManager.start().catch(console.error);

// Background connection checker that runs every 30 seconds
let connectionCheckInterval;
function startConnectionChecker() {
  connectionCheckInterval = setInterval(async () => {
    try {
      await checkAllConnections();
    } catch (error) {
      console.error("Background connection check failed:", error);
    }
  }, 30000); // Check every 30 seconds
}

// Start the background connection checker
startConnectionChecker();

// Cleanup on process exit
process.on("SIGINT", () => {
  blockhashManager.stop();
  slotKeepAliveManager.stop();
  nozomiKeepAliveManager.stop();
  solanaKeepAliveManager.stop();
  if (connectionCheckInterval) {
    clearInterval(connectionCheckInterval);
  }
  process.exit(0);
});

process.on("SIGTERM", () => {
  blockhashManager.stop();
  slotKeepAliveManager.stop();
  nozomiKeepAliveManager.stop();
  solanaKeepAliveManager.stop();
  if (connectionCheckInterval) {
    clearInterval(connectionCheckInterval);
  }
  process.exit(0);
});

// Helper to safely parse env vars to BigInt, with fallback/default
function parseBigIntEnv(varValue, defaultValue) {
  if (typeof varValue === "bigint") return varValue;
  if (typeof varValue === "number" && !isNaN(varValue)) return BigInt(varValue);
  if (typeof varValue === "string" && varValue.trim() !== "" && !isNaN(Number(varValue))) {
    try {
      // Allow decimal string, but must be integer
      if (!/^\d+$/.test(varValue.trim())) throw new Error("Not an integer string");
      return BigInt(varValue.trim());
    } catch {
      return defaultValue;
    }
  }
  return defaultValue;
}
function getPoolStateFromTxContext(context) {
  return {
    virtualTokenReserves: BigInt(context.virtualTokenReserves).toString(16),
    virtualSolReserves: BigInt(context.virtualSolReserves).toString(16),
    realTokenReserves: BigInt(context.realTokenReserves).toString(16),
    realSolReserves: BigInt(context.realSolReserves).toString(16),
    tokenTotalSupply: "38d7ea4c68000", // this is not in the tx context, must fetch separately
    complete: false, // no way to infer from tx context — needs on-chain state
    creator: context.creator,
  };
}

function utcNow() {
  return new Date().toISOString();
}
export async function buy_pumpfun(mint, amount, context) {
  try {
    const startTime = performance.now();
    
    // Pre-compute all static values once
    const slippage = parseInt(process.env.BUY_SLIPPAGE_BPS_PERCENTAGE) || 500;
    const slippageMultiplier = 1 + slippage / 100;
    const prioritizationFee = parseBigIntEnv(process.env.BUY_PRIORITIZATION_FEE_LAMPORTS, 2000n);
    const swapMethod = (process.env.SWAP_METHOD || "solana").toLowerCase();
    
    // Get wallet and compute values in parallel
    const [wallet, price, token_amount] = await Promise.all([
      getCachedWallet(),
      Promise.resolve(context.virtualSolReserves / context.virtualTokenReserves),
      Promise.resolve(Math.floor(amount / (context.virtualSolReserves / context.virtualTokenReserves)))
    ]);
    
    const coin_creator = context.creator;
    const feeRecipient = context.feeRecipient;
    const walletPublicKey = wallet.keypair.publicKey;
    const instructions = [];

    // CRITICAL: Detect token type FIRST before any cache operations
    const isT2022 = await isToken2022(solanaConnection, mint);
    const tokenProgramId = isT2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const tokenType = isT2022 ? 'token2022' : 'token';

    console.log(`🔍 Token Type Detection: ${mint}`);
    console.log(`   Is Token2022: ${isT2022}`);
    console.log(`   Token Program: ${tokenProgramId.toString()}`);
    console.log(`   Token Type: ${tokenType}`);

    // Ultra-fast ATA handling using sync cache functions with token type
    const ataExistsInCache = hasAtaInCacheSync(mint, walletPublicKey.toString(), tokenType);
    console.log(`   ATA in cache (${tokenType}): ${ataExistsInCache}`);

    let userAta;
    let ataExistsOnChain = false;

    if (ataExistsInCache) {
      // ATA exists in cache, get it from cache synchronously
      userAta = getAtaAddressSync(mint, walletPublicKey.toString(), tokenType);
      console.log(`   📋 Cached ATA: ${userAta?.toString()}`);

      if (!userAta) {
        // Fallback to async if sync fails
        userAta = await getAtaAddress(mint, walletPublicKey.toString(), solanaConnection);
        console.log(`   ⚠️ Sync failed, async ATA: ${userAta.toString()}`);
      }

      // CRITICAL: Validate cached ATA exists on-chain (especially for Token2022)
      try {
        await getAccount(solanaConnection, userAta, 'confirmed', tokenProgramId);
        ataExistsOnChain = true;
        console.log(`   ✅ Validated: ATA exists on-chain`);
      } catch (e) {
        ataExistsOnChain = false;
        console.log(`   ⚠️ Cached ATA does NOT exist on-chain - will create it`);
        // Mark cache entry as not on-chain
        updateOnChainStatus(mint, walletPublicKey.toString(), false);
      }
    } else {
      // ATA doesn't exist in cache, calculate it and add to cache
      userAta = await getAtaAddress(mint, walletPublicKey.toString(), solanaConnection);
      console.log(`   📝 Calculated new ATA: ${userAta.toString()}`);
    }

    // Add ATA creation instruction if it doesn't exist on-chain
    let creatingAta = false;
    if (!ataExistsOnChain) {
      console.log(`   ➕ Adding ATA creation instruction with ${tokenProgramId.toString()}`);
      instructions.push(
        createAssociatedTokenAccountInstruction(
          walletPublicKey,
          userAta,
          walletPublicKey,
          new PublicKey(mint),
          tokenProgramId
        )
      );
      creatingAta = true;
      console.log(`   ✅ ATA instruction added (total instructions: ${instructions.length})`);
    }

    // Create buy instruction with pre-computed values
    const buyInstruction = await createPumpFunBuyInstruction(
      mint,
      amount * slippageMultiplier,
      token_amount,
      walletPublicKey,
      coin_creator,
      feeRecipient,
      userAta,
      tokenProgramId
    );
    
    // Get blockhash synchronously first, fallback to async only if needed
    let recentBlockhash = blockhashManager.getBlockhashSync();
    if (!recentBlockhash) {
      recentBlockhash = await blockhashManager.getBlockhash();
    }
    
    // Pre-compute common instructions
    const prioritizationIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: prioritizationFee });
    const unitLimitIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 });
    
    let txid = "";

    // const nozomiInstructions = [...instructions, nozomiTipIx, prioritizationIx, unitLimitIx, buyInstruction];
    // const allInstructions = [...instructions, slotTipIx, nozomiTipIx, buyInstruction];
    if (swapMethod === "0slot") {
      const slotTipIx = SystemProgram.transfer({
        fromPubkey: walletPublicKey,
        toPubkey: SLOT_TIP_ACCOUNT,
        lamports: SLOT_TIP_LAMPORTS,
      });

      // Build transaction in one pass
      const allInstructions = [slotTipIx, prioritizationIx, unitLimitIx, buyInstruction];
      if (instructions.length > 0) allInstructions.unshift(...instructions);

      console.log(`📦 Final transaction composition:`);
      console.log(`   Pre-instructions (ATA, etc): ${instructions.length}`);
      console.log(`   Total instructions in TX: ${allInstructions.length}`);
      console.log(`   Instruction order: ${instructions.length > 0 ? '[ATA], ' : ''}[Tip], [Priority], [UnitLimit], [Buy]`);

      const txMessage = new TransactionMessage({
        payerKey: walletPublicKey,
        recentBlockhash,
        instructions: allInstructions,
      });
      
      const transaction = new VersionedTransaction(txMessage.compileToV0Message([]));
      transaction.sign([wallet.keypair]);
      
      txid = await SLOT_connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: true,
        maxRetries: 10,
      });
    } else if (swapMethod === "nozomi") {
      const nozomiTipIx = SystemProgram.transfer({
        fromPubkey: walletPublicKey,
        toPubkey: new PublicKey(NOZOMI_TIP_ACCOUNT),
        lamports: NOZOMI_TIP_LAMPORTS,
      });
      
      // Build transaction in one pass
      const allInstructions = [nozomiTipIx, prioritizationIx, unitLimitIx, buyInstruction];
      if (instructions.length > 0) allInstructions.unshift(...instructions);
      
      const txMessage = new TransactionMessage({
        payerKey: walletPublicKey,
        recentBlockhash,
        instructions: allInstructions,
      });
      
      const transaction = new VersionedTransaction(txMessage.compileToV0Message([]));
      transaction.sign([wallet.keypair]);
      
      txid = await NOZOMI_connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: true,
        maxRetries: 10,
      });
    } else {
      // Fallback to Solana connection
      const allInstructions = [prioritizationIx, unitLimitIx, buyInstruction];
      if (instructions.length > 0) allInstructions.unshift(...instructions);
      
      const txMessage = new TransactionMessage({
        payerKey: walletPublicKey,
        recentBlockhash,
        instructions: allInstructions,
      });
      
      const transaction = new VersionedTransaction(txMessage.compileToV0Message([]));
      transaction.sign([wallet.keypair]);
      
      txid = await solanaConnection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: true,
        maxRetries: 10,
      });
    }
    
    const totalDuration = Math.round((performance.now() - startTime) * 1000);
    console.log(`✅ ${utcNow()} BUY Pumpfun completed in ${totalDuration}μs - TX: ${txid}`);

    // Optimistically mark ATA as on-chain after successful transaction send
    if (creatingAta && txid) {
      updateOnChainStatus(mint, walletPublicKey.toString(), true);
    }

    return {txid, token_amount};
  } catch (error) {
    console.error("Error in buy_pumpfun:", error);
    throw error;
  }
}
// Helper to get context if missing/invalid
async function getContextFromSdk(mint) {
  try {
    const sdk = new PumpSdk(solanaConnection);
    const global = await sdk.fetchGlobal();
    const bondingcurve = await sdk.fetchBondingCurve(mint);
    const coin_creator = bondingcurve.creator;
    return {
      creator: coin_creator,
      feeRecipient: global.feeRecipient,
    };
  } catch (e) {
    console.error("Failed to fetch context from SDK for mint", mint, e);
    throw e;
  }
}
export async function sell_pumpfun(mint, token_amount, isFull, context) {
  // If isFull is not true, do not retry, just try once
  // const MAX_RETRIES = isFull ? MAX_RETRIES : 1;
  let attempt = 0;
  let lastError = null;
  const swapMethod = (process.env.SWAP_METHOD || "solana").toLowerCase();

  while (attempt < MAX_RETRIES) {
    try {
      // Only check the balance if isFull is true and this is a retry
      if (isFull && attempt >= 1) {
        const balance = await getSplTokenBalance(mint);
        console.log(`(Retry #${attempt}) Current tokenA (${mint}) balance:`, balance, "Requested amount:", token_amount);
        if (balance <= 0) {
          console.log(`No balance for tokenA (${mint}) to sell. Aborting swap.`);
          return "stop";
        }
        if (token_amount > balance) {
          console.log(
            `Requested token_amount (${token_amount}) exceeds available balance (${balance}) for mint (${mint}). Adjusting token_amount to available balance.`
          );
          token_amount = balance;
        }
      }
      // const slippage = parseInt(process.env.SELL_SLIPPAGE_BPS_PERCENTAGE) || 50; // default 50 = 0.5%
      const prioritizationFee = isFull
        ? parseBigIntEnv(process.env.SELL_ALL_PRIORITIZATION_FEE_LAMPORTS, 20000n)
        : parseBigIntEnv(process.env.SELL_PRIORITIZATION_FEE_LAMPORTS, 20000n); // default 20000 microLamports
      const wallet = await getCachedWallet();

      // Defensive: If context is null or missing creator/feeRecipient, fetch from SDK
      let coin_creator, feeRecipient;
      try {
        if (!context || !context.creator || !context.feeRecipient) {
          console.warn("Context missing or invalid, fetching from SDK for mint:", mint);
          const sdkContext = await getContextFromSdk(mint);
          coin_creator = sdkContext.creator;
          feeRecipient = sdkContext.feeRecipient;
        } else {
          coin_creator = context.creator;
          feeRecipient = context.feeRecipient;
        }
      } catch (sdkErr) {
        throw new Error("Failed to get creator/feeRecipient from context or SDK: " + sdkErr.message);
      }

      // CRITICAL: Detect token type FIRST
      const isT2022 = await isToken2022(solanaConnection, mint);
      const tokenProgramId = isT2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

      const walletPublicKey = wallet.keypair.publicKey.toString();
      const userAta = await getAtaAddress(mint, walletPublicKey, solanaConnection);


      // const blockhashStartTime = Date.now();
      let recentBlockhash = blockhashManager.getBlockhashSync();

      // If no blockhash is available or this is a retry after blockheight error, fetch fresh one
      if (!recentBlockhash || (attempt > 0 && lastError && lastError.message && lastError.message.includes('block height exceeded'))) {
        console.log("⚠️ No cached blockhash or retry after blockheight error, fetching fresh blockhash...");
        recentBlockhash = await blockhashManager.getFreshBlockhash();
      }

      const instructions = [];

      const sellInstruction = await createPumpFunSellInstruction(
        mint,
        0,
        token_amount,
        wallet.keypair.publicKey,
        coin_creator,
        feeRecipient,
        userAta,
        tokenProgramId
      );
      instructions.push(sellInstruction);

      instructions.push(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: prioritizationFee }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 })
      );
      // ============================================================================
      // ATA CLOSE LOGIC - Different treatment for regular SPL vs Token2022
      // ============================================================================
      // Regular SPL tokens: Close ATA in same transaction (atomic with sell)
      //   - Safe because no extensions that could leave dust
      //   - Recovers rent immediately (~0.002 SOL)
      //
      // Token2022 tokens: Skip close during copy trading
      //   - Extensions (transfer fees, interest) can leave "withheld" dust
      //   - If close fails, ENTIRE transaction reverts (sell also fails!)
      //   - ATAs cleaned up later during startup post-cleanup if truly empty
      //   - Small rent cost is acceptable vs risk of failed sells
      // ============================================================================
      let shouldClose = false;
      if (isFull && !isT2022) {
        try {
          const actualBalance = await getSplTokenBalance(mint);
          // Only close if we're selling all or more than the actual balance
          if (token_amount >= actualBalance) {
            shouldClose = true;
            const closeInstruction = createCloseAccountInstruction(
              userAta, // token account to close
              wallet.keypair.publicKey, // destination (refund rent to payer)
              wallet.keypair.publicKey, // authority
              [], // multiSigners
              tokenProgramId // CRITICAL: Use correct token program for Token2022
            );
            instructions.push(closeInstruction);
            console.log(`🔒 Adding close instruction (selling ${token_amount} of ${actualBalance} total)`);
          } else {
            console.log(`⏭️ Skipping close instruction (selling ${token_amount} but ${actualBalance} total in account)`);
          }
        } catch (error) {
          console.log(chalk.yellow(`⚠️ Could not add close instruction: ${error.message}`));
        }
      } else if (isFull && isT2022) {
        console.log(`⏭️ Skipping close for Token2022 (may have withheld dust from transfer fees)`);
      }

      if (swapMethod === "0slot" && isFull) {
        const tipTransferInstruction = SystemProgram.transfer({
          fromPubkey: wallet.keypair.publicKey,
          toPubkey: SLOT_TIP_ACCOUNT,
          lamports: SLOT_TIP_LAMPORTS,
        });
        instructions.push(tipTransferInstruction);
      }
      // Build a VersionedTransaction manually instead of using transactionFromInstructions
      const txMessage = new TransactionMessage({
        payerKey: wallet.keypair.publicKey,
        recentBlockhash: recentBlockhash,
        instructions: instructions,
      });
      const v0Message = txMessage.compileToV0Message([]);
      const transaction = new VersionedTransaction(v0Message);
      transaction.sign([wallet.keypair]);

      let txid = "";

      if (swapMethod === "0slot" && isFull) {
        // Send transaction with 0slot connection (requires tip)
        txid = await SLOT_connection.sendRawTransaction(transaction.serialize(), {
          skipPreflight: true,
          maxRetries: 10,
        });

      } else {
        console.log("sending sell tx with Solana Keep-Alive");
        txid = await solanaConnection.sendRawTransaction(transaction.serialize(), {
          skipPreflight: true,
          maxRetries: 10,
        });
      }
      // Confirm the transaction after sending with fresh blockhash info
      const freshBlockhashInfo = await solanaConnection.getLatestBlockhash("processed");
      const confirmation = await solanaConnection.confirmTransaction(
        {
          signature: txid,
          blockhash: freshBlockhashInfo.blockhash,
          lastValidBlockHeight: freshBlockhashInfo.lastValidBlockHeight,
        },
        "confirmed"
      );
      if (confirmation.value && confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }
      if (txid && shouldClose) {
        // SUCCESS: ATA closed (only regular SPL tokens reach here, not Token2022)
        // Update cache: onChain=false so next buy creates new ATA
        // Note: Token2022 ATAs keep onChain=true and are cleaned up during startup
        updateOnChainStatus(mint, walletPublicKey, false);
      }

      console.log("SELL Pumpfun Transaction:", txid);
      return txid;
    } catch (error) {
      lastError = error;
      attempt++;
      console.error(`Error in sell_pumpfun (attempt ${attempt}/${MAX_RETRIES}):`, error);

      // If this is a blockheight exceeded error, force update blockhash for next attempt
      if (error.message && error.message.includes('block height exceeded')) {
        console.log("🔄 Block height exceeded, forcing fresh blockhash update...");
        await blockhashManager.forceUpdate();
      }

      // If the error is a TypeError about reading 'creator' of null, try to fetch context from SDK and retry
      if (error && error instanceof TypeError && error.message && error.message.includes("reading 'creator'")) {
        console.warn("TypeError: Cannot read properties of null (reading 'creator'). Will attempt to fetch context from SDK and retry.");
        // On next loop, context will be fetched from SDK
      } else if (attempt >= MAX_RETRIES) {
        console.error("All retry attempts failed for sell_pumpfun");
        throw lastError;
      }
      // Wait a bit before retrying
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

export async function buy_pumpswap(mint, amount, context) {
  try {
    // Parse slippage and prioritization fee from env, fallback to safe defaults
    const slippage = parseInt(process.env.BUY_SLIPPAGE_BPS_PERCENTAGE) || 500; // default 500 = 5%
    const prioritizationFee = parseBigIntEnv(process.env.BUY_PRIORITIZATION_FEE_LAMPORTS, 2000n); // default 2000 microLamports
    const wallet = await getCachedWallet();

    // Get required accounts from context
    const pool = new PublicKey(context.pool);
    const user = wallet.keypair.publicKey;
    let baseMint
    let quoteMint
    if (DIRECT_ADDED_PUMPSWAP){
      console.log(chalk.green("____________DIRECT_ADDED_PUMPSWAP_________________________________"))
       baseMint = "So11111111111111111111111111111111111111112"; 
       quoteMint =mint; // SOL
    }else{
      console.log(chalk.red("____________!!!!DIRECT_ADDED_PUMPSWAP_________________________________"))

       quoteMint = "So11111111111111111111111111111111111111112"; // SOL
       baseMint = mint;
    }

    const protocolFeeRecipient = new PublicKey(context.protocolFeeRecipient);
    const protocolFeeRecipientTokenAccount = new PublicKey(context.protocolFeeRecipientTokenAccount);
    const coinCreator = new PublicKey(context.coinCreator);

    // Calculate amounts based on slippage
    
    const price = context.poolBaseTokenReserves/context.poolQuoteTokenReserves ;
    const token_amount = amount * price;
    console.log("token_amount", token_amount)
    const baseAmountOut = token_amount;
    const maxQuoteAmountIn = amount*(1+slippage/10000)
    
    console.log("🔍 Debug Info:");
    console.log("  Pool:", pool.toString());
    console.log("  User:", user.toString());
    console.log("  Base Mint:", baseMint);
    console.log("  Quote Mint:", quoteMint);
    console.log("  Base Amount Out:", baseAmountOut.toString());
    console.log("  Max Quote Amount In:", maxQuoteAmountIn.toString());
    console.log("  Slippage:", slippage);
    console.log("  DIRECT_ADDED_PUMPSWAP:", DIRECT_ADDED_PUMPSWAP);

    let instructions = [];
    // Check if user has an Associated Token Account for base mint using cache
    const walletPublicKey = wallet.keypair.publicKey.toString();
    const baseMintPubkey = new PublicKey(baseMint);
    const quoteMintPubkey = new PublicKey(quoteMint);
    console.log("basemint:", baseMintPubkey)
    console.log("quotemint:", quoteMintPubkey)

    // CRITICAL: Detect token types FIRST
    const isT2022Base = await isToken2022(solanaConnection, baseMint);
    const tokenProgramIdBase = isT2022Base ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const tokenTypeBase = isT2022Base ? 'token2022' : 'token';

    const isT2022Quote = await isToken2022(solanaConnection, quoteMint);
    const tokenProgramIdQuote = isT2022Quote ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const tokenTypeQuote = isT2022Quote ? 'token2022' : 'token';

    // Check if ATA exists in cache (no on-chain check during trading)
    const ataExistsInCache = await hasAtaInCache(baseMint, walletPublicKey, solanaConnection, tokenTypeBase);

    let userBaseToken;
    let creatingBaseAta = false;
    console.log("check1", ataExistsInCache)
    if (ataExistsInCache) {
      userBaseToken = await getAtaAddress(baseMint, walletPublicKey, solanaConnection);
      console.log("✅ Using cached ATA for base mint:", baseMintPubkey);
    } else {
      userBaseToken = await getAtaAddress(baseMint, walletPublicKey, solanaConnection);

      const createAtaInstruction = createAssociatedTokenAccountInstruction(
        wallet.keypair.publicKey, // payer
        userBaseToken, // associated token account
        wallet.keypair.publicKey, // owner
        baseMintPubkey, // mint
        tokenProgramIdBase
      );
      instructions.push(createAtaInstruction);
      creatingBaseAta = true;
    }

    // Check if user has ATA for quote token
    let userQuoteToken;
    let creatingQuoteAta = false;
    const quoteAtaExistsInCache = await hasAtaInCache(quoteMint, walletPublicKey, solanaConnection, tokenTypeQuote);
    console.log("check1", quoteAtaExistsInCache)
    if (quoteAtaExistsInCache) {
      userQuoteToken = await getAtaAddress(quoteMint, walletPublicKey, solanaConnection);
      console.log("✅ Using cached ATA for quote mint:", quoteMintPubkey);
    } else {
      userQuoteToken = await getAtaAddress(quoteMint, walletPublicKey, solanaConnection);

      const createQuoteAtaInstruction = createAssociatedTokenAccountInstruction(
        wallet.keypair.publicKey, // payer
        userQuoteToken, // associated token account
        wallet.keypair.publicKey, // owner
        quoteMintPubkey, // mint
        tokenProgramIdQuote
      );
      instructions.push(createQuoteAtaInstruction);
      creatingQuoteAta = true;
    }
    const buyInstruction = await createPumpSwapBuyInstruction(
      pool,
      user,
      baseMintPubkey,
      quoteMintPubkey,
      userBaseToken,
      userQuoteToken,
      protocolFeeRecipient,
      protocolFeeRecipientTokenAccount,
      coinCreator,
      baseAmountOut,
      maxQuoteAmountIn
    );
    instructions.push(buyInstruction);

    instructions.push(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: prioritizationFee }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 })
    );

    let recentBlockhash = blockhashManager.getBlockhashSync();
    console.log("recentBlockhash", recentBlockhash);

    // If no blockhash is available, fetch one immediately
    if (!recentBlockhash) {
      console.log("⚠️ No cached blockhash, fetching immediately...");
      recentBlockhash = await blockhashManager.getBlockhash();
    }
    console.log("instructions", instructions)

    // Build a VersionedTransaction (v0) for latest Solana
    const txMessage = new TransactionMessage({
      payerKey: wallet.keypair.publicKey,
      recentBlockhash,
      instructions,
    });

    const v0Message = txMessage.compileToV0Message([]);
    const transaction = new VersionedTransaction(v0Message);
    transaction.sign([wallet.keypair]);

    const serializedTransaction = transaction.serialize();
    
    console.log("🚀 Sending transaction...");
    const txid = await sendAndConfirmRawTransaction(solanaConnection, serializedTransaction, {
      skipPreflight: true,
      maxRetries: 10,
    });

    // Mark ATAs as on-chain after successful transaction
    if (txid) {
      if (creatingBaseAta) {
        updateOnChainStatus(baseMint, walletPublicKey, true);
      }
      if (creatingQuoteAta) {
        updateOnChainStatus(quoteMint, walletPublicKey, true);
      }
    }

    console.log("BUY PumpSwap Transaction:", txid);

    return txid;
  } catch (e) {
    console.error("Buy transaction failed:", e);

    // Enhanced error logging
    if (e.logs) {
      console.error("Transaction logs:", e.logs);
    }
    if (e.message) {
      console.error("Error message:", e.message);
    }
    if (e.signature) {
      console.error("Transaction signature:", e.signature);
    }

    // Log additional context for debugging
    console.error("Context for debugging:");
    console.error("  Mint:", mint);
    console.error("  Amount:", amount);
    console.error("  Context:", JSON.stringify(context, null, 2));
    console.error("  DIRECT_ADDED_PUMPSWAP:", DIRECT_ADDED_PUMPSWAP);
  }
}

export async function sell_pumpswap(baseMint, token_amount, context, isFull) {
  // const MAX_RETRIES = isFull ? 10 : 2;
  let attempt = 0;
  let lastError = null;
  const wallet = await getCachedWallet();

  // Parse slippage and prioritization fee from env, fallback to safe defaults
  const slippage = parseInt(process.env.SELL_SLIPPAGE_BPS_PERCENTAGE) || 50; // default 50 = 50%
  const prioritizationFee = isFull
    ? parseBigIntEnv(process.env.SELL_ALL_PRIORITIZATION_FEE_LAMPORTS, 20000n)
    : parseBigIntEnv(process.env.SELL_PRIORITIZATION_FEE_LAMPORTS, 20000n); // default 2000 microLamports

  while (attempt < MAX_RETRIES) {
    try {
      if (attempt >= 1) {
        const balance = await getSplTokenBalance(baseMint);
        console.log(`(Retry #${attempt}) Current tokenA (${baseMint}) balance:`, balance, "Requested amount:", token_amount);
        if (balance <= 0) {
          console.log(`No balance for tokenA (${baseMint}) to sell. Aborting swap.`);
          return "stop";
        }
        if (token_amount > balance) {
          console.log(
            `Requested token_amount (${token_amount}) exceeds available balance (${balance}) for baseMint (${baseMint}). Adjusting token_amount to available balance.`
          );
          token_amount = balance;
        }
      }

      const pool = new PublicKey(context.pool);
      const user = wallet.keypair.publicKey;
      const quoteMint = "So11111111111111111111111111111111111111112"; // SOL
      const protocolFeeRecipient = new PublicKey(context.protocolFeeRecipient);
      const protocolFeeRecipientTokenAccount = new PublicKey(context.protocolFeeRecipientTokenAccount);

      // Calculate user token accounts dynamically
      const walletPublicKey = wallet.keypair.publicKey.toString();

      // CRITICAL: Detect token type for proper close instruction
      const isT2022Base = await isToken2022(solanaConnection, baseMint);
      const tokenProgramIdBase = isT2022Base ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

      // Check if user has an Associated Token Account for base mint using cache
      const baseMintPubkey = new PublicKey(baseMint);
      const quoteMintPubkey = new PublicKey(quoteMint);


      const userBaseTokenAccount = await getAtaAddress(baseMint, walletPublicKey);
      const userQuoteTokenAccount = await getAtaAddress(quoteMint, walletPublicKey);
      let instructions = [];

      // Derive coin creator vault accounts
      const coinCreator = new PublicKey(context.coinCreator);



      // Calculate amounts based on slippage
      const baseAmountIn = new BN(token_amount);
      const minQuoteAmountOut = 0;

      
        const sellInstruction = await createPumpSwapSellInstruction(
          pool,
          user,
          baseMint,
          quoteMintPubkey,
          userBaseTokenAccount,
          userQuoteTokenAccount,
          protocolFeeRecipient,
          protocolFeeRecipientTokenAccount,
          coinCreator,
          baseAmountIn,
          minQuoteAmountOut
        );
        instructions.push(sellInstruction);




      // Add token close instruction if this is a full sell AND we're selling all tokens
      // IMPORTANT: Skip close for Token2022 due to potential extensions (transfer fees, etc.)
      let closingAta = false;
      if (isFull && !DIRECT_ADDED_PUMPSWAP && !isT2022Base) {
        try {
          const actualBalance = await getSplTokenBalance(baseMint);
          // Only close if we're selling all or more than the actual balance
          if (token_amount >= actualBalance) {
            const userAta = await getAtaAddress(baseMint, walletPublicKey);
            const closeInstruction = createCloseAccountInstruction(
              userAta, // token account to close
              wallet.keypair.publicKey, // destination (refund rent to payer)
              wallet.keypair.publicKey, // authority
              [], // multiSigners
              tokenProgramIdBase // CRITICAL: Use correct token program for Token2022
            );
            instructions.push(closeInstruction);
            closingAta = true;
            console.log(`🔒 Adding close instruction (selling ${token_amount} of ${actualBalance} total)`);
          } else {
            console.log(`⏭️ Skipping close instruction (selling ${token_amount} but ${actualBalance} total in account)`);
          }
        } catch (error) {
          console.log(chalk.yellow(`⚠️ Could not add close instruction: ${error.message}`));
        }
      }

      instructions.push(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: prioritizationFee }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 })
      );
      // Use VersionedTransaction (v0) instead of transactionFromInstructions
      let recentBlockhash = blockhashManager.getBlockhashSync();
      if (!recentBlockhash) {
        console.log("⚠️ No recent blockhash available, fetching new one...");
        recentBlockhash = await blockhashManager.getBlockhash();
      }
      const txMessage = new TransactionMessage({
        payerKey: wallet.keypair.publicKey,
        recentBlockhash,
        instructions,
      });
      const v0Message = txMessage.compileToV0Message([]);
      const transaction = new VersionedTransaction(v0Message);
      transaction.sign([wallet.keypair]);
      const serializedTransaction = transaction.serialize();
      const txid = await sendAndConfirmRawTransaction(solanaConnection, serializedTransaction, {
        skipPreflight: true,
        maxRetries: 2,
      });

      // Mark ATA as not on-chain after successful close
      if (closingAta) {
        updateOnChainStatus(baseMint, walletPublicKey, false);
      }

      console.log("SELL PumpSwap Transaction:", txid);
      return txid;
    } catch (e) {
      lastError = e;
      attempt++;
      console.error(`Error in sell attempt ${attempt}:`, e && e.stack ? e.stack : e);
      if (attempt < MAX_RETRIES) {
        // Optional: add a delay before retrying
        await new Promise((res) => setTimeout(res, RETRY_DELAY));
        console.log(`Retrying sell_pumpswap (attempt ${attempt + 1} of ${MAX_RETRIES})...`);
      }
    }
  }
  // If we get here, all attempts failed
  console.error("All sell_pumpswap attempts failed.");
  throw lastError;
}

export async function buy_pumpswap_direct(mint, amount, context) {
  try {
    // Parse slippage and prioritization fee from env, fallback to safe defaults
    const slippage = parseInt(process.env.BUY_SLIPPAGE_BPS_PERCENTAGE) || 500; // default 500 = 5%
    const prioritizationFee = parseBigIntEnv(process.env.BUY_PRIORITIZATION_FEE_LAMPORTS, 2000n); // default 2000 microLamports
    const wallet = await getCachedWallet();

    // Get required accounts from context
    const pool = new PublicKey(context.pool);
    const user = wallet.keypair.publicKey;
    let baseMint
    let quoteMint
  
       baseMint = "So11111111111111111111111111111111111111112"; 
       quoteMint =mint; // SOL
   

    const protocolFeeRecipient = new PublicKey(context.protocolFeeRecipient);
    const protocolFeeRecipientTokenAccount = new PublicKey(context.protocolFeeRecipientTokenAccount);
    const coinCreator = new PublicKey(context.coinCreator);

   
    // Calculate amounts based on slippage
    const baseAmountIn = new BN(amount);
    const minQuoteAmountOut = 0;

    console.log("🔍 Debug Info:");
    console.log("  Pool:", pool.toString());
    console.log("  User:", user.toString());
    console.log("  Base Mint:", baseMint);
    console.log("  Quote Mint:", quoteMint);
    console.log("  Slippage:", slippage);
    console.log("  DIRECT_ADDED_PUMPSWAP:", DIRECT_ADDED_PUMPSWAP);

    let instructions = [];
    // Check if user has an Associated Token Account for base mint using cache
    const walletPublicKey = wallet.keypair.publicKey.toString();
    const baseMintPubkey = new PublicKey(baseMint);
    const quoteMintPubkey = new PublicKey(quoteMint);
    console.log("basemint:", baseMintPubkey)
    console.log("quotemint:", quoteMintPubkey)

    // CRITICAL: Detect token types FIRST
    const isT2022Base = await isToken2022(solanaConnection, baseMint);
    const tokenProgramIdBase = isT2022Base ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const tokenTypeBase = isT2022Base ? 'token2022' : 'token';

    const isT2022Quote = await isToken2022(solanaConnection, quoteMint);
    const tokenProgramIdQuote = isT2022Quote ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const tokenTypeQuote = isT2022Quote ? 'token2022' : 'token';

    // Check if ATA exists in cache (no on-chain check during trading)
    const ataExistsInCache = await hasAtaInCache(baseMint, walletPublicKey, solanaConnection, tokenTypeBase);

    let userBaseToken;
    let creatingBaseAta = false;
    console.log("check1", ataExistsInCache)
    if (ataExistsInCache) {
      userBaseToken = await getAtaAddress(baseMint, walletPublicKey, solanaConnection);
      console.log("✅ Using cached ATA for base mint:", baseMintPubkey);
    } else {
      userBaseToken = await getAtaAddress(baseMint, walletPublicKey, solanaConnection);

      const createAtaInstruction = createAssociatedTokenAccountInstruction(
        wallet.keypair.publicKey, // payer
        userBaseToken, // associated token account
        wallet.keypair.publicKey, // owner
        baseMintPubkey, // mint
        tokenProgramIdBase
      );
      instructions.push(createAtaInstruction);
      creatingBaseAta = true;
    }

    // Check if user has ATA for quote token
    let userQuoteToken;
    let creatingQuoteAta = false;
    const quoteAtaExistsInCache = await hasAtaInCache(quoteMint, walletPublicKey, solanaConnection, tokenTypeQuote);
    console.log("check1", quoteAtaExistsInCache)
    if (quoteAtaExistsInCache) {
      userQuoteToken = await getAtaAddress(quoteMint, walletPublicKey, solanaConnection);
      console.log("✅ Using cached ATA for quote mint:", quoteMintPubkey);
    } else {
      userQuoteToken = await getAtaAddress(quoteMint, walletPublicKey, solanaConnection);

      const createQuoteAtaInstruction = createAssociatedTokenAccountInstruction(
        wallet.keypair.publicKey, // payer
        userQuoteToken, // associated token account
        wallet.keypair.publicKey, // owner
        quoteMintPubkey, // mint
        tokenProgramIdQuote
      );
      instructions.push(createQuoteAtaInstruction);
      creatingQuoteAta = true;
    }

    console.log("📋 Creating buy instruction with accounts:");
    console.log("  Pool:", pool.toString());
    console.log("  User:", user.toString());
    console.log("  Base Mint:", baseMintPubkey.toString());
    console.log("  Quote Mint:", quoteMintPubkey.toString());
    console.log("  User Base Token:", userBaseToken.toString());
    console.log("  User Quote Token:", userQuoteToken.toString());
    console.log("  Protocol Fee Recipient:", protocolFeeRecipient.toString());
    console.log("  Protocol Fee Recipient Token Account:", protocolFeeRecipientTokenAccount.toString());
    console.log("  Coin Creator:", coinCreator.toString());

    const sellInstruction = await createPumpSwapSellInstruction(
      pool,
      user,
      baseMint,
      quoteMintPubkey,
      userBaseToken,
      userQuoteToken,
      protocolFeeRecipient,
      protocolFeeRecipientTokenAccount,
      coinCreator,
      baseAmountIn,
      minQuoteAmountOut
    );
    instructions.push(sellInstruction);
 

    instructions.push(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: prioritizationFee }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 })
    );

    let recentBlockhash = blockhashManager.getBlockhashSync();
    console.log("recentBlockhash", recentBlockhash);

    // If no blockhash is available, fetch one immediately
    if (!recentBlockhash) {
      console.log("⚠️ No cached blockhash, fetching immediately...");
      recentBlockhash = await blockhashManager.getBlockhash();
    }
    console.log("instructions", instructions)

    // Build a VersionedTransaction (v0) for latest Solana
    const txMessage = new TransactionMessage({
      payerKey: wallet.keypair.publicKey,
      recentBlockhash,
      instructions,
    });

    const v0Message = txMessage.compileToV0Message([]);
    const transaction = new VersionedTransaction(v0Message);
    transaction.sign([wallet.keypair]);

    const serializedTransaction = transaction.serialize();
    
    console.log("🚀 Sending transaction...");
    const txid = await sendAndConfirmRawTransaction(solanaConnection, serializedTransaction, {
      skipPreflight: true,
      maxRetries: 10,
    });

    // Mark ATAs as on-chain after successful transaction
    if (txid) {
      if (creatingBaseAta) {
        updateOnChainStatus(baseMint, walletPublicKey, true);
      }
      if (creatingQuoteAta) {
        updateOnChainStatus(quoteMint, walletPublicKey, true);
      }
    }

    console.log("BUY PumpSwap Transaction:", txid);

    return txid;
  } catch (e) {
    console.error("Buy transaction failed:", e);

    // Enhanced error logging
    if (e.logs) {
      console.error("Transaction logs:", e.logs);
    }
    if (e.message) {
      console.error("Error message:", e.message);
    }
    if (e.signature) {
      console.error("Transaction signature:", e.signature);
    }

    // Log additional context for debugging
    console.error("Context for debugging:");
    console.error("  Mint:", mint);
    console.error("  Amount:", amount);
    console.error("  Context:", JSON.stringify(context, null, 2));
    console.error("  DIRECT_ADDED_PUMPSWAP:", DIRECT_ADDED_PUMPSWAP);
  }
}

export async function sell_pumpswap_direct(baseMint, token_amount, context, isFull) {
  // const MAX_RETRIES = isFull ? 10 : 2;
  let attempt = 0;
  let lastError = null;
  const wallet = await getCachedWallet();

  // Parse slippage and prioritization fee from env, fallback to safe defaults
  const slippage = parseInt(process.env.SELL_SLIPPAGE_BPS_PERCENTAGE) || 50; // default 50 = 50%
  const prioritizationFee = isFull
    ? parseBigIntEnv(process.env.SELL_ALL_PRIORITIZATION_FEE_LAMPORTS, 20000n)
    : parseBigIntEnv(process.env.SELL_PRIORITIZATION_FEE_LAMPORTS, 20000n); // default 2000 microLamports

  while (attempt < MAX_RETRIES) {
    try {
      if (attempt >= 1) {
        const balance = await getSplTokenBalance(baseMint);
        console.log(`(Retry #${attempt}) Current tokenA (${baseMint}) balance:`, balance, "Requested amount:", token_amount);
        if (balance <= 0) {
          console.log(`No balance for tokenA (${baseMint}) to sell. Aborting swap.`);
          return "stop";
        }
        if (token_amount > balance) {
          console.log(
            `Requested token_amount (${token_amount}) exceeds available balance (${balance}) for baseMint (${baseMint}). Adjusting token_amount to available balance.`
          );
          token_amount = balance;
        }
      }

      const pool = new PublicKey(context.pool);
      const user = wallet.keypair.publicKey;
      const quoteMint = "So11111111111111111111111111111111111111112"; // SOL
      const protocolFeeRecipient = new PublicKey(context.protocolFeeRecipient);
      const protocolFeeRecipientTokenAccount = new PublicKey(context.protocolFeeRecipientTokenAccount);

      // Calculate user token accounts dynamically
      const walletPublicKey = wallet.keypair.publicKey.toString();

      // CRITICAL: Detect token type for proper close instruction
      const isT2022Base = await isToken2022(solanaConnection, baseMint);
      const tokenProgramIdBase = isT2022Base ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

      // Check if user has an Associated Token Account for base mint using cache
      const baseMintPubkey = new PublicKey(baseMint);
      const quoteMintPubkey = new PublicKey(quoteMint);


      const userBaseToken= await getAtaAddress(baseMint, walletPublicKey);
      const userQuoteToken = await getAtaAddress(quoteMint, walletPublicKey);
      let instructions = [];

      // Derive coin creator vault accounts
      const coinCreator = new PublicKey(context.coinCreator);



      // Calculate amounts based on slippage
      const baseAmountOut = new BN(token_amount);
      const maxQuoteAmountIn = 0;

      
       
    const buyInstruction = await createPumpSwapBuyInstruction(
      pool,
      user,
      baseMintPubkey,
      quoteMintPubkey,
      userBaseToken,
      userQuoteToken,
      protocolFeeRecipient,
      protocolFeeRecipientTokenAccount,
      coinCreator,
      baseAmountOut,
      maxQuoteAmountIn
    );
    instructions.push(buyInstruction);

      // Add token close instruction if this is a full sell AND we're selling all tokens
      // IMPORTANT: Skip close for Token2022 due to potential extensions (transfer fees, etc.)
      let closingAta = false;
      if (isFull && !DIRECT_ADDED_PUMPSWAP && !isT2022Base) {
        try {
          const actualBalance = await getSplTokenBalance(baseMint);
          // Only close if we're selling all or more than the actual balance
          if (token_amount >= actualBalance) {
            const userAta = await getAtaAddress(baseMint, walletPublicKey);
            const closeInstruction = createCloseAccountInstruction(
              userAta, // token account to close
              wallet.keypair.publicKey, // destination (refund rent to payer)
              wallet.keypair.publicKey, // authority
              [], // multiSigners
              tokenProgramIdBase // CRITICAL: Use correct token program for Token2022
            );
            instructions.push(closeInstruction);
            closingAta = true;
            console.log(`🔒 Adding close instruction (selling ${token_amount} of ${actualBalance} total)`);
          } else {
            console.log(`⏭️ Skipping close instruction (selling ${token_amount} but ${actualBalance} total in account)`);
          }
        } catch (error) {
          console.log(chalk.yellow(`⚠️ Could not add close instruction: ${error.message}`));
        }
      }

      instructions.push(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: prioritizationFee }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 })
      );
      // Use VersionedTransaction (v0) instead of transactionFromInstructions
      let recentBlockhash = blockhashManager.getBlockhashSync();
      if (!recentBlockhash) {
        console.log("⚠️ No recent blockhash available, fetching new one...");
        recentBlockhash = await blockhashManager.getBlockhash();
      }
      const txMessage = new TransactionMessage({
        payerKey: wallet.keypair.publicKey,
        recentBlockhash,
        instructions,
      });
      const v0Message = txMessage.compileToV0Message([]);
      const transaction = new VersionedTransaction(v0Message);
      transaction.sign([wallet.keypair]);
      const serializedTransaction = transaction.serialize();
      const txid = await sendAndConfirmRawTransaction(solanaConnection, serializedTransaction, {
        skipPreflight: true,
        maxRetries: 2,
      });

      // Mark ATA as not on-chain after successful close
      if (closingAta) {
        updateOnChainStatus(baseMint, walletPublicKey, false);
      }

      console.log("SELL PumpSwap Transaction:", txid);
      return txid;
    } catch (e) {
      lastError = e;
      attempt++;
      console.error(`Error in sell attempt ${attempt}:`, e && e.stack ? e.stack : e);
      if (attempt < MAX_RETRIES) {
        // Optional: add a delay before retrying
        await new Promise((res) => setTimeout(res, RETRY_DELAY));
        console.log(`Retrying sell_pumpswap (attempt ${attempt + 1} of ${MAX_RETRIES})...`);
      }
    }
  }
  // If we get here, all attempts failed
  console.error("All sell_pumpswap attempts failed.");
  throw lastError;
}
// Test function for PumpSwap operations
async function testSwap() {
  try {
    console.log("=== Testing PumpSwap Functions ===");

    // Test parameters - let's try a different approach
    const testPairAddress = "25H3vysopvTqTwytkVBCjoXdiqqCHULsZts9EbceAuQM"; // Replace with actual pair address
    const testSOLAmount = 1000000; // 0.001 SOL (back to original amount)
    const testTokenAmount = 10022200; // 1 token (assuming 6 decimals)
    const testmint = "E2aNYdVidmFWvLHMd1kxtHibPTq1Adp9SvgVSQ4fpump"; // 5% slippage

    const context = {
      creator: "CXCPjwxuEg42H3VPayX8tL6aWwZM7XzjPNU3iTPEvvVG",
      feeRecipient: "62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV",
      virtualSolReserves: 36706344974,
      virtualTokenReserves: 876960120136454,
      pool: testPairAddress,
      protocolFeeRecipient: "62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV",
      protocolFeeRecipientTokenAccount: "94qWNrtmfn42h3ZjUZwWvK1MEo9uVmmrBPd2hpNjYDjb",
      poolQuoteTokenReserves: "110798963526",
      poolBaseTokenReserves: "185750818951998",
      coinCreator: "5gMTB7fG4b61WmaKNrbeq1z6Jsedw6bdWUdXGp6Lu9tS",
    };

    console.log("Using context:", context);
    console.log("Test SOL amount:", testSOLAmount);
    console.log("Test mint:", testmint);

    // console.log("Testing buy_pumpfun...");
    // const buyResult = await buy_pumpfun(testmint, testSOLAmount, context);
    // const buyResult = await buy_pumpswap(testmint, testSOLAmount, context);
    // console.log("Buy transaction result:", buyResult);

    // // Wait a bit before testing sell
    // await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log("Testing sell_pumpfun...");
    const sellResult = await sell_pumpfun(testmint, testTokenAmount, true, context);
    // const sellResult = await sell_pumpswap(testmint, testTokenAmount, context, true);
    console.log("Sell transaction result:", sellResult);

    console.log("=== PumpSwap Tests Completed ===");
  } catch (error) {
    console.error("Test failed:", error);
  }
}

// testSwap();
// // // Export test functions
// // export { testPumpSwap, blockhashManager, clearWalletCache, clearSdkCache };
