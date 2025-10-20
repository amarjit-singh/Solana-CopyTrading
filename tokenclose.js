import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  closeAccount,
  getAccount,
  TOKEN_PROGRAM_ID,
  createCloseAccountInstruction,
  createBurnInstruction,
} from "@solana/spl-token";
import { ComputeBudgetProgram } from "@solana/web3.js";
import dotenv from "dotenv";
import bs58 from "bs58";
dotenv.config();
import { swap } from "./swap.js";
import { removeAtaFromCache } from "./ata_cache.js";
import { decodePrivateKey } from "./swap.js";

// WSOL mint address (mainnet)
const WSOL_MINT = "So11111111111111111111111111111111111111112";

const encodedPrivateKey = process.env.ENCODED_PRIVATE_KEY; // or load from file

const secretKeyString =  encodedPrivateKey;

const secretKeyBytes = decodePrivateKey(secretKeyString);
const payer = Keypair.fromSecretKey(secretKeyBytes);

// Constants
const RPC_ENDPOINT= process.env.RPC_URL
const connection = new Connection(RPC_ENDPOINT, "confirmed");
const owner = payer.publicKey;

// Configuration for concurrent processing
const MAX_CONCURRENT = 5; // Number of concurrent operations
const BATCH_SIZE =10; // Process tokens in batches

async function getAllTokenAccounts(connection, owner) {
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID,
  });
  
  // Return all token accounts (including those with zero balance)
  return tokenAccounts.value;
}

async function closeTokenAccount(connection, payer, tokenAccount, owner) {
  try {
    const latestBlockHash = await connection.getLatestBlockhash();
    const accountInfo = tokenAccount.account.data.parsed.info;
    const tokenAmount = accountInfo.tokenAmount.amount; // Raw amount (not UI amount)
    const mint = accountInfo.mint;

    // Don't close WSOL account
    if (mint === WSOL_MINT) {
      console.log(`⏩ Skipping WSOL account: ${tokenAccount.pubkey.toString()}`);
      return null;
    }
    
    // If there are tokens, try to sell them first
    if (tokenAmount > 0) {
      console.log(`💰 Swapping all tokens for mint: ${mint} (amount: ${tokenAmount})`);
      const swapTxid = await swap("SELL", mint, Number(tokenAmount));
      if (swapTxid && swapTxid !== "stop") {
        removeAtaFromCache(mint, owner.toString());
        console.log(`✅ Successfully swapped tokens! Transaction: https://solscan.io/tx/${swapTxid}`);
        // Wait a bit for the swap to settle
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        console.error(`❌ Failed to swap tokens for mint ${mint}. Skipping close for this account.`);
        return null;
      }
    }
    
    const instructions = [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 8000 }),
      createCloseAccountInstruction(
        tokenAccount.pubkey,
        payer.publicKey,
        payer.publicKey
      )
    ];
    
    const message = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: latestBlockHash.blockhash,
      instructions: instructions,
    }).compileToV0Message();
    
    const transaction = new VersionedTransaction(message);
    transaction.sign([payer]);
    
    const txid = await connection.sendTransaction(transaction, {
      skipPreflight: false,
      maxRetries: 2,
    });
    
    return txid;
  } catch (error) {
    console.error(`Failed to close token account ${tokenAccount.pubkey.toString()}:`, error);
    return null;
  }
}

// Process a batch of token accounts concurrently
async function processBatch(tokenAccounts, batchIndex, totalBatches) {
  console.log(`\n🔄 Processing batch ${batchIndex + 1}/${totalBatches} (${tokenAccounts.length} accounts)`);
  
  const promises = tokenAccounts.map(async (tokenAccount, index) => {
    const accountInfo = tokenAccount.account.data.parsed.info;
    const globalIndex = batchIndex * BATCH_SIZE + index;

    // Don't attempt to close WSOL account, just log and skip
    if (accountInfo.mint === WSOL_MINT) {
      console.log(`⏩ [${globalIndex + 1}] Skipping WSOL account: ${accountInfo.mint}`);
      return { success: false, txid: null, mint: accountInfo.mint, skipped: true };
    }
    
    console.log(`📝 [${globalIndex + 1}] Token: ${accountInfo.mint} | Balance: ${accountInfo.tokenAmount.uiAmount}`);
    
    try {
      const txid = await closeTokenAccount(connection, payer, tokenAccount, owner);
      
      if (txid) {
        console.log(`✅ [${globalIndex + 1}] Successfully closed token account!`);
        console.log(`🔗 Transaction: https://solscan.io/tx/${txid}`);
        return { success: true, txid, mint: accountInfo.mint };
      } else {
        console.log(`❌ [${globalIndex + 1}] Failed to close token account`);
        return { success: false, txid: null, mint: accountInfo.mint };
      }
    } catch (error) {
      console.error(`❌ [${globalIndex + 1}] Error processing token account:`, error);
      return { success: false, txid: null, mint: accountInfo.mint, error: error.message };
    }
  });
  
  // Wait for all promises in the batch to complete
  const results = await Promise.allSettled(promises);
  
  // Process results
  const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
  const failed = results.length - successful;
  
  console.log(`📊 Batch ${batchIndex + 1} results: ${successful} successful, ${failed} failed`);
  
  return results.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: r.reason });
}

(async () => {
  try {
    console.log("👛 Wallet Public Key:", payer.publicKey.toString());
    console.log("🔍 Fetching all token accounts...");
    const tokenAccounts = await getAllTokenAccounts(connection, owner);
    
    if (tokenAccounts.length === 0) {
      console.log("✅ No token accounts found to close");
      return;
    }
    
    // Filter out WSOL accounts from the list to close (optional, but we also check in closeTokenAccount/processBatch)
    // const filteredTokenAccounts = tokenAccounts.filter(
    //   t => t.account.data.parsed.info.mint !== WSOL_MINT
    // );
    // If you want to skip them entirely, use filteredTokenAccounts instead of tokenAccounts below.

    console.log(`📊 Found ${tokenAccounts.length} token accounts to close`);
    console.log(`⚡ Processing with ${MAX_CONCURRENT} concurrent operations in batches of ${BATCH_SIZE}`);
    
    // Split token accounts into batches
    const batches = [];
    for (let i = 0; i < tokenAccounts.length; i += BATCH_SIZE) {
      batches.push(tokenAccounts.slice(i, i + BATCH_SIZE));
    }
    
    const allResults = [];
    
    // Process batches with controlled concurrency
    for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
      const currentBatches = batches.slice(i, i + MAX_CONCURRENT);
      
      console.log(`\n🚀 Starting ${currentBatches.length} concurrent batches...`);
      
      const batchPromises = currentBatches.map((batch, batchIndex) => 
        processBatch(batch, i + batchIndex, batches.length)
      );
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      // Flatten results
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          allResults.push(...result.value);
        } else {
          console.error(`❌ Batch ${i + index} failed:`, result.reason);
        }
      });
      
      // Add delay between batch groups to avoid overwhelming the network
      if (i + MAX_CONCURRENT < batches.length) {
        console.log(`⏳ Waiting 2 seconds before next batch group...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Final summary
    const totalSuccessful = allResults.filter(r => r.success).length;
    const totalFailed = allResults.filter(r => !r.success && !r.skipped).length;
    const totalSkipped = allResults.filter(r => r.skipped).length;
    console.log(`🎉 Total successful: ${totalSuccessful}`);
    console.log(`❌ Total failed: ${totalFailed}`);
    if (totalSkipped > 0) {
      console.log(`⏩ Total skipped (WSOL): ${totalSkipped}`);
    }
    
  } catch (err) {
    console.error("❌ Error in main execution:", err);
  }
})();