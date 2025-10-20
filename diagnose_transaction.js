import { Connection, PublicKey } from "@solana/web3.js";
import dotenv from "dotenv";
import chalk from "chalk";

dotenv.config();

const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC_URL, "confirmed");

async function diagnoseTransaction(signature) {
  console.log(chalk.cyan(`\n${"=".repeat(80)}`));
  console.log(chalk.cyan(`🔍 Analyzing Transaction: ${signature}`));
  console.log(chalk.cyan(`${"=".repeat(80)}\n`));

  try {
    // Fetch transaction details with address lookup table support
    const tx = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });

    if (!tx) {
      console.log(chalk.red("❌ Transaction not found or too old"));
      return null;
    }

    console.log(chalk.green("✅ Transaction found!"));
    console.log(chalk.yellow(`📅 Block Time: ${new Date(tx.blockTime * 1000).toISOString()}`));
    console.log(chalk.yellow(`📦 Slot: ${tx.slot}`));
    console.log(chalk.yellow(`💰 Fee: ${tx.meta.fee / 1e9} SOL`));
    console.log(chalk.yellow(`${tx.meta.err ? "❌" : "✅"} Status: ${tx.meta.err ? "FAILED" : "SUCCESS"}`));

    if (tx.meta.err) {
      console.log(chalk.red(`\n❌ Error: ${JSON.stringify(tx.meta.err)}`));
    }

    // Extract account keys from parsed transaction
    const accountKeys = tx.transaction.message.accountKeys;
    console.log(chalk.cyan(`\n📋 Accounts Involved (${accountKeys.length} total):`));
    
    // Check for Pump.fun program
    const PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
    let isPumpFun = false;
    
    accountKeys.forEach((account, index) => {
      const keyStr = account.pubkey.toBase58();
      if (keyStr === PUMP_FUN_PROGRAM) {
        isPumpFun = true;
        console.log(chalk.green(`  ${index}: ${keyStr} ⭐ PUMP.FUN PROGRAM`));
      } else if (index < 5) {
        console.log(chalk.gray(`  ${index}: ${keyStr}`));
      }
    });

    if (isPumpFun) {
      console.log(chalk.green("\n✅ This IS a Pump.fun transaction!"));
    } else {
      console.log(chalk.yellow("\n⚠️  This is NOT a Pump.fun transaction"));
    }

    // Show instructions from parsed transaction
    const instructions = tx.transaction.message.instructions;
    console.log(chalk.cyan(`\n📝 Instructions (${instructions.length} total):`));
    
    instructions.forEach((ix, index) => {
      const programId = ix.programId.toBase58();
      console.log(chalk.gray(`  ${index + 1}. Program: ${programId}`));
      if (ix.parsed) {
        console.log(chalk.gray(`     Type: ${ix.parsed.type || 'unknown'}`));
      }
    });

    // SOL balance changes
    console.log(chalk.cyan("\n💰 SOL Balance Changes:"));
    const preBalances = tx.meta.preBalances;
    const postBalances = tx.meta.postBalances;
    
    let mainWalletChange = null;
    accountKeys.forEach((account, index) => {
      const change = (postBalances[index] - preBalances[index]) / 1e9;
      if (Math.abs(change) > 0.0001) {
        const keyStr = account.pubkey.toBase58();
        const changeStr = change > 0 ? chalk.green(`+${change.toFixed(6)} SOL`) : chalk.red(`${change.toFixed(6)} SOL`);
        console.log(`  ${keyStr.slice(0, 8)}...${keyStr.slice(-4)}: ${changeStr}`);
        
        if (index === 0) {
          mainWalletChange = change;
        }
      }
    });

    // Token balance changes
    if (tx.meta.postTokenBalances && tx.meta.postTokenBalances.length > 0) {
      console.log(chalk.cyan("\n🪙 Token Balance Changes:"));
      
      const preTokenMap = new Map();
      tx.meta.preTokenBalances?.forEach(bal => {
        preTokenMap.set(`${bal.accountIndex}-${bal.mint}`, bal);
      });

      tx.meta.postTokenBalances.forEach(postBal => {
        const key = `${postBal.accountIndex}-${postBal.mint}`;
        const preBal = preTokenMap.get(key);
        
        const postAmount = parseFloat(postBal.uiTokenAmount.uiAmountString || "0");
        const preAmount = preBal ? parseFloat(preBal.uiTokenAmount.uiAmountString || "0") : 0;
        const change = postAmount - preAmount;
        
        if (Math.abs(change) > 0.000001) {
          const changeStr = change > 0 ? chalk.green(`+${change}`) : chalk.red(`${change}`);
          console.log(`  Token: ${postBal.mint.slice(0, 8)}...${postBal.mint.slice(-4)}`);
          console.log(`    ${changeStr} tokens`);
        }
      });
    }

    // Log URLs
    console.log(chalk.cyan("\n🔗 View on Explorers:"));
    console.log(chalk.blue(`  Solscan: https://solscan.io/tx/${signature}`));
    console.log(chalk.blue(`  Solana Explorer: https://explorer.solana.com/tx/${signature}`));

    return {
      isPumpFun,
      success: !tx.meta.err,
      mainWalletChange,
      signature
    };

  } catch (error) {
    console.error(chalk.red("\n❌ Error analyzing transaction:"), error.message);
    return null;
  }
}

async function main() {
  const transactions = [
    "LuccGeoRSsWQqe3PAQfKNKMpaFyXVfHKqxCBg3NTp4qxuqWtJ4mqHH3SEf6z3JZZ5asKu8QGcXBF1bDaNSfCr8L",
    "41g9utydYfGNTgsvG6KdVdcnu2hpzwJLCvyzdF4B3ptT2fDxSeayWJTkGvRJNoewpHbaqWUun1TXYdJZN3Y718i6"
  ];

  console.log(chalk.cyan.bold("\n🔬 TRANSACTION DIAGNOSIS REPORT"));
  console.log(chalk.gray("Analyzing transactions to determine if they're Pump.fun trades...\n"));

  const results = [];
  for (const sig of transactions) {
    const result = await diagnoseTransaction(sig);
    if (result) {
      results.push(result);
    }
    await new Promise(resolve => setTimeout(resolve, 500)); // Rate limit
  }

  // Summary
  console.log(chalk.cyan(`\n${"=".repeat(80)}`));
  console.log(chalk.cyan.bold("📊 SUMMARY"));
  console.log(chalk.cyan(`${"=".repeat(80)}\n`));

  const pumpFunCount = results.filter(r => r.isPumpFun).length;
  const successCount = results.filter(r => r.success).length;

  console.log(chalk.yellow(`Total transactions analyzed: ${results.length}`));
  console.log(chalk.yellow(`Pump.fun transactions: ${pumpFunCount}`));
  console.log(chalk.yellow(`Successful transactions: ${successCount}`));
  console.log(chalk.yellow(`Failed transactions: ${results.length - successCount}`));

  if (pumpFunCount === 0) {
    console.log(chalk.red("\n⚠️  IMPORTANT: None of these are Pump.fun transactions!"));
    console.log(chalk.yellow("Your bot is configured to only monitor Pump.fun trades."));
    console.log(chalk.yellow("These transactions are from different programs/protocols."));
  } else {
    console.log(chalk.green("\n✅ Found Pump.fun transactions!"));
    console.log(chalk.green("Your gRPC configuration should be able to detect similar transactions."));
  }
}

main().catch(console.error);
