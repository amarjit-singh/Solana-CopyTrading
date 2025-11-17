import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";
import chalk from "chalk";
const PUMP_FUN_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
import "dotenv/config";
import dotenv from "dotenv";
dotenv.config();
import { buy_pumpfun, sell_pumpfun} from "./swapsdk_0slot.js";
import { swap } from "./swap.js";
import globalBlockhashManager from "./global_blockhash_manager.js";
import { isToken2022, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./ata_cache.js";

const RPC_URL = process.env.RPC_URL;
const connection = new Connection(RPC_URL, "confirmed");

// Initialize global blockhash manager for this connection
(async () => {
  try {
    await globalBlockhashManager.initialize();
    await globalBlockhashManager.initializeManager(connection, 200); // 200ms updates
    console.log("✅ Global blockhash manager initialized for fuc.js connection");
  } catch (error) {
    console.error("❌ Failed to initialize global blockhash manager:", error.message);
  }
})();

// Helper function to get fresh blockhash for trading operations
async function getTradingBlockhash() {
  try {
    // Try to get blockhash from global manager first
    const blockhash = globalBlockhashManager.getBlockhashForTrading(connection);
    if (blockhash) {
      return blockhash;
    }
    
    // Fallback to fresh blockhash if needed
    return await globalBlockhashManager.getFreshBlockhash(connection);
  } catch (error) {
    console.warn("⚠️ Failed to get blockhash from global manager, using connection directly:", error.message);
    // Fallback to direct connection
    const blockhashInfo = await connection.getLatestBlockhash("processed");
    return blockhashInfo.blockhash;
  }
}

export const token_buy = async (mint, sol_amount, pool_status,  context) => {
 
  if (!mint) {
    throw new Error("mint is required and was not provided.");
  }
  const currentUTC = performance.now();
  // const txid = await swap("BUY", mint, sol_amount * LAMPORTS_PER_SOL);
  let txid = "";
  let token_amount = 0;

  console.log(chalk.green(`🟢BUY tokenAmount:::${sol_amount} pool_status: ${pool_status} `));
  if (pool_status == "pumpfun") {
    console.log("pumpfun");

    ({txid, token_amount} = await buy_pumpfun(mint, sol_amount * LAMPORTS_PER_SOL, context));
  } 

  const endUTC = performance.now();
  const timeTaken = endUTC - currentUTC;
  console.log(`⏱️ Total BUY time taken: ${timeTaken}ms (${(timeTaken / 1000).toFixed(2)}s)`);
  return {txid, token_amount};
};

export const token_sell = async (mint, tokenAmount, pool_status, isFull, context) => {
  try {
   
    if (!mint) {
      throw new Error("mint is required and was not provided.");
    }
    console.log(chalk.red(`🔴SELL tokenAmount:::${tokenAmount} pool_status: ${pool_status} `));

    const currentUTC = new Date();
    let txid = "";
    if (pool_status == "pumpfun") {
      txid = await sell_pumpfun(mint, tokenAmount, isFull, context);
    } 
   
    else {
      txid = await swap("SELL", mint, tokenAmount);
    }

    // const txid = await swap("SELL", mint, tokenAmount);
    const endUTC = new Date();
    const timeTaken = endUTC.getTime() - currentUTC.getTime();
    console.log(`⏱️ Total SELL time taken: ${timeTaken}ms (${(timeTaken / 1000).toFixed(2)}s)`);

    if (txid === "stop") {
      console.log(chalk.red(`[${new Date().toISOString()}] 🛑 Swap returned "stop" - no balance for ${mint}`));
      return "stop";
    }

    if (txid) {
      console.log(chalk.green(`Successfully sold ${tokenAmount} tokens : https://solscan.io/tx/${txid}`));
      return txid;
    }else{
      txid = await swap("SELL", mint, tokenAmount);
      const endUTC = new Date();
    const timeTaken = endUTC.getTime() - currentUTC.getTime();
    console.log(`⏱️ Total SELL time taken using swap: ${timeTaken}ms (${(timeTaken / 1000).toFixed(2)}s)`);

      return txid;
    }

    return null;
  } catch (error) {
    txid = await swap("SELL", mint, tokenAmount);
    console.error("Error in token_sell:", error.message);
    const endUTC = new Date();
    const timeTaken = endUTC.getTime() - currentUTC.getTime();
    console.log(`⏱️ Total SELL time taken using swap from error: ${timeTaken}ms (${(timeTaken / 1000).toFixed(2)}s)`);

      return txid;
    if (error.response?.data) {
      console.error("API Error details:", error.response.data);
    }
    return null;
  }
};

export async function getBondingCurveAddress(mintAddress) {
  const tokenMint = new PublicKey(mintAddress);

  const [pairPDA] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), tokenMint.toBuffer()], PUMP_FUN_PROGRAM_ID);
  return pairPDA.toBase58();
}

export async function getTokenHolders(mintAddress, pairAddress) {
  try {
    const mintPubkey = new PublicKey(mintAddress);

    // Run both async calls in parallel
    const [mintInfoRes, tokenAccountsRes] = await Promise.all([
      connection.getParsedAccountInfo(mintPubkey),
      connection.getTokenLargestAccounts(mintPubkey),
    ]);

    // Extract total supply and owner (mint authority)
    const supply = mintInfoRes?.value?.data?.parsed?.info?.supply;

    const totalSupply = supply ? parseInt(supply) : 0;

    //   console.log("Total Supply:", totalSupply);

    if (!tokenAccountsRes.value) {
      console.log("No token accounts found");
      return { holders: [], top10Percentage: 0, totalSupply };
    }

    const holders = tokenAccountsRes.value

      .filter((account) => parseInt(account.amount) > 0)
      .map((account) => ({
        owner: account.address,
        amount: parseInt(account.amount),
      }));

    const filteredHolders = holders.filter((h) => h.owner !== pairAddress);

    // Get the top 10 excluding the mint authority
    const top10 = filteredHolders.slice(1, 11);
    //   console.log("Top 10 Holders (excluding owner):", top10);

    const top10Total = top10.reduce((sum, h) => sum + h.amount, 0);
    const top10Percentage = totalSupply > 0 ? (top10Total / totalSupply) * 100 : 0;

    return {
      holders: filteredHolders,
      totalSupply,
      top10Percentage: top10Percentage.toFixed(2),
    };
  } catch (error) {
    console.error("Error fetching token holders:", error);
    return { holders: [], top10Percentage: 0, totalSupply: 0 };
  }
}

// Add utility function to check transaction status
export const checkTransactionStatus = async (txid, maxRetries = 5) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔍 Attempt ${attempt}/${maxRetries}: Checking transaction ${txid}`);
      
      const status = await connection.getSignatureStatus(txid);
      console.log(`📊 Status:`, status?.value);
      
      if (status?.value) {
        const confirmationStatus = status.value.confirmationStatus;
        const confirmations = status.value.confirmations;
        
        console.log(`📈 Confirmation Status: ${confirmationStatus}, Confirmations: ${confirmations}`);
        
        if (confirmationStatus === 'finalized') {
          console.log(`✅ Transaction finalized successfully`);
          return { success: true, status: 'finalized', confirmations };
        } else if (confirmationStatus === 'confirmed') {
          console.log(`✅ Transaction confirmed`);
          return { success: true, status: 'confirmed', confirmations };
        } else if (confirmationStatus === 'processed') {
          console.log(`⏳ Transaction still processing...`);
          if (attempt < maxRetries) {
            const waitTime = Math.min(1000 * attempt, 5000); // Exponential backoff, max 5s
            console.log(`⏰ Waiting ${waitTime}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
        }
      }
      
      // If we get here, transaction might not exist or failed
      if (attempt === maxRetries) {
        console.log(`❌ Transaction not found or failed after ${maxRetries} attempts`);
        return { success: false, status: 'not_found' };
      }
      
    } catch (error) {
      console.error(`❌ Error checking transaction status (attempt ${attempt}):`, error.message);
      if (attempt === maxRetries) {
        return { success: false, status: 'error', error: error.message };
      }
    }
  }
  
  return { success: false, status: 'timeout' };
};

export const getDataFromTx = async (txid, maxRetries = 10, initialDelay = 500) => {
  let attempt = 0;
  let delay = initialDelay;
  
  console.log(`🔍 Fetching transaction: ${txid?.slice(0, 16)}...`);
  
  while (attempt < maxRetries) {
    try {
      attempt++;
      
      // First, check transaction status
      const status = await connection.getSignatureStatus(txid);
      
      if (status?.value === null) {
        if (attempt === 1) {
          console.log(`⏳ Transaction not yet on chain, will retry ${maxRetries} times...`);
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 1.5, 5000); // Exponential backoff, max 5 seconds
        continue;
      }
      
      const confirmStatus = status?.value?.confirmationStatus || 'unknown';
      if (attempt <= 3) {
        console.log(`📊 Attempt ${attempt}/${maxRetries}: Status=${confirmStatus}`);
      }
      
      // If transaction is still processing, wait and retry
      if (confirmStatus === 'processed') {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 1.5, 5000);
        continue;
      }
      
      // If transaction has an error, log it and return null
      if (status?.value?.err) {
        console.log(`❌ Transaction failed with error:`, status.value.err);
        return null;
      }
      
      // Try to fetch the transaction
      const tx = await connection.getParsedTransaction(txid, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed'
      });

      if (!tx) {
        if (attempt % 3 === 0) {
          console.log(`⏳ Attempt ${attempt}/${maxRetries}: Transaction data not available, retrying...`);
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 1.5, 5000);
        continue;
      }

      console.log(`✅ Transaction found successfully after ${attempt} attempt(s)`);
      return tx;
      
    } catch (error) {
      console.error(`⚠️ Attempt ${attempt}/${maxRetries}: Error fetching transaction: ${error.message}`);
      
      // Check if it's a rate limit error - wait longer
      if (error.message.includes('rate limit') || error.message.includes('429')) {
        console.log(`� Rate limited - waiting ${delay * 2}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay * 2));
        delay = Math.min(delay * 2, 10000);
        continue;
      }
      
      // For other errors, use normal backoff
      if (attempt < maxRetries) {
        console.log(`🔄 Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 1.5, 5000);
        continue;
      }
    }
  }
  
  // All retries exhausted
  console.log(`❌ Failed to fetch transaction after ${maxRetries} attempts`);
  console.log(`🔍 Possible reasons:`);
  console.log(`   - Transaction is taking too long to confirm (>30s)`);
  console.log(`   - Transaction failed and was not committed`);
  console.log(`   - RPC node doesn't have this transaction`);
  console.log(`   - Network congestion`);
  
  return null;
};

export async function getMintFromPumpSwapPair(pairAddress) {
  const accountInfo = await connection.getAccountInfo(new PublicKey(pairAddress));
  if (!accountInfo?.data || accountInfo.data.length < 75) {
    console.log("Invalid or empty account data.");
    return null;
  }

  const buffer = accountInfo.data;

  // Use the correct offset (43) for the mint address
  const mintOffset = 43;
  const mintBytes = buffer.slice(mintOffset, mintOffset + 32);
  let mint;
  try {
    mint = new PublicKey(mintBytes).toBase58();
  } catch (e) {
    console.log("Failed to parse mint address at offset 43.");
    return null;
  }

  console.log(`✅ Pumpswap Mint Address: ${mint} (found at offset ${mintOffset})`);
  return mint;
}

export const getSplTokenBalance = async (mint) => {
  if (!mint) {
    // console.log("🔄 Token balance error: Mint address is undefined or null.");
    // console.log("🔄 Debug info: mint parameter =", mint);
    // console.log("🔄 Debug info: mint type =", typeof mint);
    throw new Error("Mint address is undefined or null.");
  }

  let mintPubkey;
  try {
    mintPubkey = new PublicKey(mint);
  } catch (err) {
    console.log("🔄 Token balance error: Invalid mint address provided.");
    throw err;
  }

  // CRITICAL: Detect token type to use correct program ID
  const isT2022 = await isToken2022(connection, mint);
  const tokenProgramId = isT2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

  // const publicKey = getPublicKeyFromPrivateKey();
  const publicKey = process.env.PUB_KEY;
  const ata = await getAssociatedTokenAddress(
    mintPubkey,
    new PublicKey(publicKey),
    false, // allowOwnerOffCurve
    tokenProgramId // CRITICAL: Use correct token program
  );

  let account;
  try {
    // CRITICAL: Pass tokenProgramId to avoid TokenInvalidAccountOwnerError
    account = await getAccount(connection, ata, 'confirmed', tokenProgramId);
  } catch (err) {
    // Handle TokenAccountNotFoundError gracefully
    if (
      err.name === "TokenAccountNotFoundError" ||
      err.name === "TokenInvalidAccountOwnerError" ||
      (err.message && (
        err.message.includes("Failed to find account") ||
        err.message.includes("Account does not exist") ||
        err.message.includes("could not find account")
      ))
    ) {
      // No account found, treat as zero balance
      // console.log("🔄 Token balance: Account not found, returning 0.");
      return null;
    }
    // If the error is related to an invalid mint, log and throw error
    if (err.message && err.message.includes("Invalid param")) {
      console.log("🔄 Token balance error: Invalid mint param.");
      throw err;
    }
    // Other errors
    console.log("🔄 Token balance error:", err.message || err);
    throw err;
  }

  return Number(account.amount); // Convert BigInt to Number
};

export const checkWalletBalance = async (requiredAmount = 0) => {
  try {
    const publicKey = process.env.PUB_KEY;
    if (!publicKey) {
      throw new Error("PUB_KEY not found in environment variables");
    }

    const walletPubkey = new PublicKey(publicKey);
    const startTime = Date.now();
    const balance = await connection.getBalance(walletPubkey);
    const endTime = Date.now();
    const timeTakenMs = endTime - startTime;
    console.log(chalk.gray(`[${new Date().toISOString()}] ⏱️ getBalance took ${timeTakenMs}ms (${(timeTakenMs / 1000).toFixed(2)}s)`));
    const balanceInSol = balance / LAMPORTS_PER_SOL;
    
    if (requiredAmount > 0) {
      const requiredWithFees = requiredAmount + 0.01; // Add 0.01 SOL for fees
      const hasSufficientFunds = balanceInSol >= requiredWithFees;
      
      console.log(chalk.blue(`[${new Date().toISOString()}] 💰 Wallet balance: ${balanceInSol.toFixed(4)} SOL`));
      console.log(chalk.blue(`[${new Date().toISOString()}] 💰 Required: ${requiredWithFees.toFixed(4)} SOL (including fees)`));
      console.log(chalk.blue(`[${new Date().toISOString()}] 💰 Sufficient funds: ${hasSufficientFunds ? '✅ YES' : '❌ NO'}`));
      
      return {
        balance: balanceInSol,
        required: requiredWithFees,
        hasSufficientFunds,
        publicKey: publicKey
      };
    }
    
    return {
      balance: balanceInSol,
      publicKey: publicKey
    };
  } catch (error) {
    console.error(chalk.red(`[${new Date().toISOString()}] ❌ Error checking wallet balance: ${error.message}`));
    throw error;
  }
};
